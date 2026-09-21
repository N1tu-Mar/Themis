import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHOICES, DynamoDeliveryStore, MemoryActiveMenuStore, MemoryIdempotencyStore, createMessagingRuntime,
  parseSuggestions, type Payload,
} from '../src/index.ts';

const time = '2026-09-20T14:00:00Z';
const customer = '+15555550123';
const rcsTopic = 'arn:aws:sns:us-east-1:123456789012:themis-rcs';
const smsTopic = 'arn:aws:sns:us-east-1:123456789012:themis-sms';
const eventTopic = 'arn:aws:sns:us-east-1:123456789012:themis-delivery';
const env = {
  THEMIS_MODE: 'aws', ENABLE_RCS: 'true', ENABLE_SMS_FALLBACK: 'true',
  THEMIS_RCS_TOPIC_ARN: rcsTopic, THEMIS_SMS_TOPIC_ARN: smsTopic, THEMIS_DELIVERY_EVENT_TOPIC_ARN: eventTopic,
  IDEMPOTENCY_TABLE: 'themis-messaging',
  AGENT_RUNTIME_ARN: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/ThemisOrchestrator',
  THEMIS_RCS_POOL_ID: 'pool-1', THEMIS_SMS_IDENTITY: '+15555550999', THEMIS_SES_FROM: 'cases@themis.example', THEMIS_SUPPORT: 'help@themis.example',
};
const menuChoices = CHOICES.slice(2, 5);

type Item = Record<string, { S: string } & Record<string, unknown>>;
const conditionFailed = () => Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' });
const keyOf = (value: unknown) => (value as { idempotencyKey: { S: string } }).idempotencyKey.S;

/** Minimal DynamoDB double: honours the exact conditions the stores emit. */
function fakeDynamo() {
  const items = new Map<string, Item>();
  return {
    items,
    client: {
      async putItem(p: Payload) {
        const key = keyOf(p.Item);
        if (p.ConditionExpression && items.has(key)) throw conditionFailed();
        items.set(key, structuredClone(p.Item) as Item);
        return {};
      },
      async getItem(p: Payload) { return { Item: structuredClone(items.get(keyOf(p.Key))) }; },
      async updateItem(p: Payload) {
        const item = items.get(keyOf(p.Key));
        const values = p.ExpressionAttributeValues as Record<string, { S: string }>;
        const names = p.ExpressionAttributeNames as Record<string, string>;
        const condition = p.ConditionExpression as string;
        if (!item) throw conditionFailed();
        if (condition.includes('IN') && ![':open0', ':open1', ':open2'].some(v => values[v].S === item.state.S)) throw conditionFailed();
        if (condition.includes(':processing') && item.state.S !== 'PROCESSING') throw conditionFailed();
        for (const assignment of (p.UpdateExpression as string).slice(4).split(', ')) {
          const [name, value] = assignment.split(' = ');
          item[names[name]] = values[value] as never;
        }
        return {};
      },
      async deleteItem(p: Payload) {
        const key = keyOf(p.Key);
        const item = items.get(key);
        const values = p.ExpressionAttributeValues as Record<string, { S: string }>;
        if (!item || item.caseId.S !== values[':caseId'].S || (values[':menuId'] && item.menuId.S !== values[':menuId'].S)) throw conditionFailed();
        items.delete(key);
        return {};
      },
    },
  };
}

