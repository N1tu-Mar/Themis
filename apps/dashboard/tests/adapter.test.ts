import { describe, it, expect } from 'vitest';
import {
  listCases,
  getCase,
  getCaseReport,
  listMerchantProfiles,
  getMerchantProfile,
  listReviewQueue,
  casesForMerchant,
} from '@/lib/data/adapter';

describe('mock adapter', () => {
  it('returns typed case data', () => {
    const cases = listCases();
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0]).toHaveProperty('caseId');
    expect(cases[0]).toHaveProperty('status');
  });

  it('looks up a single case by id', () => {
    const first = listCases()[0];
    expect(getCase(first.caseId)?.caseId).toBe(first.caseId);
    expect(getCase('does-not-exist')).toBeUndefined();
  });

  it('returns a case report with evidence for a known case', () => {
    const report = getCaseReport('case_demo_d');
    expect(report).toBeDefined();
    expect(report!.evidence.length).toBeGreaterThan(0);
  });

  it('returns merchant aliases in the profile', () => {
    const asteria = getMerchantProfile('merchant_demo_001');
    expect(asteria?.aliases).toContain('ASTERIA.IO');
  });

  it('lists merchant profiles with risk signals', () => {
    const profiles = listMerchantProfiles();
    expect(profiles.length).toBeGreaterThan(0);
    const withSignals = profiles.filter((p) => p.riskSignals.length > 0);
    expect(withSignals.length).toBeGreaterThan(0);
  });

  it('puts only human-review cases in the review queue', () => {
    const queue = listReviewQueue();
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((e) => e.case.requiresHumanReview)).toBe(true);
  });

  it('filters cases by merchant', () => {
    const related = casesForMerchant('merchant_demo_001');
    expect(related.every((c) => c.merchantId === 'merchant_demo_001')).toBe(true);
  });
});
