import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CaseSchema, CaseReportSchema } from '../../../packages/contracts/src/index.ts';
import { CHOICES, normalizeChoice, normalizeInbound, MemoryIdempotencyStore, InboundProcessor, createSnsHandler, messagingPayload, ChannelAdapter, caseEmail, SesAdapter, createMessaging, DeliveryError } from '../src/index.ts';
const time = '2026-09-17T20:00:00Z';
const payload = { originationNumber: '+15555550123', inboundMessageId: 'in-1', messageBody: "I don't recognize these charges." };
const menu = CHOICES.slice(2, 5);
const inbound = normalizeInbound(payload, 'RCS', time);
const outgoing = { channel: 'RCS' as const, customerExternalId: payload.originationNumber, messageId: 'out-1', caseId: 'case_001', text: 'Which applies?' };
const config = { rcsIdentity: 'pool-rcs', smsIdentity: '+15555550124' };
const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/cases/${name}.json`, import.meta.url), 'utf8'));
const c = CaseSchema.parse(load('cases')[0]);
const report = CaseReportSchema.parse(load('reports')[0]);
const emailInput = { case: c, report, recipient: 'customer@example.com', sender: 'cases@example.com', support: 'support@example.com', nextSteps: ['Reply with the requested information.'] };
test('RCS text maps to shared contract', () => assert.deepEqual(inbound, { channel: 'RCS', customerExternalId: payload.originationNumber, messageId: 'in-1', text: payload.messageBody, postback: null, receivedAt: time }));
test('SMS text equivalent and JSON-looking ordinary text are preserved', () => {
  assert.equal(normalizeInbound(payload, 'SMS', time).channel, 'SMS');
  assert.equal(normalizeInbound({ ...payload, messageBody: '{"hello":1}' }, 'RCS', time).text, '{"hello":1}');
});
test('SNS suggestion postback maps identically to active-menu SMS number and label', () => {
  const m = normalizeInbound({ ...payload, messageBody: JSON.stringify({ type: 'SUGGESTION', text: "I don't recognize this", postbackData: 'DO_NOT_RECOGNIZE' }) }, 'RCS', time);
  assert.equal(normalizeChoice(m, menu).postback, 'DO_NOT_RECOGNIZE');
  for (const text of ['2', "I don't recognize this", 'I don’t recognize this']) assert.equal(normalizeChoice({ ...inbound, channel: 'SMS', text }, menu).postback, m.postback);
  assert.equal(normalizeChoice({ ...inbound, text: '2' }).postback, null);
  assert.throws(() => normalizeChoice({ ...m, postback: 'UNKNOWN' }, menu));
});
test('invalid inbound payload fails before processing', () => {
  for (const patch of [{ inboundMessageId: '' }, { messageBody: null }, { originationNumber: '' }]) assert.throws(() => normalizeInbound({ ...payload, ...patch }, 'RCS', time));
  assert.throws(() => normalizeInbound(payload, 'SMS', 'invalid'));
});

test('oversized or malformed provider identity fields are rejected at ingress', () => {
  assert.throws(() => normalizeInbound({ originationNumber: '+15555550123', inboundMessageId: 'm', messageBody: 'x'.repeat(4001) }, 'SMS', time));
  assert.throws(() => normalizeInbound({ originationNumber: '15555550123', inboundMessageId: 'm', messageBody: 'hi' }, 'SMS', time));
  assert.throws(() => normalizeInbound({ originationNumber: '+15555550123', inboundMessageId: 'm'.repeat(257), messageBody: 'hi' }, 'SMS', time));
});
test('concurrent duplicate delivery invokes downstream once', async () => {
  let calls = 0;
  const processor = new InboundProcessor(new MemoryIdempotencyStore(), async () => { calls++; });
  assert.deepEqual(await Promise.all([processor.process(inbound), processor.process(inbound)]), ['processed', 'duplicate']);
  assert.equal(calls, 1);
});
test('partial downstream failure remains reserved and cannot repeat effects', async () => {
  let effects = 0;
  const processor = new InboundProcessor(new MemoryIdempotencyStore(), async () => { effects++; throw new Error('after effect'); });
  await assert.rejects(processor.process(inbound));
  assert.equal(await processor.process(inbound), 'duplicate');
  assert.equal(effects, 1);
});
test('SNS uses configured topic channel, provider ID and SNS timestamp; retries survive menu changes', async () => {
  const consumed: unknown[] = [];
  let choices = menu;
  const handler = createSnsHandler({ topics: { rcs: 'RCS', sms: 'SMS' }, processor: new InboundProcessor(new MemoryIdempotencyStore(), async m => { consumed.push(m); }), choicesFor: async () => choices });
  const record = { EventSource: 'aws:sns', Sns: { TopicArn: 'rcs', Timestamp: time, Message: JSON.stringify({ ...payload, messageBody: JSON.stringify({ type: 'SUGGESTION', text: 'Choice', postbackData: 'RECOGNIZE' }) }) } };
  assert.deepEqual(await handler({ Records: [record] }), ['processed']);
  choices = [];
  assert.deepEqual(await handler({ Records: [record] }), ['duplicate']);
  assert.equal(consumed.length, 1);
  await assert.rejects(handler({ Records: [{ ...record, Sns: { ...record.Sns, TopicArn: 'unknown' } }] }));
});
test('outbound plain text uses SendTextMessage', () => {
  const req = messagingPayload(outgoing, config);
  assert.equal(req.operation, 'sendTextMessage');
  assert.equal(req.payload.MessageBody, outgoing.text);
  assert.equal(req.payload.OriginationIdentity, config.rcsIdentity);
});
test('outbound choices use AWS Reply suggestions with complete SMS fallback', () => {
  const req = messagingPayload({ ...outgoing, suggestions: [...menu] }, config);
  assert.equal(req.operation, 'sendRcsMessage');
  assert.deepEqual(req.payload.RcsMessageContent.Suggestions[1], { Reply: { Text: menu[1].label, PostbackData: menu[1].postback } });
  assert.match(req.payload.FallbackConfiguration.MessageBody, /2 — I don't recognize this/);
  assert.equal(req.payload.FallbackConfiguration.OriginationIdentity, config.smsIdentity);
});
test('SMS-compatible choices retain the same menu numbering', () => {
  const req = messagingPayload({ ...outgoing, channel: 'SMS', suggestions: [...menu] }, config);
  assert.equal(req.operation, 'sendTextMessage');
  assert.match(req.payload.MessageBody, /1 — I recognize this\n2 — I don't recognize this\n3 — I canceled this/);
});
test('RCS and fallback limits reject before sending', () => {
  assert.throws(() => messagingPayload({ ...outgoing, text: 'x'.repeat(1601) }, config));
  assert.throws(() => messagingPayload({ ...outgoing, suggestions: [{ label: 'x'.repeat(26), postback: 'x' }] }, config));
});
test('SES payload includes structured facts, actions, next steps, support', () => {
  const p = caseEmail(emailInput);
  const body = p.Content.Simple.Body.Text.Data;
  for (const fact of [c.caseId, c.status, report.merchant!.canonicalName, c.totalDisputedAmount.toFixed(2), emailInput.support, emailInput.nextSteps[0], ...c.transactionIds, ...report.actionsTaken]) assert.ok(body.includes(fact), fact);
  assert.deepEqual(p.Destination.ToAddresses, [emailInput.recipient]);
});
test('SES rejects mismatched case/report, transaction total, or invented references', () => {
  assert.throws(() => caseEmail({ ...emailInput, report: { ...report, caseId: 'wrong' } }));
  assert.throws(() => caseEmail({ ...emailInput, report: { ...report, transactions: [] } }));
  assert.throws(() => caseEmail({ ...emailInput, report: { ...report, transactions: report.transactions.map(t => ({ ...t, amount: t.amount + 1 })) } }));
});
test('SES mocked send returns accepted AWS message ID', async () => {
  let sent: unknown;
  const adapter = new SesAdapter('aws', { sendEmail: async p => { sent = p; return { MessageId: 'ses-1' }; } });
  assert.equal(await adapter.send(emailInput), 'ses-1');
  assert.deepEqual(sent, caseEmail(emailInput));
});
test('channel delivery failures surface without speculative SMS resend', async () => {
  let sends = 0;
  const adapter = new ChannelAdapter({ mode: 'aws', ...config }, { sendTextMessage: async () => { sends++; throw new Error('timeout'); }, sendRcsMessage: async () => { throw new Error('timeout'); } });
  await assert.rejects(adapter.send(outgoing), DeliveryError);
  assert.equal(sends, 1);
  await assert.rejects(new SesAdapter('aws', { sendEmail: async () => ({}) }).send(emailInput), DeliveryError);
});
test('AWS messaging routes through injected API clients', async () => {
  const calls: string[] = [];
  const adapter = new ChannelAdapter({ mode: 'aws', ...config }, { sendTextMessage: async () => { calls.push('text'); return { MessageId: 'aws-text' }; }, sendRcsMessage: async () => { calls.push('rcs'); return { MessageId: 'aws-rcs' }; } });
  assert.equal(await adapter.send(outgoing), 'aws-text');
  assert.equal(await adapter.send({ ...outgoing, suggestions: [...menu] }), 'aws-rcs');
  assert.deepEqual(calls, ['text', 'rcs']);
});
test('local mode captures payloads and fake inbound with zero paid calls', async () => {
  let received = 0;
  const fail = async () => { throw new Error('Must never call AWS'); };
  const runtime = createMessaging({ env: { THEMIS_MODE: 'local' }, consume: async () => { received++; }, messagingClient: { sendTextMessage: fail, sendRcsMessage: fail }, sesClient: { sendEmail: fail } });
  await runtime.inbound.process(inbound);
  await runtime.channel.send(outgoing);
  await runtime.channel.send({ ...outgoing, channel: 'SMS', suggestions: [...menu] });
  await runtime.channel.send({ ...outgoing, suggestions: [...menu] });
  await runtime.email.send(emailInput);
  assert.equal(received, 1);
  assert.equal(runtime.channel.captured.length, 3);
  assert.equal(runtime.email.captured.length, 1);
});
test('AWS mode fails closed without clients, identities and durable store', () => {
  assert.throws(() => createMessaging({ env: { THEMIS_MODE: 'aws' }, consume: async () => {} }));
  assert.throws(() => createMessaging({ env: { THEMIS_MODE: 'typo' }, consume: async () => {} }));
});
test('durable Dynamo claims survive worker instances; only conditional conflicts are duplicates', async () => {
  const { DynamoIdempotencyStore } = await import('../src/idempotency.ts');
  const items = new Map<string, unknown>();
  const client = {
    putItem: async (p: Record<string, unknown>) => {
      assert.equal(p.ConditionExpression, 'attribute_not_exists(idempotencyKey)');
      const key = JSON.stringify((p.Item as { idempotencyKey: unknown }).idempotencyKey);
      if (items.has(key)) { const error = new Error('duplicate'); error.name = 'ConditionalCheckFailedException'; throw error; }
      items.set(key, p.Item);
    },
    updateItem: async (p: Record<string, unknown>) => { assert.equal(p.ConditionExpression, '#state = :processing'); },
  };
  const first = new DynamoIdempotencyStore('messages', client);
  const second = new DynamoIdempotencyStore('messages', client);
  assert.equal(await first.claim('customer:id'), true);
  await first.complete('customer:id');
  assert.equal(await second.claim('customer:id'), false);
  await assert.rejects(new DynamoIdempotencyStore('messages', { ...client, putItem: async () => { throw new Error('network'); } }).claim('id'));
});
test('all canonical customer choices have identical RCS and textual intent mapping', () => {
  for (const [i, choice] of CHOICES.entries()) {
    assert.equal(normalizeChoice({ ...inbound, text: String(i + 1) }, CHOICES).postback, choice.postback);
    assert.equal(normalizeChoice({ ...inbound, text: choice.label }, CHOICES).postback, choice.postback);
    assert.equal(normalizeChoice({ ...inbound, text: '', postback: choice.postback }, CHOICES).postback, choice.postback);
  }
});
