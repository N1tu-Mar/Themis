import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from '../dist/stacks/data-stack.js';
import { AgentStack } from '../dist/stacks/agent-stack.js';
import { MessagingStack } from '../dist/stacks/messaging-stack.js';
import { ObservabilityStack } from '../dist/stacks/observability-stack.js';
import { loadConfig } from '../dist/config/env.js';

function synth() {
  const app = new cdk.App();
  const config = loadConfig();
  const data = new DataStack(app, 'TestData4', { config });
  const agent = new AgentStack(app, 'TestAgent3', { config, data });
  const messaging = new MessagingStack(app, 'TestMessaging2', { config, data, agent });
  const stack = new ObservabilityStack(app, 'TestObservability', { agent, messaging });
  return Template.fromStack(stack);
}

test('alarms on both Lambda functions erroring', () => {
  const t = synth();
  t.resourceCountIs('AWS::CloudWatch::Alarm', 2);
});

test('derives ToolFailures / PolicyDenials / HumanReviewRequired metrics from the audit log shape', () => {
  const t = synth();
  const filters = t.findResources('AWS::Logs::MetricFilter');
  const metricNames = Object.values(filters).map((f) => f.Properties.MetricTransformations[0].MetricName);
  assert.deepEqual(new Set(metricNames), new Set(['ToolFailures', 'PolicyDenials', 'HumanReviewRequired']));
});

test('publishes one dashboard', () => {
  const t = synth();
  t.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
});
