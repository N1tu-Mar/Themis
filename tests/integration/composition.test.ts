// Local end-to-end composition (no AWS): SNS event -> messaging normalization/idempotency -> AgentCore runtime payload
// -> Python orchestrator -> tools adapter (bank-tools + merchant-intel + workflow) behind the real Cedar policy text
// -> report/escalation -> outbound message captured at the messaging client boundary.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createMessagingRuntime, type Payload } from '../../services/messaging/src/index.ts';

const smsTopic = 'arn:aws:sns:us-east-1:123456789012:themis-sms';
const env = {
  THEMIS_MODE: 'aws', ENABLE_RCS: 'false', ENABLE_SMS_FALLBACK: 'true', THEMIS_SMS_TOPIC_ARN: smsTopic,
  IDEMPOTENCY_TABLE: 'idem', AGENT_RUNTIME_ARN: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/ThemisOrchestrator',
  THEMIS_RCS_POOL_ID: 'pool-1', THEMIS_SMS_IDENTITY: '+15555550999',
};
const customer = '+15555550100'; // customer_demo_001 in fixtures/customers/demo.json

function agentProcess(extraEnv: Record<string, string> = {}) {
  const child = spawn('python3', ['tests/integration/harness.py'], { env: { ...process.env, ...extraEnv }, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  after(() => { child.stdin.end(); });
  const ask = async (payload: unknown) => {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return JSON.parse((await lines.next()).value as string);
  };
  return { ask };
}

function dynamo() {
  const items = new Map<string, Record<string, unknown>>();
  const key = (v: unknown) => String(((v as Record<string, Record<string, string>>).idempotencyKey).S);
  return {
    async putItem(p: Payload) {
      const k = key(p.Item);
      if (p.ConditionExpression && items.has(k)) throw Object.assign(new Error('dup'), { name: 'ConditionalCheckFailedException' });
      items.set(k, p.Item as Record<string, unknown>); return {};
    },
    async updateItem() { return {}; },
    async getItem(p: Payload) { return { Item: items.get(key(p.Key)) }; },
    async deleteItem() { return {}; },
  };
}

function compose(agent: { ask: (p: unknown) => Promise<{ reply: string; caseId: string | null }> }) {
  const outbound: Payload[] = [];
  const runtime = createMessagingRuntime(env, {
    dynamo: dynamo(),
    agentRuntime: { invokeAgentRuntime: async request => agent.ask(JSON.parse(new TextDecoder().decode(request.payload))) },
    messagingClient: {
      sendTextMessage: async (payload) => { outbound.push(payload); return { MessageId: `sms-${outbound.length}` }; },
      sendRcsMessage: async () => { throw new Error('unexpected RCS'); },
    },
  });
  let n = 0;
  const inbound = (text: string, id = `in-${++n}`) => ({ Records: [{ EventSource: 'aws:sns', Sns: {
    TopicArn: smsTopic, Timestamp: '2026-09-20T14:00:00Z',
    Message: JSON.stringify({ originationNumber: customer, inboundMessageId: id, messageBody: text }) } }] });
  return { runtime, outbound, inbound };
}

test('policy-allowed dispute: SNS -> messaging -> orchestrator -> tools -> report -> outbound', async () => {
  const agent = agentProcess();
  const { runtime, outbound, inbound } = compose(agent);
  const first = inbound('19.99 from ASTDIGITAL');

  assert.deepEqual(await runtime.handler(first), ['processed']);
  assert.match(String(outbound[0].MessageBody), /Asteria Digital.*Are these the charges/);
  assert.equal(outbound[0].DestinationPhoneNumber, customer);

  assert.deepEqual(await runtime.handler(inbound("yes I don't recognize it")), ['processed']);
  const [, resolved] = outbound;
  const caseId = /Reference: (case_\w+)/.exec(String(resolved.MessageBody))?.[1];
  assert.ok(caseId, 'reply carries the case reference');

  const state = await agent.ask({ inspect: caseId });
  assert.equal(state.caseStatus, 'RESOLVED');
  assert.deepEqual(state.policy, [['CREATE_DISPUTE', 'ALLOW'], ['PROVISIONAL_CREDIT', 'ALLOW']]);
  assert.ok(state.tools.includes('generate_case_report') && !state.tools.includes('escalate_case'));

  assert.deepEqual(await runtime.handler(first), ['duplicate']); // SNS redelivery: no second agent turn, no second reply
  assert.equal(outbound.length, 2);
});

test('Cedar denial: policy result -> escalate_case -> report -> outbound handoff message', async () => {
  const agent = agentProcess({ THEMIS_TEST_CREDIT_LIMIT: '5' });
  const { runtime, outbound, inbound } = compose(agent);

  await runtime.handler(inbound('19.99 from ASTDIGITAL'));
  await runtime.handler(inbound("yes I don't recognize it"));
  assert.match(String(outbound[1].MessageBody), /specialist/);

  const caseId = (await agent.ask({ customerExternalId: customer, channel: 'SMS', messageId: 'probe', text: 'hello', postback: null, receivedAt: '2026-09-20T14:00:00Z' })).caseId;
  assert.ok(caseId);
  const state = await agent.ask({ inspect: caseId });
  assert.equal(state.caseStatus, 'NEEDS_HUMAN_REVIEW');
  assert.deepEqual(state.reviews, ['POLICY_REQUIRE_HUMAN_REVIEW']);
  assert.equal(state.reportHumanReviewEvents, 1);
  const t: string[] = state.tools;
  assert.ok(t.indexOf('propose_provisional_credit') < t.indexOf('escalate_case') && t.indexOf('escalate_case') < t.indexOf('generate_case_report'));
});
