import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from '../dist/stacks/data-stack.js';
import { AgentStack } from '../dist/stacks/agent-stack.js';
import { MessagingStack } from '../dist/stacks/messaging-stack.js';
import { loadConfig } from '../dist/config/env.js';

function synth(overrides = {}) {
  const app = new cdk.App();
  const config = { ...loadConfig(), ...overrides };
  const data = new DataStack(app, 'D', { config });
  const agent = new AgentStack(app, 'A', { config, data });
  const messaging = new MessagingStack(app, 'M', { config, data, agent });
  return { agent: Template.fromStack(agent), messaging: Template.fromStack(messaging) };
}

test('tools adapter is the staged real asset and can invoke messaging', () => {
  const { agent } = synth();
  for (const f of ['handler.py', 'router.py', 'bank_tools', 'merchant_intel', 'orchestrator', 'merchant-profiles.json', 'schemas.json']) {
    assert.ok(existsSync(new URL(`../build/tools-adapter/${f}`, import.meta.url)), f);
  }
  agent.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'ThemisToolsAdapter',
    Environment: { Variables: Match.objectLike({ MESSAGING_FUNCTION_NAME: 'ThemisMessageNormalizer', IDEMPOTENCY_TABLE: Match.anyValue() }) },
  });
  agent.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: Match.objectLike({ Statement: Match.arrayWith([Match.objectLike({ Action: 'lambda:InvokeFunction' })]) }),
  });
});

test('runtime asset has the entry point the CFN runtime config names', () => {
  assert.ok(existsSync(new URL('../build/agent-runtime/src/orchestrator/main.py', import.meta.url)));
  assert.ok(existsSync(new URL('../build/agent-runtime/customers.json', import.meta.url)));
});

test('messaging Lambda is the Node bundle with the env the runtime composition requires', () => {
  const { messaging } = synth({ enableRcs: true, enableSmsFallback: true });
  messaging.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'ThemisMessageNormalizer', Runtime: 'nodejs22.x', Handler: 'index.handler',
    Environment: { Variables: Match.objectLike({
      THEMIS_MODE: 'aws', THEMIS_RCS_TOPIC_ARN: Match.anyValue(), THEMIS_SMS_TOPIC_ARN: Match.anyValue(),
      THEMIS_RCS_POOL_ID: Match.anyValue(), THEMIS_SES_FROM: Match.anyValue(), AGENT_RUNTIME_ARN: Match.anyValue() }) },
  });
  messaging.resourceCountIs('AWS::SNS::Topic', 2); // plain RCS and SMS need distinct trusted topics
  messaging.resourceCountIs('AWS::SNS::Subscription', 2);
});
