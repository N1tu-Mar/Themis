import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentRuntimeConsumer,
  AgentRuntimeInvocationError,
  CHOICES,
  createMessagingRuntime,
  DynamoActiveMenuStore,
  parseRuntimeEnvironment,
  type AgentRuntimeRequest,
  type Payload,
} from '../src/index.ts';

const time = '2026-09-20T14:00:00Z';
const customer = '+15555550123';
const rcsTopic = 'arn:aws:sns:us-east-1:123456789012:themis-rcs';
const smsTopic = 'arn:aws:sns:us-east-1:123456789012:themis-sms';
const agentArn = 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/ThemisOrchestrator';
const baseEnv = {
  THEMIS_MODE: 'aws',
  ENABLE_RCS: 'true',
  ENABLE_SMS_FALLBACK: 'false',
  THEMIS_RCS_TOPIC_ARN: rcsTopic,
  IDEMPOTENCY_TABLE: 'themis-messaging',
  AGENT_RUNTIME_ARN: agentArn,
};

function sns(topic: string, messageBody: unknown = 'Please help', inboundMessageId = 'in-runtime-1') {
  return { Records: [{
    EventSource: 'aws:sns',
    Sns: {
      TopicArn: topic,
      Timestamp: time,
      Message: JSON.stringify({ originationNumber: customer, inboundMessageId, messageBody }),
    },
  }] };
}

type Item = Record<string, unknown>;
function attributeKey(value: unknown): string {
  assert.ok(value && typeof value === 'object' && 'S' in value);
  return String((value as { S: unknown }).S);
}

function mockDynamo() {
  const items = new Map<string, Item>();
  const requests: Payload[] = [];
  return {
    items,
    requests,
    client: {
      async putItem(payload: Payload) {
        requests.push(payload);
        const item = payload.Item as Item;
        const key = attributeKey(item.idempotencyKey);
        if (payload.ConditionExpression && items.has(key)) {
          const error = new Error('duplicate');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        items.set(key, structuredClone(item));
        return {};
      },
      async updateItem(payload: Payload) {
        requests.push(payload);
        const key = attributeKey((payload.Key as Item).idempotencyKey);
        const item = items.get(key);
        assert.ok(item);
        item.state = { S: 'COMPLETED' };
        return {};
      },
      async getItem(payload: Payload) {
        requests.push(payload);
        const key = attributeKey((payload.Key as Item).idempotencyKey);
        return { Item: structuredClone(items.get(key)) };
      },
      async deleteItem(payload: Payload) {
        requests.push(payload);
        const key = attributeKey((payload.Key as Item).idempotencyKey);
        const item = items.get(key);
        const expectedCase = attributeKey((payload.ExpressionAttributeValues as Item)[':caseId']);
        if (!item || attributeKey(item.caseId) !== expectedCase) {
          const error = new Error('stale case');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        items.delete(key);
        return {};
      },
    },
  };
}

function assertDynamoPartitionKeys(requests: Payload[]) {
  for (const request of requests) {
    const container = (request.Item ?? request.Key) as Item;
    assert.ok(container.idempotencyKey, 'Dynamo request must use idempotencyKey partition key');
  }
}

test('complete trusted SNS flow normalizes and forwards only InboundMessage to AgentCore', async () => {
  const dynamo = mockDynamo();
  const invocations: AgentRuntimeRequest[] = [];
  const runtime = createMessagingRuntime(baseEnv, {
    dynamo: dynamo.client,
    agentRuntime: { invokeAgentRuntime: async request => { invocations.push(request); return {}; } },
  });

  assert.deepEqual(await runtime.handler(sns(rcsTopic)), ['processed']);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].agentRuntimeArn, agentArn);
  assert.equal(invocations[0].contentType, 'application/json');
  assert.ok(invocations[0].runtimeSessionId.length >= 33);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(invocations[0].payload)), {
    channel: 'RCS',
    customerExternalId: customer,
    messageId: 'in-runtime-1',
    text: 'Please help',
    postback: null,
    receivedAt: time,
  });
  assertDynamoPartitionKeys(dynamo.requests);
});

test('duplicate SNS delivery is admitted once across runtime compositions', async () => {
  const dynamo = mockDynamo();
  let calls = 0;
  const dependencies = {
    dynamo: dynamo.client,
    agentRuntime: { invokeAgentRuntime: async () => { calls++; } },
  };
  assert.deepEqual(await createMessagingRuntime(baseEnv, dependencies).handler(sns(rcsTopic)), ['processed']);
  assert.deepEqual(await createMessagingRuntime(baseEnv, dependencies).handler(sns(rcsTopic)), ['duplicate']);
  assert.equal(calls, 1);
});

