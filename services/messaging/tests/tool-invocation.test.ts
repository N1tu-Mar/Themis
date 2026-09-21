import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMessagingRuntime, type Payload } from '../src/index.ts';

const env = {
  THEMIS_MODE: 'aws', ENABLE_RCS: 'false', ENABLE_SMS_FALLBACK: 'true',
  THEMIS_SMS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:themis-sms', IDEMPOTENCY_TABLE: 'idem',
  AGENT_RUNTIME_ARN: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/ThemisOrchestrator',
  THEMIS_RCS_POOL_ID: 'pool-1', THEMIS_SMS_IDENTITY: '+15555550999', THEMIS_SES_FROM: 'cases@themis.example', THEMIS_SUPPORT: 'help@themis.example',
};
const noDynamo = { putItem: async () => ({}), updateItem: async () => ({}), getItem: async () => ({}), deleteItem: async () => ({}) };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/cases/${name}`, import.meta.url), 'utf8'));

function runtime() {
  const sms: Payload[] = [];
  const emails: Payload[] = [];
  const rt = createMessagingRuntime(env, {
    dynamo: noDynamo,
    agentRuntime: { invokeAgentRuntime: async () => undefined },
    messagingClient: { sendTextMessage: async (p) => { sms.push(p); return { MessageId: 'sms-1' }; }, sendRcsMessage: async () => ({}) },
    sesClient: { sendEmail: async (p) => { emails.push(p); return { MessageId: 'ses-1' }; } },
  });
  return { rt, sms, emails };
}

test('direct tool event sends a customer message through the channel adapter', async () => {
  const { rt, sms } = runtime();
  const out = await rt.handler({ themisTool: 'send_customer_message', message: {
    channel: 'SMS', customerExternalId: '+15555550100', messageId: 'k1', caseId: 'case_1', text: 'Your case is open.' } });
  assert.deepEqual(out, { messageId: 'sms-1' });
  assert.equal(sms[0].DestinationPhoneNumber, '+15555550100');
});

test('direct tool event sends a case email built from the case and report', async () => {
  const { rt, emails } = runtime();
  const report = fixture('demo-reports.json').find((r: { caseId: string }) => fixture('demo.json').some((c: { caseId: string }) => c.caseId === r.caseId));
  const kase = fixture('demo.json').find((c: { caseId: string }) => c.caseId === report.caseId);
  const out = await rt.handler({ themisTool: 'send_case_email', case: kase, report, recipient: 'customer1@example.test', nextSteps: ['We will update you.'] });
  assert.deepEqual(out, { status: 'SENT', messageId: 'ses-1' });
  assert.match(JSON.stringify(emails[0]), /customer1@example.test/);
});

test('unknown or unconfigured tool events are rejected', async () => {
  await assert.rejects(runtime().rt.handler({ themisTool: 'wire_money' }), /Unsupported tool event/);
});
