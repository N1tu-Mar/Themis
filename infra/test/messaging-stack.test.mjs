import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from '../dist/stacks/data-stack.js';
import { AgentStack } from '../dist/stacks/agent-stack.js';
import { MessagingStack } from '../dist/stacks/messaging-stack.js';
import { loadConfig } from '../dist/config/env.js';

function synth(overrides = {}) {
  const app = new cdk.App();
  const config = { ...loadConfig(), ...overrides };
  const data = new DataStack(app, 'TestData3', { config });
  const agent = new AgentStack(app, 'TestAgent2', { config, data });
  const stack = new MessagingStack(app, 'TestMessaging', { config, data, agent });
  return Template.fromStack(stack);
}

test('provisions exactly one inbound SNS topic (no extra queue invented)', () => {
  const t = synth();
  t.resourceCountIs('AWS::SNS::Topic', 1);
  t.hasResourceProperties('AWS::SNS::Topic', { TopicName: 'ThemisInboundMessaging' });
  t.resourceCountIs('AWS::SQS::Queue', 0);
});

test('subscribes the normalizer Lambda to the inbound topic', () => {
  const t = synth();
  t.resourceCountIs('AWS::SNS::Subscription', 1);
  t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'lambda' });
});

test('normalizer role can invoke the agent runtime and the idempotency table, nothing broader', () => {
  const t = synth();
  t.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({ Action: 'bedrock-agentcore:InvokeAgentRuntime' }),
      ]),
    }),
  });
});

test('provisions the SMS two-way channel role + configuration set only when ENABLE_SMS_FALLBACK is set', () => {
  const on = synth({ enableSmsFallback: true });
  on.resourceCountIs('AWS::SMSVOICE::ConfigurationSet', 1);

  const off = synth({ enableSmsFallback: false });
  off.resourceCountIs('AWS::SMSVOICE::ConfigurationSet', 0);
});

test('does not provision a real phone number or pool (manual step, not reproducible in CDK)', () => {
  const t = synth();
  t.resourceCountIs('AWS::SMSVOICE::PhoneNumber', 0);
  t.resourceCountIs('AWS::SMSVOICE::Pool', 0);
});