function setup(options: { reply?: unknown; failText?: () => boolean; failSes?: () => boolean } = {}) {
  const dynamo = fakeDynamo();
  const calls = { agent: 0, text: [] as Payload[], rcs: [] as Payload[], ses: 0, payloads: [] as { postback: string | null }[], menuPresentAtRcsSend: false };
  let reply: unknown = options.reply;
  const rt = createMessagingRuntime(env, {
    dynamo: dynamo.client,
    agentRuntime: { invokeAgentRuntime: async (request) => { calls.agent++; calls.payloads.push(JSON.parse(new TextDecoder().decode(request.payload))); return reply; } },
    messagingClient: {
      sendTextMessage: async (p) => {
        calls.text.push(p);
        if (options.failText?.()) throw new Error('transport down');
        return { MessageId: `sms-${calls.text.length}` };
      },
      sendRcsMessage: async (p) => {
        calls.menuPresentAtRcsSend = [...dynamo.items.values()].some(i => i.recordType?.S === 'ACTIVE_MENU');
        calls.rcs.push(p); return { MessageId: `rcs-${calls.rcs.length}` }; },
    },
    sesClient: { sendEmail: async () => {
      calls.ses++;
      if (options.failSes?.()) throw new Error('SES throttled');
      return { MessageId: `ses-${calls.ses}` };
    } },
  });
  return { rt, dynamo, calls, setReply: (value: unknown) => { reply = value; } };
}

function sns(topic: string, message: unknown) {
  return { Records: [{ EventSource: 'aws:sns', Sns: { TopicArn: topic, Timestamp: time, Message: JSON.stringify(message) } }] };
}
const inbound = (topic: string, body: unknown, id: string) => sns(topic, { originationNumber: customer, inboundMessageId: id, messageBody: body });
const menuReply = { reply: 'Do you recognize it?', status: 'AWAITING_CUSTOMER_INFORMATION', caseId: 'case-1', suggestions: menuChoices.map(c => ({ ...c })) };

test('RCS inbound gets RCS suggestions and the menu is persisted before delivery', async () => {
  const t = setup({ reply: menuReply });
  assert.deepEqual(await t.rt.handler(inbound(rcsTopic, 'my card was used', 'in-1')), ['processed']);
  assert.equal(t.calls.text.length, 0);
  const content = t.calls.rcs[0].RcsMessageContent as { Suggestions: { Reply: { Text: string; PostbackData: string } }[] };
  assert.deepEqual(content.Suggestions.map(s => s.Reply), menuChoices.map(c => ({ Text: c.label, PostbackData: c.postback })));
  const menu = await t.rt.activeMenus.get(customer);
  assert.equal(menu?.caseId, 'case-1');
  assert.equal(menu?.menuId, 'menu:reply:in-1');
  assert.equal(t.calls.menuPresentAtRcsSend, true, 'menu must exist by the time delivery starts');
});

test('SMS inbound gets the same choices as numbered text and a numeric reply maps to the postback', async () => {
  const t = setup({ reply: menuReply });
  await t.rt.handler(inbound(smsTopic, 'my card was used', 'in-1'));
  const body = String(t.calls.text[0].MessageBody);
  menuChoices.forEach((c, i) => assert.ok(body.includes(`${i + 1} — ${c.label}`)));
  assert.equal(t.calls.rcs.length, 0);

  t.setReply({ reply: 'Thanks.', status: 'INVESTIGATING', caseId: 'case-1' });
  assert.deepEqual(await t.rt.handler(inbound(smsTopic, '2', 'in-2')), ['processed']);
  // "2" resolved against the stored menu, which the answer then closed.
  assert.equal(t.calls.payloads[1].postback, menuChoices[1].postback);
  assert.equal(await t.rt.activeMenus.get(customer), null);
});

test('invalid suggestions are dropped but the reply text is still delivered', async () => {
  const t = setup({ reply: { ...menuReply, suggestions: [{ label: 'x'.repeat(26), postback: 'A' }] } });
  await t.rt.handler(inbound(rcsTopic, 'help', 'in-1'));
  assert.equal(t.calls.text.length, 1);
  assert.equal(String(t.calls.text[0].MessageBody), 'Do you recognize it?');
  assert.equal(await t.rt.activeMenus.get(customer), null);
  assert.throws(() => parseSuggestions([{ label: 'a', postback: 'p' }, { label: 'b', postback: 'p' }]));
  assert.throws(() => parseSuggestions([{ label: 'a', postback: 'p', extra: 1 }]));
  assert.throws(() => parseSuggestions([]));
});

