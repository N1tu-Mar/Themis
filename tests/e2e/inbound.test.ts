// Messaging-boundary reliability with a counting agent stub (no AWS, no Python): duplicate SNS delivery, agent
// (Bedrock/Runtime) failure, and outbound (End User Messaging) failure. Run: node --test tests/e2e/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AMBIGUOUS_RUNTIME_FAILURE_REPLY, createMessagingRuntime, createReconciler, type Payload } from '../../services/messaging/src/index.ts';
import { fakeDynamo } from '../../services/messaging/tests/fake-dynamo.ts';

const smsTopic = 'arn:aws:sns:us-east-1:123456789012:themis-sms';
const env = {
  THEMIS_MODE: 'aws', ENABLE_RCS: 'false', ENABLE_SMS_FALLBACK: 'true', THEMIS_SMS_TOPIC_ARN: smsTopic,
  IDEMPOTENCY_TABLE: 'idem', AGENT_RUNTIME_ARN: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/ThemisOrchestrator',
  THEMIS_RCS_POOL_ID: 'pool-1', THEMIS_SMS_IDENTITY: '+15555550999',
};
const customer = '+15555550100';

function setup() {
  const s = { agentCalls: 0, agentFail: 0, sendFail: 0, outbound: [] as Payload[] };
  const db = fakeDynamo().client;
  const messagingClient = {
    sendTextMessage: async (payload: Payload) => {
      if (s.sendFail-- > 0) throw new Error('end user messaging unavailable');
      s.outbound.push(payload); return { MessageId: `sms-${s.outbound.length}` };
    },
    sendRcsMessage: async () => { throw new Error('unexpected RCS'); },
  };
  const runtime = createMessagingRuntime(env, {
    dynamo: db,
    agentRuntime: { invokeAgentRuntime: async () => {
      s.agentCalls++;
      if (s.agentFail-- > 0) throw new Error('bedrock throttled');
      return { reply: `reply-${s.agentCalls}`, status: 'RESOLVED', caseId: null };
    } },
    messagingClient,
  });
  const inbound = (id: string, text = '19.99 from ASTDIGITAL') => ({ Records: [{ EventSource: 'aws:sns', Sns: {
    TopicArn: smsTopic, Timestamp: '2026-09-20T14:00:00Z',
    Message: JSON.stringify({ originationNumber: customer, inboundMessageId: id, messageBody: text }) } }] });
  const reconcile = (afterMs: number) => createReconciler(env, { dynamo: db, messagingClient, owner: 'e2e', log: () => {},
    now: () => new Date(Date.now() + afterMs) }).run();
  return { s, runtime, inbound, reconcile };
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

test('reconciler: a reply whose send outlived SNS redelivery is resumed from its record once; agent never replayed', async () => {
  const { s, runtime, inbound, reconcile } = setup();
  s.sendFail = 1;
  await assert.rejects(runtime.handler(inbound('stuck-1')), /Delivery failed/);
  assert.deepEqual([s.agentCalls, s.outbound.length], [1, 0]);
  assert.equal((await reconcile(0)).scanned, 0, 'fresh claim is left to normal SNS redelivery');
  assert.equal((await reconcile(10 * 60_000)).completed, 1);
  assert.deepEqual([s.agentCalls, s.outbound.length], [1, 1]);
  assert.equal(s.outbound[0].MessageBody, 'reply-1');
  assert.equal((await reconcile(20 * 60_000)).scanned, 0);
  assert.deepEqual(await runtime.handler(inbound('stuck-1')), ['duplicate']);
  assert.deepEqual([s.agentCalls, s.outbound.length], [1, 1]);
});