test('active menu is recovered durably and stale case cleanup cannot remove its replacement', async () => {
  const dynamo = mockDynamo();
  const firstStore = new DynamoActiveMenuStore('themis-messaging', dynamo.client);
  await firstStore.set({ customerExternalId: customer, caseId: 'case-old', choices: CHOICES.slice(2, 5) });
  await firstStore.set({ customerExternalId: customer, caseId: 'case-current', choices: CHOICES.slice(2, 5) });
  assert.equal(await firstStore.clear(customer, 'case-old'), false);

  const messages: unknown[] = [];
  const env = {
    ...baseEnv,
    ENABLE_RCS: 'false',
    ENABLE_SMS_FALLBACK: 'true',
    THEMIS_RCS_TOPIC_ARN: undefined,
    THEMIS_SMS_TOPIC_ARN: smsTopic,
  };
  const recovered = createMessagingRuntime(env, {
    dynamo: dynamo.client,
    agentRuntime: { invokeAgentRuntime: async request => {
      messages.push(JSON.parse(new TextDecoder().decode(request.payload)));
    } },
  });
  assert.deepEqual(await recovered.handler(sns(smsTopic, '2', 'menu-reply-1')), ['processed']);
  assert.equal((messages[0] as { postback: string }).postback, 'DO_NOT_RECOGNIZE');
  assert.equal((await recovered.activeMenus.get(customer))?.caseId, 'case-current');
  assertDynamoPartitionKeys(dynamo.requests);
});

test('malformed and untrusted SNS input never reaches AgentCore', async () => {
  const dynamo = mockDynamo();
  let calls = 0;
  const runtime = createMessagingRuntime(baseEnv, {
    dynamo: dynamo.client,
    agentRuntime: { invokeAgentRuntime: async () => { calls++; } },
  });
  await assert.rejects(runtime.handler({ Records: [] as unknown[], extra: true }));
  await assert.rejects(runtime.handler(sns('arn:aws:sns:us-east-1:123456789012:untrusted')));
  await assert.rejects(runtime.handler({ Records: [{ EventSource: 'aws:sns', Sns: {
    TopicArn: rcsTopic, Timestamp: time, Message: '{not-json',
  } }] }));
  await assert.rejects(runtime.handler(sns(rcsTopic, null, 'bad-body')));
  await assert.rejects(runtime.handler({ Records: [{ EventSource: 'not-sns', Sns: {
    TopicArn: rcsTopic, Timestamp: time, Message: '{}',
  } }] }));
  assert.equal(calls, 0);
});

test('ambiguous runtime failure surfaces once and retains admission claim', async () => {
  const dynamo = mockDynamo();
  let calls = 0;
  const runtime = createMessagingRuntime(baseEnv, {
    dynamo: dynamo.client,
    agentRuntime: { invokeAgentRuntime: async () => { calls++; throw new Error('timeout after dispatch'); } },
  });
  await assert.rejects(runtime.handler(sns(rcsTopic)), AgentRuntimeInvocationError);
  assert.deepEqual(await runtime.handler(sns(rcsTopic)), ['duplicate']);
  assert.equal(calls, 1);
});

test('AgentCore consumer rejects unvalidated data before invoking its client', async () => {
  let calls = 0;
  const consumer = new AgentRuntimeConsumer(agentArn, { invokeAgentRuntime: async () => { calls++; } });
  await assert.rejects(consumer.consume({
    channel: 'RCS', customerExternalId: customer, messageId: 'id', text: 'hello', postback: null,
    receivedAt: time, unexpected: true,
  } as never));
  assert.equal(calls, 0);
});

test('runtime environment validation fails closed', () => {
  assert.deepEqual(parseRuntimeEnvironment(baseEnv).topics, { [rcsTopic]: 'RCS' });
  const invalid = [
    { ...baseEnv, THEMIS_MODE: 'local' },
    { ...baseEnv, IDEMPOTENCY_TABLE: '' },
    { ...baseEnv, AGENT_RUNTIME_ARN: 'not-an-arn' },
    { ...baseEnv, ENABLE_RCS: 'yes' },
    { ...baseEnv, ENABLE_RCS: 'false' },
    { ...baseEnv, THEMIS_RCS_TOPIC_ARN: 'not-an-arn' },
    { ...baseEnv, ENABLE_SMS_FALLBACK: 'true', THEMIS_SMS_TOPIC_ARN: rcsTopic },
  ];
  for (const env of invalid) assert.throws(() => parseRuntimeEnvironment(env));
  assert.equal(parseRuntimeEnvironment({ ...baseEnv, ACTIVE_MENU_TABLE: 'menus' }).activeMenuTable, 'menus');
});