test('menu replacement and stale cleanup never delete a newer menu', async () => {
  for (const store of [new MemoryActiveMenuStore(), setup().rt.activeMenus]) {
    const first = await store.set({ customerExternalId: customer, caseId: 'case-1', choices: menuChoices });
    const second = await store.set({ customerExternalId: customer, caseId: 'case-1', choices: menuChoices.slice(0, 2) });
    assert.equal(await store.clear(customer, 'case-1', first.menuId), false, 'stale menu id');
    assert.equal(await store.clear(customer, 'case-0'), false, 'other case');
    assert.equal((await store.get(customer))?.menuId, second.menuId);
    assert.equal(await store.clear(customer, 'case-1', second.menuId), true);
    assert.equal(await store.get(customer), null);
  }
});

test('answering a menu does not clear the replacement menu the reply just created', async () => {
  const t = setup({ reply: menuReply });
  await t.rt.handler(inbound(smsTopic, 'help', 'in-1'));
  t.setReply({ ...menuReply, reply: 'Which transactions?' });
  await t.rt.handler(inbound(smsTopic, '1', 'in-2'));
  assert.equal((await t.rt.activeMenus.get(customer))?.menuId, 'menu:reply:in-2');
});

test('a free-text reply that matches no choice leaves the menu active', async () => {
  const t = setup({ reply: menuReply });
  await t.rt.handler(inbound(smsTopic, 'help', 'in-1'));
  t.setReply({ reply: 'Please pick one.', status: 'AWAITING_CUSTOMER_INFORMATION', caseId: 'case-1' });
  await t.rt.handler(inbound(smsTopic, 'what?', 'in-2'));
  assert.equal((await t.rt.activeMenus.get(customer))?.menuId, 'menu:reply:in-1');
});

test('a terminal case status clears its menu and sends text only', async () => {
  const t = setup({ reply: menuReply });
  await t.rt.handler(inbound(rcsTopic, 'help', 'in-1'));
  t.setReply({ reply: 'Resolved.', status: 'RESOLVED', caseId: 'case-1', suggestions: menuReply.suggestions });
  await t.rt.handler(inbound(rcsTopic, 'ok', 'in-2'));
  assert.equal(await t.rt.activeMenus.get(customer), null);
  assert.equal(t.calls.rcs.length, 1);
  assert.equal(String(t.calls.text.at(-1)?.MessageBody), 'Resolved.');
});

test('terminal cleanup for one case leaves another case menu alone', async () => {
  const t = setup({ reply: { reply: 'Closed.', status: 'CLOSED', caseId: 'case-old' } });
  await t.rt.activeMenus.set({ customerExternalId: customer, caseId: 'case-new', choices: menuChoices });
  await t.rt.handler(inbound(smsTopic, 'ok', 'in-1'));
  assert.equal((await t.rt.activeMenus.get(customer))?.caseId, 'case-new');
});

test('transport failure is retried from the delivery record without rerunning AgentCore or duplicating the reply', async () => {
  let failing = true;
  const t = setup({ reply: { reply: 'Case opened.', status: 'INVESTIGATING', caseId: 'case-1' }, failText: () => failing });
  await assert.rejects(t.rt.handler(inbound(smsTopic, 'help', 'in-1')));
  assert.equal(t.calls.agent, 1);
  assert.equal((await t.rt.deliveries.get(customer, 'reply:in-1'))?.state, 'FAILED');

  failing = false;
  assert.deepEqual(await t.rt.handler(inbound(smsTopic, 'help', 'in-1')), ['duplicate']);
  assert.equal(t.calls.agent, 1, 'financial/case effects are not replayed');
  assert.equal(t.calls.text.length, 2);
  const settled = await t.rt.deliveries.get(customer, 'reply:in-1');
  assert.equal(settled?.state, 'ACCEPTED');
  assert.equal(settled?.providerMessageId, 'sms-2');

  // Further redeliveries and the completed claim never send again.
  assert.deepEqual(await t.rt.handler(inbound(smsTopic, 'help', 'in-1')), ['duplicate']);
  assert.equal(t.calls.text.length, 2);
  assert.equal(t.calls.agent, 1);
  assert.ok([...t.dynamo.items.values()].some(i => i.state?.S === 'COMPLETED'));
});

