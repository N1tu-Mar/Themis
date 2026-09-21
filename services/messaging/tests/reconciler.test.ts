import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIGUOUS_RUNTIME_FAILURE_REPLY, InboundProcessor, MemoryIdempotencyStore, createMessagingRuntime, createReconciler, reconcileClaims,
  type Payload,
} from '../src/index.ts';
import { fakeDynamo } from './fake-dynamo.ts';

const customer = '+15555550123';
const smsTopic = 'arn:aws:sns:us-east-1:123456789012:themis-sms';
const env = {
  THEMIS_MODE: 'aws', ENABLE_RCS: 'false', ENABLE_SMS_FALLBACK: 'true', THEMIS_SMS_TOPIC_ARN: smsTopic,
  IDEMPOTENCY_TABLE: 'themis-messaging',
  AGENT_RUNTIME_ARN: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/ThemisOrchestrator',
  THEMIS_RCS_POOL_ID: 'pool-1', THEMIS_SMS_IDENTITY: '+15555550999',
};
const AGENT_REPLY = 'Your card is frozen and case 42 is open.';

function setup(opts: { agent?: 'ok' | 'timeout'; failRecord?: boolean; failText?: () => boolean } = {}) {
  const dynamo = fakeDynamo();
  const calls = { agent: 0, text: [] as Payload[] };
  let failRecord = opts.failRecord ?? false;
  const client = { ...dynamo.client,
    async putItem(p: Payload) {
      if (failRecord && (p.Item as Record<string, { S: string }>).recordType?.S === 'DELIVERY') throw new Error('lambda died before delivery record');
      return dynamo.client.putItem(p);
    } };
  const messagingClient = {
    sendTextMessage: async (p: Payload) => {
      calls.text.push(p);
      if (opts.failText?.()) throw new Error('transport down');
      return { MessageId: `sms-${calls.text.length}` };
    },
    sendRcsMessage: async () => ({ MessageId: 'rcs' }),
  };
  const rt = createMessagingRuntime(env, { dynamo: client, messagingClient,
    agentRuntime: { invokeAgentRuntime: async () => {
      calls.agent++;
      if (opts.agent === 'timeout') throw new Error('timeout after dispatch');
      return { reply: AGENT_REPLY, status: 'OPEN', caseId: 'case-42' };
    } } });
  const logs: Record<string, unknown>[] = [];
  let offsetMs = 0;
  const reconciler = (extra: Record<string, string> = {}, owner = 'worker-a') => createReconciler({ ...env, ...extra }, {
    dynamo: client, messagingClient, owner, log: e => logs.push(e), now: () => new Date(Date.now() + offsetMs) });
  const inbound = (id: string) => ({ Records: [{ EventSource: 'aws:sns', Sns: { TopicArn: smsTopic, Timestamp: '2026-09-21T10:00:00Z',
    Message: JSON.stringify({ originationNumber: customer, inboundMessageId: id, messageBody: 'secret card question' }) } }] });
  const claims = () => [...dynamo.items.values()].filter(i => i.state && !i.recordType);
  return { dynamo, calls, rt, logs, reconciler, inbound, claims, advance: (ms: number) => { offsetMs += ms; }, fixRecord: () => { failRecord = false; } };
}
const TEN_MIN = 10 * 60_000;

test('crash before delivery record: one notice, claim to REVIEW, AgentCore never re-run, repeat is a no-op', async () => {
  const t = setup({ failRecord: true });
  await assert.rejects(t.rt.handler(t.inbound('in-1')), /before delivery record/);
  assert.equal(t.calls.agent, 1);
  assert.equal(t.claims()[0].state.S, 'PROCESSING');
  t.fixRecord();
  t.advance(TEN_MIN);
  const first = await t.reconciler().run();
  assert.deepEqual([first.review, first.completed, first.quarantined], [1, 0, 0]);
  assert.equal(t.calls.text.length, 1);
  assert.equal(t.calls.text[0].MessageBody, AMBIGUOUS_RUNTIME_FAILURE_REPLY);
  assert.equal(t.claims()[0].state.S, 'REVIEW');
  assert.equal(t.claims()[0].reason.S, 'NO_REPLY_RECORD');
  const again = await t.reconciler().run();
  assert.equal(again.scanned, 0);
  // SNS redelivery after reconciliation: still no agent replay, no second send.
  assert.deepEqual(await t.rt.handler(t.inbound('in-1')), ['duplicate']);
  assert.equal(t.calls.agent, 1);
  assert.equal(t.calls.text.length, 1);
  assert.equal(t.claims()[0].state.S, 'REVIEW', 'duplicate resume never reopens or completes a REVIEW claim');
});

