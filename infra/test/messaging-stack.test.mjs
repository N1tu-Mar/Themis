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

test('provisions distinct inbound and delivery-event SNS topics (no extra queue invented)', () => {
  const t = synth();
  t.resourceCountIs('AWS::SNS::Topic', 2);
  t.hasResourceProperties('AWS::SNS::Topic', { TopicName: 'ThemisInboundMessaging' });
  t.hasResourceProperties('AWS::SNS::Topic', { TopicName: 'ThemisMessagingDeliveryEvents' });
  t.resourceCountIs('AWS::SQS::Queue', 0);
});

test('subscribes the normalizer Lambda to the inbound topic', () => {
  const t = synth();
  t.resourceCountIs('AWS::SNS::Subscription', 1);
  t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'lambda' });
});

test('routes ConfigurationSet events only to the delivery topic and never subscribes the normalizer', () => {
  const t = synth({ enableSmsFallback: true });
  const topics = t.findResources('AWS::SNS::Topic');
  const deliveryId = Object.entries(topics).find(([, topic]) =>
    topic.Properties.TopicName === 'ThemisMessagingDeliveryEvents')[0];
  const inboundId = Object.entries(topics).find(([, topic]) =>
    topic.Properties.TopicName === 'ThemisInboundMessaging')[0];
  const configs = t.findResources('AWS::SMSVOICE::ConfigurationSet');
  const [config] = Object.values(configs);
  const destination = config.Properties.EventDestinations[0].SnsDestination.TopicArn;
  assert.deepEqual(destination, { Ref: deliveryId });
  assert.notDeepEqual(destination, { Ref: inboundId });
  const subscriptions = t.findResources('AWS::SNS::Subscription');
  assert.equal(Object.values(subscriptions).some((sub) =>
    JSON.stringify(sub.Properties.TopicArn).includes(deliveryId)), false);
  t.hasResourceProperties('AWS::SNS::TopicPolicy', {
    PolicyDocument: Match.objectLike({ Statement: Match.arrayWith([Match.objectLike({
      Action: 'sns:Publish', Principal: { Service: 'sms-voice.amazonaws.com' }, Resource: { Ref: deliveryId },
    })]) }),
  });
  assert.ok(t.findOutputs('DeliveryEventTopicArn').DeliveryEventTopicArn);
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

test('provisions ConfigurationSet only for SMS and an inbound role for either channel', () => {
  const on = synth({ enableSmsFallback: true });
  on.resourceCountIs('AWS::SMSVOICE::ConfigurationSet', 1);

  const off = synth({ enableSmsFallback: false });
  off.resourceCountIs('AWS::SMSVOICE::ConfigurationSet', 0);
  off.resourceCountIs('AWS::SNS::TopicPolicy', 0);

  const rcsOnly = synth({ enableRcs: true, enableSmsFallback: false });
  assert.ok(rcsOnly.findOutputs('SmsTwoWayRoleArn').SmsTwoWayRoleArn);
});

test('inbound service role can publish to inbound topics but never the delivery-event topic', () => {
  const t = synth({ enableRcs: true, enableSmsFallback: true });
  const topics = t.findResources('AWS::SNS::Topic');
  const deliveryId = Object.entries(topics).find(([, topic]) =>
    topic.Properties.TopicName === 'ThemisMessagingDeliveryEvents')[0];
  const inboundIds = Object.entries(topics).filter(([, topic]) =>
    topic.Properties.TopicName !== 'ThemisMessagingDeliveryEvents').map(([id]) => id);
  const policies = t.findResources('AWS::IAM::Policy');
  const inboundPolicy = Object.values(policies).find((policy) =>
    JSON.stringify(policy.Properties.PolicyDocument).includes('sns:Publish'));
  const policyJson = JSON.stringify(inboundPolicy.Properties.PolicyDocument);
  for (const id of inboundIds) assert.ok(policyJson.includes(id), `missing inbound topic ${id}`);
  assert.equal(policyJson.includes(deliveryId), false);
});

test('does not provision a real phone number or pool (manual step, not reproducible in CDK)', () => {
  const t = synth();
  t.resourceCountIs('AWS::SMSVOICE::PhoneNumber', 0);
  t.resourceCountIs('AWS::SMSVOICE::Pool', 0);
});
