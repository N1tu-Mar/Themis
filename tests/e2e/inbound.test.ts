// Messaging-boundary reliability with a counting agent stub (no AWS, no Python): duplicate SNS delivery, agent
// (Bedrock/Runtime) failure, and outbound (End User Messaging) failure. Run: node --test tests/e2e/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AMBIGUOUS_RUNTIME_FAILURE_REPLY, createMessagingRuntime, type Payload } from '../../services/messaging/src/index.ts';

const smsTopic = 'arn:aws:sns:us-east-1:123456789012:themis-sms';
const env = {
  THEMIS_MODE: 'aws', ENABLE_RCS: 'false', ENABLE_SMS_FALLBACK: 'true', THEMIS_SMS_TOPIC_ARN: smsTopic,
  IDEMPOTENCY_TABLE: 'idem', AGENT_RUNTIME_ARN: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/ThemisOrchestrator',
  THEMIS_RCS_POOL_ID: 'pool-1', THEMIS_SMS_IDENTITY: '+15555550999',
};
const customer = '+15555550100';

function dynamo() {
  const items = new Map<string, Record<string, unknown>>();
  const key = (v: unknown) => String(((v as Record<string, Record<string, string>>).idempotencyKey).S);
  return {
    async putItem(p: Payload) {
      const k = key(p.Item);
      if (p.ConditionExpression && items.has(k)) throw Object.assign(new Error('dup'), { name: 'ConditionalCheckFailedException' });
      items.set(k, p.Item as Record<string, unknown>); return {};
    },
    async updateItem(p: Payload) { // SET #a = :a, ... with an optional `#state = :v` / `#state IN (...)` condition
      const item = items.get(key(p.Key)) as Record<string, unknown>;
      const names = (p.ExpressionAttributeNames ?? {}) as Record<string, string>;
      const vals = (p.ExpressionAttributeValues ?? {}) as Record<string, { S: string }>;
      const cond = String(p.ConditionExpression ?? '');
      if (cond) {
        const allowed = [...cond.matchAll(/:\w+/g)].map(m => vals[m[0]].S);
        if (!item || !allowed.includes((item.state as { S: string }).S)) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
      }
      for (const [, n, v] of String(p.UpdateExpression).matchAll(/(#\w+) = (:\w+)/g)) item[names[n]] = vals[v];
      return {};
    },
    async getItem(p: Payload) { return { Item: items.get(key(p.Key)) }; },
    async deleteItem(p: Payload) { items.delete(key(p.Key)); return {}; },
  };
}

function setup() {
  const s = { agentCalls: 0, agentFail: 0, sendFail: 0, outbound: [] as Payload[] };
  const runtime = createMessagingRuntime(env, {
    dynamo: dynamo(),
    agentRuntime: { invokeAgentRuntime: async () => {
      s.agentCalls++;
      if (s.agentFail-- > 0) throw new Error('bedrock throttled');
      return { reply: `reply-${s.agentCalls}`, status: 'RESOLVED', caseId: null };
    } },
    messagingClient: {
      sendTextMessage: async (payload) => {
        if (s.sendFail-- > 0) throw new Error('end user messaging unavailable');
        s.outbound.push(payload); return { MessageId: `sms-${s.outbound.length}` };
      },
      sendRcsMessage: async () => { throw new Error('unexpected RCS'); },
    },
  });
  const inbound = (id: string, text = '19.99 from ASTDIGITAL') => ({ Records: [{ EventSource: 'aws:sns', Sns: {
    TopicArn: smsTopic, Timestamp: '2026-09-20T14:00:00Z',
    Message: JSON.stringify({ originationNumber: customer, inboundMessageId: id, messageBody: text }) } }] });
  return { s, runtime, inbound };
}

test('duplicate inbound delivery: one agent turn, one reply', async () => {
  const { s, runtime, inbound } = setup();
  assert.deepEqual(await runtime.handler(inbound('dup-1')), ['processed']);
  assert.deepEqual(await runtime.handler(inbound('dup-1')), ['duplicate']);
  assert.deepEqual([s.agentCalls, s.outbound.length], [1, 1]);
});

test('concurrent duplicate deliveries: exactly one agent turn and one reply', async () => {
  const { s, runtime, inbound } = setup();
  const results = await Promise.allSettled([runtime.handler(inbound('dup-2')), runtime.handler(inbound('dup-2')), runtime.handler(inbound('dup-2'))]);
  assert.equal(s.agentCalls, 1);
  assert.equal(s.outbound.length, 1);
  assert.ok(results.some(r => r.status === 'fulfilled'));
});

test('distinct messages from one customer are both processed', async () => {
  const { s, runtime, inbound } = setup();
  await runtime.handler(inbound('m-1')); await runtime.handler(inbound('m-2', 'yes'));
  assert.deepEqual([s.agentCalls, s.outbound.length], [2, 2]);
});

// A failed invoke is ambiguous, so the admission claim is kept and one deterministic notice is sent.
// Redelivery must never replay the agent turn or double-send the notice.
test('agent failure: sends one safe notice and redelivery never replays the agent turn', async () => {
  const { s, runtime, inbound } = setup();
  s.agentFail = 1;
  assert.deepEqual(await runtime.handler(inbound('fail-1')), ['processed']);
  assert.deepEqual(await runtime.handler(inbound('fail-1')), ['duplicate']);
  assert.deepEqual([s.agentCalls, s.outbound.length], [1, 1]);
  assert.equal(s.outbound[0].MessageBody, AMBIGUOUS_RUNTIME_FAILURE_REPLY);
});

test('outbound failure: redelivery resends from the delivery record, once, without replaying the agent', async () => {
  const { s, runtime, inbound } = setup();
  s.sendFail = 1;
  await assert.rejects(runtime.handler(inbound('send-1')));
  assert.deepEqual([s.agentCalls, s.outbound.length], [1, 0]);
  assert.deepEqual(await runtime.handler(inbound('send-1')), ['duplicate']);
  assert.deepEqual(await runtime.handler(inbound('send-1')), ['duplicate']);
  assert.deepEqual([s.agentCalls, s.outbound.length], [1, 1]);
  assert.equal(s.outbound[0].MessageBody, 'reply-1');
});
