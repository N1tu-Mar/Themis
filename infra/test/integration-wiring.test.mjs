import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
  return {
    data: Template.fromStack(data), agent: Template.fromStack(agent), messaging: Template.fromStack(messaging),
  };
}

function exportForRef(template, logicalId, attribute) {
  const expected = attribute ? { 'Fn::GetAtt': [logicalId, attribute] } : { Ref: logicalId };
  return Object.values(template.findOutputs('*')).find((output) =>
    JSON.stringify(output.Value) === JSON.stringify(expected) && output.Export)?.Export.Name;
}

test('tools adapter is the staged real asset and can invoke messaging', () => {
  const { agent } = synth();
  for (const f of ['handler.py', 'router.py', 'bank_tools', 'merchant_intel', 'orchestrator', 'merchant-profiles.json', 'schemas.json']) {
    assert.ok(existsSync(new URL(`../build/tools-adapter/${f}`, import.meta.url)), f);
  }
  agent.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'ThemisToolsAdapter',
    Environment: { Variables: Match.objectLike({
      THEMIS_MODE: 'aws', MESSAGING_FUNCTION_NAME: 'ThemisMessageNormalizer', IDEMPOTENCY_TABLE: Match.anyValue(),
      MERCHANTS_TABLE: Match.anyValue(), ARTIFACTS_BUCKET: Match.anyValue(),
    }) },
  });
  agent.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: Match.objectLike({ Statement: Match.arrayWith([Match.objectLike({ Action: 'lambda:InvokeFunction' })]) }),
  });
});

test('runtime asset has the entry point the CFN runtime config names', () => {
  for (const f of ['src/orchestrator/main.py', 'src/bank_tools/__init__.py', 'src/merchant_intel/__init__.py',
    'src/schemas.json', 'customers.json', 'merchant-profiles.json']) {
    assert.ok(existsSync(new URL(`../build/agent-runtime/${f}`, import.meta.url)), f);
  }
});

test('staged tool router accepts the same new optional arguments as the Gateway', () => {
  const build = new URL('../build/tools-adapter', import.meta.url);
  const raw = execFileSync('python3', ['-c', [
    'import json, router',
    'from bank_tools.dispatch import SPECS',
    's={**SPECS,**router.build_specs(None,None,None)}',
    'print(json.dumps({n:[p.camel for p in s[n].params] for n in ("update_case","escalate_case")}))',
  ].join(';')], { encoding: 'utf8', env: {
    ...process.env, PYTHONPATH: build.pathname, PYTHONDONTWRITEBYTECODE: '1',
  } });
  assert.deepEqual(JSON.parse(raw), {
    update_case: ['caseId', 'status', 'claimType', 'merchantId', 'confidence', 'requiresHumanReview', 'outcome', 'idempotencyKey'],
    escalate_case: ['caseId', 'reason', 'summary', 'evidenceRefs', 'idempotencyKey'],
  });
});

test('staged merchant-intel DynamoProfileStore round-trips cache metadata and case state', () => {
  const build = new URL('../build/tools-adapter', import.meta.url);
  const script = `
from datetime import UTC, datetime, timedelta
from merchant_intel import CacheRecord, DynamoProfileStore

class FakeDynamo:
    def __init__(self): self.items = {}
    def get_item(self, **request):
        key = request["Key"]["merchantId"]["S"]
        return {"Item": self.items[key]} if key in self.items else {}
    def put_item(self, **request):
        self.items[request["Item"]["merchantId"]["S"]] = request["Item"]
    def scan(self, **request):
        prefix = request["ExpressionAttributeValues"][":p"]["S"]
        return {"Items": [item for key, item in self.items.items() if key.startswith(prefix)]}

client = FakeDynamo()
store = DynamoProfileStore(client, "ThemisMerchants")
now = datetime(2026, 9, 20, tzinfo=UTC)
profile = {"merchantId": "merchant_1", "canonicalName": "Merchant One", "aliases": ["M1"]}
record = CacheRecord(profile, now, now + timedelta(days=7), 3, "research", {"case_1": "OPEN"})
store.put(record)
loaded = store.get("merchant_1")
assert loaded.profile == record.profile and loaded.version == 3 and loaded.source_summary == "research"
assert loaded.case_states == {"case_1": "OPEN"} and store.all()[0].expires_at == record.expires_at
`;
  execFileSync('python3', ['-c', script], {
    encoding: 'utf8', env: {
      ...process.env, PYTHONPATH: build.pathname, PYTHONDONTWRITEBYTECODE: '1',
    },
  });
});

