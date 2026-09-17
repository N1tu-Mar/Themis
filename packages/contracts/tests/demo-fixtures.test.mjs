import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDemoFixtures } from '../../../fixtures/scripts/build-demo.mjs';
import { validateDemoFixtureSet } from '../../../fixtures/scripts/validate-demo.mjs';
import * as c from '../dist/index.js';

test('complete fixture set is deterministic, committed and valid', async () => {
  const generated = buildDemoFixtures();
  assert.deepEqual(buildDemoFixtures(), generated);
  for (const [path, expected] of Object.entries(generated)) {
    const actual = JSON.parse(await readFile(new URL(`../../../fixtures/${path}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(actual, expected, `Regenerate stale fixture: ${path}`);
  }
  assert.equal(validateDemoFixtureSet(generated), true);
  assert.equal(generated['customers/demo'].length, 50);
  assert.equal(generated['transactions/demo'].length, 1200);
  assert.equal(generated['merchants/demo'].length, 40);
  assert.equal(generated['cases/demo'].filter(record => record.caseId.includes('history')).length, 12);
  assert.equal(generated['merchants/demo'].filter(record => record.aliases.length > 0).length, 4);
  assert.equal(generated['merchants/demo-profiles'].filter(record => record.riskSignals.length > 0).length, 1);
  for (const customer of generated['customers/demo']) {
    assert.ok(customer.email.endsWith('@example.test'));
    assert.match(customer.phone, /^\+155555501\d{2}$/);
  }
});

test('scenario A matches exactly six weekly charges and excludes unrelated amount', () => {
  const data = buildDemoFixtures();
  const scenario = data.scenarios.find(s => s.scenarioId === 'A');
  const candidates = data['transactions/demo'].filter(tx => tx.customerId === scenario.customerId && tx.merchantId === scenario.merchantId);
  const matches = candidates.filter(tx => tx.amount === 9.99 && tx.authSignals.recurring_indicator);
  assert.equal(matches.length, 6);
  assert.deepEqual(matches.map(tx => tx.transactionId), scenario.transactionIds);
  assert.equal(matches.reduce((sum, tx) => sum + Math.round(tx.amount * 100), 0), 5994);
  const times = matches.map(tx => Date.parse(tx.occurredAt)).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) assert.equal(times[i] - times[i - 1], 7 * 86_400_000);
  assert.equal(candidates.filter(tx => tx.amount === 19.99).length, 1);
});

test('scenario B records cancellation before charges and avoids stolen-card classification', () => {
  const data = buildDemoFixtures();
  const scenario = data.scenarios.find(s => s.scenarioId === 'B');
  const report = data['cases/demo-reports'].find(r => r.caseId === scenario.caseId);
  assert.equal(report.classification, 'RECURRING_PAYMENT_AFTER_CANCELLATION');
  assert.ok(report.transactions.every(tx => Date.parse(tx.occurredAt) > Date.parse(scenario.expected.canceledAt)));
});

test('scenario C closes recognized purchase without a dispute or policy action', () => {
  const data = buildDemoFixtures();
  const scenario = data.scenarios.find(s => s.scenarioId === 'C');
  const record = data['cases/demo'].find(r => r.caseId === scenario.caseId);
  const report = data['cases/demo-reports'].find(r => r.caseId === scenario.caseId);
  assert.equal(record.outcome, 'CUSTOMER_RECOGNIZED_MERCHANT');
  assert.equal(record.status, 'CLOSED');
  assert.deepEqual(record.recommendedActions, []);
  assert.equal(report.resolution, null);
  assert.deepEqual(report.actionsTaken, []);
  assert.deepEqual(report.policyDecisions, []);
  const classifying = {...record, status: 'CLASSIFYING_DISPUTE'};
  const resolved = {...record, status: 'RESOLVED'};
  c.assertCaseTransition(classifying, resolved);
  c.assertCaseTransition(resolved, record);
  assert.throws(() => c.assertCaseTransition(classifying, {...resolved, outcome: undefined}), /Early resolution/);
  assert.throws(() => c.assertCaseTransition(classifying, {...resolved, recommendedActions: ['CREATE_DISPUTE']}), /Recognized merchant/);
  assert.throws(() => c.assertCaseTransition(classifying, {...resolved, customerId: 'different'}), /identity/);
});

test('scenario D keeps contradictory strong authentication and requires human review', () => {
  const data = buildDemoFixtures();
  const scenario = data.scenarios.find(s => s.scenarioId === 'D');
  const record = data['cases/demo'].find(r => r.caseId === scenario.caseId);
  const report = data['cases/demo-reports'].find(r => r.caseId === scenario.caseId);
  assert.equal(record.status, 'NEEDS_HUMAN_REVIEW');
  assert.equal(record.requiresHumanReview, true);
  assert.equal(report.transactions[0].authSignals['3ds_status'], 'AUTHENTICATED');
  assert.equal(report.resolution.contradictoryEvidence.length, 1);
  assert.equal(report.humanReviewEvents.length, 1);
  assert.equal(report.policyDecisions[0].outcome, 'REQUIRE_HUMAN_REVIEW');
  assert.deepEqual(report.actionsTaken, []);
});

test('scenario E links prior merchant evidence while retaining customer verification', () => {
  const data = buildDemoFixtures();
  const scenario = data.scenarios.find(s => s.scenarioId === 'E');
  const record = data['cases/demo'].find(r => r.caseId === scenario.caseId);
  const profile = data['merchants/demo-profiles'].find(p => p.merchantId === scenario.merchantId);
  const report = data['cases/demo-reports'].find(r => r.caseId === scenario.caseId);
  assert.ok(profile.caseStatistics.resolvedCustomerDisputes >= 2);
  assert.ok(profile.riskSignals[0].evidenceRefs.length > 0);
  assert.ok(Date.parse(profile.riskSignals[0].observedAt) < Date.parse(report.transactions[0].occurredAt));
  assert.equal(record.status, 'AWAITING_TRANSACTION_CONFIRMATION');
  assert.equal(record.confidence, null);
  assert.equal(report.resolution, null);
  assert.deepEqual(report.actionsTaken, []);
  assert.deepEqual(report.policyDecisions, []);
});

test('three ordinary recurring merchants retain stable amount and cadence', () => {
  const data = buildDemoFixtures();
  for (const profile of data['merchants/demo-profiles'].slice(1, 4)) {
    const pattern = profile.billingPatterns[0];
    const txs = data['transactions/demo'].filter(tx => tx.merchantId === profile.merchantId && tx.customerId === `customer_demo_00${5 + Number(profile.merchantId.slice(-3))}`);
    assert.equal(txs.length, 6);
    assert.ok(txs.every(tx => tx.amount === pattern.amount && tx.authSignals.recurring_indicator));
    const times = txs.map(tx => Date.parse(tx.occurredAt)).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) assert.equal(times[i] - times[i - 1], pattern.cadenceDays * 86_400_000);
    assert.deepEqual(profile.riskSignals, []);
  }
});

const mutations = [
  ['missing customer', data => { data['transactions/demo'][0].customerId = 'missing'; }],
  ['duplicate transactionId', data => { data['transactions/demo'][1].transactionId = data['transactions/demo'][0].transactionId; }],
  ['disputed total mismatch', data => { data['cases/demo'][0].totalDisputedAmount += 1; }],
  ['evidence ownership mismatch', data => { data['cases/demo'][0].evidenceIds = data['cases/demo'][1].evidenceIds; }],
  ['report transactions mismatch', data => { data['cases/demo-reports'][0].transactions[0].amount += 1; }],
  ['taken action lacks policy allowance', data => { data['cases/demo-reports'][0].policyDecisions[0].outcome = 'DENY'; }],
  ['ambiguous merchant alias', data => { data['merchants/demo'][1].aliases.push(data['merchants/demo'][0].aliases[0]); }],
  ['risk expiry precedes observation', data => { data['merchants/demo-profiles'][0].riskSignals[0].expiresAt = '2020-01-01T00:00:00Z'; }],
];
for (const [message, mutate] of mutations) {
  test(`integrity validation rejects ${message}`, () => {
    // Clone removes intentionally shared references, just like JSON loading does.
    const data = JSON.parse(JSON.stringify(buildDemoFixtures()));
    mutate(data);
    assert.throws(() => validateDemoFixtureSet(data), new RegExp(message));
  });
}

test('canonical policy actions compile into exported schemas', () => {
  for (const action of ['CREATE_DISPUTE', 'PROVISIONAL_CREDIT', 'BLOCK_RECURRING_MERCHANT', 'REPLACE_CARD', 'DENY_CASE']) c.ActionSchema.parse(action);
  for (const action of ['BLOCK_MERCHANT_PAYMENT', 'CLOSE_CARD', 'DENY_DISPUTE']) assert.equal(c.ActionSchema.safeParse(action).success, false);
});

test('normalized message fixtures cover RCS, SMS and EMAIL recipients', () => {
  const data = buildDemoFixtures();
  const messages = data['cases/demo-outbound-messages'];
  assert.deepEqual([...new Set(messages.map(message => message.channel))].sort(), ['EMAIL', 'RCS', 'SMS']);
  const email = messages.find(message => message.channel === 'EMAIL');
  assert.ok(email.subject.length > 0);
  assert.ok(email.customerExternalId.endsWith('@example.test'));
  assert.match(email.text, /49\.99/);
  c.InboundMessageSchema.parse({channel: 'RCS', customerExternalId: '+15555550100', messageId: 'postback_demo', text: '', postback: 'CONFIRM_ALL', receivedAt: '2026-09-17T20:00:00Z'});
});