test('ambiguous AgentCore failure whose notice send failed: resumed from the record, REVIEW, agent run once', async () => {
  let down = true;
  const t = setup({ agent: 'timeout', failText: () => down });
  await assert.rejects(t.rt.handler(t.inbound('in-1')), /Delivery failed/);
  down = false;
  t.advance(TEN_MIN);
  const summary = await t.reconciler().run();
  assert.equal(summary.review, 1);
  assert.equal(t.claims()[0].reason.S, 'AMBIGUOUS_AGENT_FAILURE');
  assert.equal(t.calls.agent, 1);
  assert.equal(t.calls.text.length, 2, 'one failed attempt + one resumed send');
  assert.equal(t.calls.text[1].MessageBody, AMBIGUOUS_RUNTIME_FAILURE_REPLY);
});

test('crash after delivery record: recorded agent reply is resumed verbatim and the claim completes', async () => {
  let down = true;
  const t = setup({ failText: () => down });
  await assert.rejects(t.rt.handler(t.inbound('in-1')), /Delivery failed/);
  down = false;
  t.advance(TEN_MIN);
  const summary = await t.reconciler().run();
  assert.deepEqual([summary.completed, summary.review], [1, 0]);
  assert.match(String(t.calls.text[1].MessageBody), /case 42/);
  assert.equal(t.calls.agent, 1);
  assert.equal(t.claims()[0].state.S, 'COMPLETED');
  assert.equal(t.claims()[0].claimState, undefined, 'completed claims leave the sparse index');
});

test('concurrent reconciler workers: exactly one acts, the other sees a lease conflict', async () => {
  const t = setup({ failRecord: true });
  await assert.rejects(t.rt.handler(t.inbound('in-1')));
  t.fixRecord();
  t.advance(TEN_MIN);
  const [a, b] = await Promise.all([t.reconciler({}, 'worker-a').run(), t.reconciler({}, 'worker-b').run()]);
  assert.equal(a.review + b.review, 1);
  assert.equal(a.contended + b.contended, 1);
  assert.equal(t.calls.text.length, 1, 'one customer notice');
});

test('fresh claims are left alone; stale ones are processed; completed claims never listed', async () => {
  const t = setup({ failRecord: true });
  await assert.rejects(t.rt.handler(t.inbound('stuck')));
  t.fixRecord();
  await t.rt.handler(t.inbound('fine'));
  assert.equal(t.claims().filter(c => c.state.S === 'COMPLETED').length, 1);
  assert.equal((await t.reconciler().run()).scanned, 0, 'fresh');
  t.advance(TEN_MIN);
  const summary = await t.reconciler().run();
  assert.equal(summary.scanned, 1, 'only the stuck claim, not the COMPLETED one');
  assert.equal(t.calls.text.length, 2, 'the completed message got its own reply; the stuck one got one notice');
});

test('batch size and runtime budget bound a run', async () => {
  const t = setup({ failRecord: true });
  for (const id of ['a', 'b', 'c']) await assert.rejects(t.rt.handler(t.inbound(id)));
  t.fixRecord();
  t.advance(TEN_MIN);
  assert.equal((await t.reconciler({ RECONCILE_BATCH_SIZE: '2' }).run()).scanned, 2);
  const r = t.reconciler({ RECONCILE_BUDGET_SECONDS: '5' });
  let tick = 0;
  const summary = await reconcileClaims({ ...r.options, now: () => new Date(Date.now() + TEN_MIN + (tick++) * 6_000) });
  assert.deepEqual([summary.scanned, summary.deferred], [0, 1], 'budget exhausted before the next claim starts');
});

