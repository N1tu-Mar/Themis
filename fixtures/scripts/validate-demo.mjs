import * as c from '../../packages/contracts/dist/index.js';

export const demoSchemas = {
  'customers/demo': c.CustomerSchema, 'transactions/demo': c.TransactionSchema,
  'merchants/demo': c.MerchantSchema, 'merchants/demo-profiles': c.MerchantProfileSchema,
  'cases/demo': c.CaseSchema, 'cases/demo-evidence': c.EvidenceSchema,
  'cases/demo-resolution-proposals': c.ResolutionProposalSchema,
  'cases/demo-policy-decisions': c.PolicyDecisionSchema,
  'cases/demo-human-review-requests': c.HumanReviewRequestSchema,
  'cases/demo-reports': c.CaseReportSchema,
  'cases/demo-inbound-messages': c.InboundMessageSchema,
  'cases/demo-outbound-messages': c.OutboundMessageSchema,
};

// Fixture-only integrity checks, independent of service persistence or policy execution.
export function validateDemoFixtureSet(data) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  for (const [path, schema] of Object.entries(demoSchemas)) {
    const result = schema.array().safeParse(data[path]);
    if (!result.success) errors.push(`${path}: ${result.error.message}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const index = (path, key) => {
    const records = data[path];
    const map = new Map(records.map(record => [record[key], record]));
    check(map.size === records.length, `${path}: duplicate ${key}`);
    return map;
  };
  const customers = index('customers/demo', 'customerId');
  const merchants = index('merchants/demo', 'merchantId');
  const transactions = index('transactions/demo', 'transactionId');
  const cases = index('cases/demo', 'caseId');
  const evidence = index('cases/demo-evidence', 'evidenceId');
  index('cases/demo-policy-decisions', 'decisionId');
  index('cases/demo-resolution-proposals', 'caseId');
  index('cases/demo-reports', 'caseId');
  index('merchants/demo-profiles', 'merchantId');
  const inbound = index('cases/demo-inbound-messages', 'messageId');
  const outbound = index('cases/demo-outbound-messages', 'messageId');
  check([...inbound.keys()].every(id => !outbound.has(id)), 'message IDs overlap');
  const sum = records => records.reduce((total, record) => total + Math.round(record.amount * 100), 0);
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  for (const tx of transactions.values()) {
    check(customers.has(tx.customerId), `${tx.transactionId}: missing customer`);
    check(merchants.has(tx.merchantId), `${tx.transactionId}: missing merchant`);
    check(tx.authSignals.merchant_id === undefined || tx.authSignals.merchant_id === tx.merchantId, `${tx.transactionId}: auth merchant mismatch`);
  }
  for (const record of cases.values()) {
    check(customers.has(record.customerId), `${record.caseId}: missing customer`);
    check(record.merchantId === null || merchants.has(record.merchantId), `${record.caseId}: missing merchant`);
    const txs = record.transactionIds.map(id => transactions.get(id));
    check(txs.every(Boolean), `${record.caseId}: missing transaction`);
    check(new Set(record.transactionIds).size === txs.length, `${record.caseId}: duplicate transaction reference`);
    if (txs.every(Boolean)) {
      check(txs.every(tx => tx.customerId === record.customerId && tx.merchantId === record.merchantId && tx.currency === record.currency), `${record.caseId}: transaction ownership/currency mismatch`);
      check(sum(txs) === Math.round(record.totalDisputedAmount * 100), `${record.caseId}: disputed total mismatch`);
    }
    check(record.evidenceIds.every(id => evidence.get(id)?.caseId === record.caseId), `${record.caseId}: evidence ownership mismatch`);
    check(Date.parse(record.updatedAt) >= Date.parse(record.createdAt), `${record.caseId}: timestamps reversed`);
    if (record.outcome === 'CUSTOMER_RECOGNIZED_MERCHANT') check(record.status === 'CLOSED' && record.recommendedActions.length === 0, `${record.caseId}: recognized merchant must close without dispute action`);
  }
  for (const ev of evidence.values()) {
    const record = cases.get(ev.caseId);
    check(record?.evidenceIds.includes(ev.evidenceId), `${ev.evidenceId}: missing owning case reference`);
    check(ev.transactionIds.every(id => record?.transactionIds.includes(id)), `${ev.evidenceId}: transaction outside case`);
  }
  for (const path of ['cases/demo-resolution-proposals', 'cases/demo-policy-decisions', 'cases/demo-human-review-requests', 'cases/demo-reports', 'cases/demo-outbound-messages']) {
    for (const record of data[path]) check(cases.has(record.caseId), `${path}: missing case ${record.caseId}`);
  }
  for (const proposal of data['cases/demo-resolution-proposals']) {
    check([...proposal.supportingEvidence, ...proposal.contradictoryEvidence].every(id => evidence.get(id)?.caseId === proposal.caseId), `${proposal.caseId}: proposal evidence outside case`);
  }
  for (const review of data['cases/demo-human-review-requests']) {
    check(review.evidenceRefs.every(id => evidence.get(id)?.caseId === review.caseId), `${review.caseId}: review evidence outside case`);
  }
  for (const report of data['cases/demo-reports']) {
    const record = cases.get(report.caseId);
    if (!record) continue;
    check(same(report.transactions, record.transactionIds.map(id => transactions.get(id))), `${record.caseId}: report transactions mismatch`);
    check(same(report.evidence, record.evidenceIds.map(id => evidence.get(id))), `${record.caseId}: report evidence mismatch`);
    check(report.totalDisputedAmount === record.totalDisputedAmount && report.currency === record.currency, `${record.caseId}: report total/currency mismatch`);
    check(same(report.merchant, merchants.get(record.merchantId) ?? null), `${record.caseId}: report merchant mismatch`);
    check(report.outcome === record.outcome, `${record.caseId}: report outcome mismatch`);
    check(same(report.resolution, data['cases/demo-resolution-proposals'].find(p => p.caseId === record.caseId) ?? null), `${record.caseId}: report resolution mismatch`);
    check(same(report.policyDecisions, data['cases/demo-policy-decisions'].filter(p => p.caseId === record.caseId)), `${record.caseId}: report policy mismatch`);
    check(same(report.humanReviewEvents, data['cases/demo-human-review-requests'].filter(p => p.caseId === record.caseId)), `${record.caseId}: report review mismatch`);
    check(report.actionsTaken.every(action => report.policyDecisions.some(p => p.action === action && p.outcome === 'ALLOW')), `${record.caseId}: taken action lacks policy allowance`);
  }
  const descriptors = new Map();
  for (const merchant of merchants.values()) {
    for (const alias of [merchant.canonicalName, ...merchant.aliases]) {
      const normalized = alias.toUpperCase();
      check(!descriptors.has(normalized), `${alias}: ambiguous merchant alias`);
      descriptors.set(normalized, merchant.merchantId);
    }
  }
  for (const tx of transactions.values()) check(descriptors.get(tx.descriptor.toUpperCase()) === tx.merchantId, `${tx.transactionId}: descriptor cannot resolve merchant`);
  for (const profile of data['merchants/demo-profiles']) {
    const merchant = merchants.get(profile.merchantId);
    check(merchant && profile.canonicalName === merchant.canonicalName && same(profile.aliases, merchant.aliases), `${profile.merchantId}: profile identity mismatch`);
    const records = [...cases.values()].filter(record => record.merchantId === profile.merchantId);
    const stats = profile.caseStatistics;
    check(stats.totalCases === records.length, `${profile.merchantId}: totalCases mismatch`);
    check(stats.resolvedCustomerDisputes === records.filter(record => record.status === 'CLOSED' && !record.outcome).length, `${profile.merchantId}: resolvedCustomerDisputes mismatch`);
    check(stats.openCases === records.filter(record => !['CLOSED', 'RESOLVED'].includes(record.status)).length, `${profile.merchantId}: openCases mismatch`);
    for (const signal of profile.riskSignals) {
      check(Date.parse(signal.expiresAt) > Date.parse(signal.observedAt), `${profile.merchantId}: risk expiry precedes observation`);
      check(signal.evidenceRefs.every(id => cases.get(evidence.get(id)?.caseId)?.merchantId === profile.merchantId), `${profile.merchantId}: risk evidence outside merchant`);
    }
  }
  for (const message of inbound.values()) check([...customers.values()].some(customer => customer.phone === message.customerExternalId), `${message.messageId}: missing recipient`);
  for (const message of outbound.values()) check(customers.get(cases.get(message.caseId)?.customerId)?.phone === message.customerExternalId, `${message.messageId}: recipient/case mismatch`);
  if (errors.length) throw new Error(errors.join('\n'));
  return true;
}