test('direct tool sends are idempotent by messageId', async () => {
  const t = setup();
  const event = { themisTool: 'send_customer_message', message: {
    channel: 'SMS', customerExternalId: customer, messageId: 'k1', caseId: 'case-1', text: 'Case opened.' } };
  assert.deepEqual(await t.rt.handler(event), { messageId: 'sms-1' });
  assert.deepEqual(await t.rt.handler(event), { messageId: 'sms-1' });
  assert.equal(t.calls.text.length, 1);
});

test('tool-sent choices are persisted as the active menu and an RCS request degrades to SMS text when RCS is off', async () => {
  const t = setup();
  const noRcs = createMessagingRuntime({ ...env, ENABLE_RCS: 'false', THEMIS_RCS_TOPIC_ARN: undefined }, {
    dynamo: t.dynamo.client, agentRuntime: { invokeAgentRuntime: async () => undefined },
    messagingClient: { sendTextMessage: async (p) => { t.calls.text.push(p); return { MessageId: 'sms-x' }; }, sendRcsMessage: async () => ({}) },
  });
  await noRcs.handler({ themisTool: 'send_customer_message', message: {
    channel: 'RCS', customerExternalId: customer, messageId: 'k2', caseId: 'case-9', text: 'Pick:', suggestions: menuChoices } });
  assert.match(String(t.calls.text[0].MessageBody), /1 — /);
  assert.equal((await noRcs.activeMenus.get(customer))?.caseId, 'case-9');
});

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/cases/${name}`, import.meta.url), 'utf8'));
function emailEvent() {
  const report = fixture('demo-reports.json').find((r: { caseId: string }) => fixture('demo.json').some((c: { caseId: string }) => c.caseId === r.caseId));
  const kase = fixture('demo.json').find((c: { caseId: string }) => c.caseId === report.caseId);
  return { themisTool: 'send_case_email', case: kase, report, recipient: 'customer1@example.test', nextSteps: ['We will update you.'] };
}

test('SES failure is reported and recorded without throwing, and a later retry sends once', async () => {
  let failing = true;
  const t = setup({ failSes: () => failing });
  const event = emailEvent();
  assert.deepEqual(await t.rt.handler(event), { status: 'FAILED', error: 'Delivery failed for EMAIL message ' + event.case.caseId });
  const id = `email:${event.case.caseId}:${event.case.status}:customer1@example.test`;
  assert.equal((await t.rt.deliveries.get('customer1@example.test', id))?.state, 'FAILED');
  failing = false;
  assert.deepEqual(await t.rt.handler(event), { status: 'SENT', messageId: 'ses-2' });
  assert.deepEqual(await t.rt.handler(event), { status: 'SENT', messageId: 'ses-2' });
  assert.equal(t.calls.ses, 2);
});

test('delivery events update the store through their own topic', async () => {
  const t = setup({ reply: { reply: 'Case opened.', status: 'INVESTIGATING', caseId: 'case-1' } });
  await t.rt.handler(inbound(smsTopic, 'help', 'in-1'));
  const event = (eventType: string, extra: object = {}) => sns(eventTopic, { eventType, messageId: 'sms-1', ...extra });
  assert.deepEqual(await t.rt.handler(event('TEXT_SUCCESSFUL', { isFinal: false })), ['ignored']);
  assert.equal((await t.rt.deliveries.get(customer, 'reply:in-1'))?.state, 'ACCEPTED');
  assert.deepEqual(await t.rt.handler(event('TEXT_DELIVERED', { isFinal: true })), ['DELIVERED']);
  assert.equal((await t.rt.deliveries.get(customer, 'reply:in-1'))?.state, 'DELIVERED');
  // A late/out-of-order failure cannot overwrite a final state; the event handler never reaches AgentCore.
  assert.deepEqual(await t.rt.handler(event('TEXT_CARRIER_UNREACHABLE', { isFinal: true })), ['UNDELIVERABLE']);
  assert.equal((await t.rt.deliveries.get(customer, 'reply:in-1'))?.state, 'DELIVERED');
  assert.equal(t.calls.agent, 1);
});

test('failed delivery event marks the message undeliverable; unknown provider ids are retried', async () => {
  const t = setup({ reply: { reply: 'Case opened.', status: 'INVESTIGATING', caseId: 'case-1' } });
  await t.rt.handler(inbound(smsTopic, 'help', 'in-1'));
  assert.deepEqual(await t.rt.handler(sns(eventTopic, { eventType: 'TEXT_BLOCKED', messageId: 'sms-1', isFinal: true })), ['UNDELIVERABLE']);
  assert.equal((await t.rt.deliveries.get(customer, 'reply:in-1'))?.state, 'UNDELIVERABLE');
  await assert.rejects(t.rt.handler(sns(eventTopic, { eventType: 'TEXT_DELIVERED', messageId: 'nope' })), /unknown provider message/);
});

test('delivery events on inbound topics and inbound messages on the delivery topic are rejected', async () => {
  const t = setup({ reply: menuReply });
  await assert.rejects(t.rt.handler(sns(smsTopic, { eventType: 'TEXT_DELIVERED', messageId: 'sms-1', isFinal: true })), /Delivery event received on an inbound/);
  await assert.rejects(t.rt.handler(sns(rcsTopic, { eventType: 'RCS_DELIVERED', messageId: 'x', originationNumber: customer, messageBody: 'hi' })));
  await assert.rejects(t.rt.handler(inbound(eventTopic, 'hi', 'in-1')), /Inbound customer message received on the delivery event topic/);
  await assert.rejects(t.rt.handler(sns('arn:aws:sns:us-east-1:123456789012:other', { eventType: 'TEXT_DELIVERED', messageId: 'x' })));
  assert.equal(t.calls.agent, 0);
});

test('delivery topic must be distinct from inbound topics', () => {
  assert.throws(() => createMessagingRuntime({ ...env, THEMIS_DELIVERY_EVENT_TOPIC_ARN: smsTopic }, {
    dynamo: fakeDynamo().client, agentRuntime: { invokeAgentRuntime: async () => undefined } }), /must differ/);
});

test('reconciler lists only old PROCESSING claims and resolves them conditionally', async () => {
  const store = new MemoryIdempotencyStore();
  await store.claim('a'); await store.claim('b'); await store.claim('c');
  await store.complete('b');
  const later = new Date(Date.now() + 60_000);
  assert.deepEqual((await store.listStuck(30_000, later)).map(c => c.claimId).sort(), ['a', 'c']);
  assert.deepEqual(await store.listStuck(30_000), []);
  assert.equal(await store.resolve('a', 'COMPLETED'), true);
  assert.equal(await store.resolve('a', 'RELEASED'), false, 'already moved');
  assert.equal(await store.resolve('c', 'RELEASED'), true);
  assert.equal(await store.claim('c'), true, 'released claim can be admitted again');
});

test('Dynamo delivery store transitions are conditional and final states stick', async () => {
  const dynamo = fakeDynamo();
  const store = new DynamoDeliveryStore('t', dynamo.client);
  const first = await store.begin({ customerExternalId: customer, messageId: 'm1' });
  assert.equal(first.state, 'PENDING');
  await store.markAccepted(customer, 'm1', 'p1');
  assert.equal((await store.begin({ customerExternalId: customer, messageId: 'm1' })).state, 'ACCEPTED');
  assert.equal(await store.applyEvent('p1', 'DELIVERED'), true);
  await store.markFailed(customer, 'm1', 'late');
  assert.equal((await store.get(customer, 'm1'))?.state, 'DELIVERED');
  assert.equal(await store.applyEvent('missing', 'DELIVERED'), false);
});