test('messaging Lambda is the Node bundle with the env the runtime composition requires', () => {
  const { messaging } = synth({ enableRcs: true, enableSmsFallback: true });
  messaging.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'ThemisMessageNormalizer', Runtime: 'nodejs22.x', Handler: 'index.handler',
    Environment: { Variables: Match.objectLike({
      THEMIS_MODE: 'aws', THEMIS_RCS_TOPIC_ARN: Match.anyValue(), THEMIS_SMS_TOPIC_ARN: Match.anyValue(),
      THEMIS_DELIVERY_EVENT_TOPIC_ARN: Match.anyValue(), THEMIS_RCS_POOL_ID: Match.anyValue(),
      THEMIS_SES_FROM: Match.anyValue(), AGENT_RUNTIME_ARN: Match.anyValue() }) },
  });
  messaging.resourceCountIs('AWS::SNS::Topic', 3); // distinct RCS, SMS, and delivery telemetry topics
  messaging.resourceCountIs('AWS::SNS::Subscription', 3);
});

test('runtime, Gateway, Memory, messaging, tables and S3 use the same synthesized references', () => {
  const { data, agent, messaging } = synth({ enableRcs: true, enableSmsFallback: true });
  const dataResources = data.toJSON().Resources;
  const tableIds = Object.fromEntries(Object.entries(dataResources)
    .filter(([, resource]) => resource.Type === 'AWS::DynamoDB::Table')
    .map(([id, resource]) => [resource.Properties.TableName, id]));
  const [bucketId] = Object.entries(dataResources).find(([, resource]) => resource.Type === 'AWS::S3::Bucket');

  const agentResources = agent.toJSON().Resources;
  const adapter = Object.values(agentResources).find((resource) =>
    resource.Type === 'AWS::Lambda::Function' && resource.Properties.FunctionName === 'ThemisToolsAdapter');
  const adapterEnv = adapter.Properties.Environment.Variables;
  const bindings = {
    TRANSACTIONS_TABLE: tableIds.ThemisTransactions,
    CASES_TABLE: tableIds.ThemisCases,
    MERCHANTS_TABLE: tableIds.ThemisMerchants,
    AUDIT_TABLE: tableIds.ThemisAudit,
    IDEMPOTENCY_TABLE: tableIds.ThemisIdempotency,
    ARTIFACTS_BUCKET: bucketId,
  };
  for (const [name, logicalId] of Object.entries(bindings)) {
    assert.equal(adapterEnv[name]['Fn::ImportValue'], exportForRef(data, logicalId), name);
  }
  const [gatewayId] = Object.entries(agentResources).find(([, resource]) =>
    resource.Type === 'AWS::BedrockAgentCore::Gateway');
  const [memoryId] = Object.entries(agentResources).find(([, resource]) =>
    resource.Type === 'AWS::BedrockAgentCore::Memory');
  const [runtimeId, runtime] = Object.entries(agentResources).find(([, resource]) =>
    resource.Type === 'AWS::BedrockAgentCore::Runtime');
  assert.deepEqual(runtime.Properties.EnvironmentVariables.GATEWAY_IDENTIFIER,
    { 'Fn::GetAtt': [gatewayId, 'GatewayIdentifier'] });
  assert.deepEqual(runtime.Properties.EnvironmentVariables.GATEWAY_URL,
    { 'Fn::GetAtt': [gatewayId, 'GatewayUrl'] });
  assert.deepEqual(runtime.Properties.EnvironmentVariables.MEMORY_ID,
    { 'Fn::GetAtt': [memoryId, 'MemoryId'] });
  assert.equal(runtime.Properties.EnvironmentVariables.THEMIS_STRUCTURED_TOOLS, 'true');

  const messagingResources = messaging.toJSON().Resources;
  const normalizer = Object.values(messagingResources).find((resource) =>
    resource.Type === 'AWS::Lambda::Function' && resource.Properties.FunctionName === 'ThemisMessageNormalizer');
  assert.equal(normalizer.Properties.Environment.Variables.AGENT_RUNTIME_ARN['Fn::ImportValue'],
    exportForRef(agent, runtimeId, 'AgentRuntimeArn'));
  assert.equal(normalizer.Properties.Environment.Variables.IDEMPOTENCY_TABLE['Fn::ImportValue'],
    exportForRef(data, tableIds.ThemisIdempotency));
  assert.ok(normalizer.Properties.Environment.Variables.THEMIS_DELIVERY_EVENT_TOPIC_ARN);
});