test('repeated transient failures retry under a lease backoff, then quarantine; notice never duplicated once sent', async () => {
  const t = setup({ failRecord: true, failText: () => true });
  await assert.rejects(t.rt.handler(t.inbound('in-1')));
  t.fixRecord();
  t.advance(TEN_MIN);
  const outcomes: string[] = [];
  for (let i = 0; i < 5; i++) {
    const s = await t.reconciler().run();
    outcomes.push(`${s.retry}${s.quarantined}${s.contended}`);
    if (i === 0) assert.equal((await t.reconciler().run()).contended, 1, 'lease is the backoff: an immediate rerun skips it');
    t.advance(5 * 60_000);
  }
  assert.deepEqual(outcomes, ['100', '100', '100', '010', '000']);
  assert.equal(t.claims()[0].state.S, 'QUARANTINED');
  assert.equal(t.claims()[0].reason.S, 'RETRIES_EXHAUSTED');
  assert.equal(t.calls.agent, 1);
});

test('claim without identity (legacy) is quarantined, never guessed at', async () => {
  const t = setup();
  t.dynamo.items.set('legacy', { idempotencyKey: { S: 'legacy' }, state: { S: 'PROCESSING' }, claimState: { S: 'PROCESSING' }, claimedAt: { S: '2020-01-01T00:00:00.000Z' } });
  const summary = await t.reconciler().run();
  assert.equal(summary.quarantined, 1);
  assert.equal(t.dynamo.items.get('legacy')!.reason.S, 'MISSING_IDENTITY');
  assert.equal(t.calls.text.length, 0);
});

test('logs and metrics carry no customer number or message content', async () => {
  const t = setup({ failRecord: true });
  await assert.rejects(t.rt.handler(t.inbound('in-1')));
  t.fixRecord();
  t.advance(TEN_MIN);
  await t.reconciler().run();
  const text = JSON.stringify(t.logs);
  assert.ok(t.logs.some(l => l.event === 'claim_reconciled') && t.logs.some(l => '_aws' in l));
  for (const secret of [customer, 'secret card question', AGENT_REPLY, 'in-1']) assert.ok(!text.includes(secret), `leaked ${secret}`);
});

test('conditional conflicts: stale owner cannot finish, and a late original complete cannot undo REVIEW', async () => {
  let now = new Date('2026-09-21T10:00:00Z');
  const store = new MemoryIdempotencyStore(() => now);
  await store.claim('k');
  now = new Date(now.getTime() + TEN_MIN);
  assert.ok(await store.lease('k', 'a', now, 60_000));
  assert.equal(await store.lease('k', 'b', now, 60_000), null, 'held');
  now = new Date(now.getTime() + 61_000);
  assert.equal((await store.lease('k', 'b', now, 60_000))?.attempts, 2, 'expired lease is takeable');
  assert.equal(await store.finish('k', 'a', 'COMPLETED', 'x'), false, 'lost lease');
  assert.equal(await store.finish('k', 'b', 'REVIEW', 'x'), true);
  assert.equal(await store.finish('k', 'b', 'COMPLETED', 'x'), false, 'already moved');
  await assert.rejects(store.complete('k'), { name: 'ConditionalCheckFailedException' });
  // The processor treats that lost race as success: the reconciler already owns the outcome.
  const racing = new MemoryIdempotencyStore(() => now);
  const processor = new InboundProcessor(racing, async m => {
    const key = JSON.stringify([m.customerExternalId, m.messageId]);
    await racing.lease(key, 'r', new Date(now.getTime() + TEN_MIN), 1);
    await racing.finish(key, 'r', 'REVIEW', 'x');
  });
  const message = { channel: 'SMS' as const, customerExternalId: customer, messageId: 'm1', text: 'hi', postback: null, receivedAt: '2026-09-21T10:00:00Z' };
  assert.equal(await processor.process(message), 'processed');
  assert.equal(racing.states.get(JSON.stringify([customer, 'm1'])), 'REVIEW');
});

test('reconciler environment bounds are enforced', () => {
  const t = setup();
  assert.throws(() => t.reconciler({ RECONCILE_BATCH_SIZE: '1000' }), /RECONCILE_BATCH_SIZE/);
  assert.throws(() => t.reconciler({ RECONCILE_STALE_SECONDS: '5' }), /RECONCILE_STALE_SECONDS/);
});
