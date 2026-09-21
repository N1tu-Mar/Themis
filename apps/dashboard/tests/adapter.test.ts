import { afterEach, describe, it, expect } from 'vitest';
import {
  listCases, getCase, getCaseReport, listMerchantProfiles, getMerchantProfile, listReviewQueue,
  casesForMerchant, getProvider, setDataProvider, dataStatus,
} from '@/lib/data/adapter';

afterEach(() => setDataProvider(undefined));

describe('fixture adapter (default mode)', () => {
  it('returns typed case data', async () => {
    const cases = await listCases();
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0]).toHaveProperty('caseId');
    expect(cases[0]).toHaveProperty('status');
  });

  it('looks up a single case by id', async () => {
    const first = (await listCases())[0];
    expect((await getCase(first.caseId))?.caseId).toBe(first.caseId);
    expect(await getCase('does-not-exist')).toBeUndefined();
  });

  it('returns a case report with evidence for a known case', async () => {
    const report = await getCaseReport('case_demo_d');
    expect(report).toBeDefined();
    expect(report!.evidence.length).toBeGreaterThan(0);
  });

  it('returns merchant aliases in the profile', async () => {
    expect((await getMerchantProfile('merchant_demo_001'))?.aliases).toContain('ASTERIA.IO');
  });

  it('lists merchant profiles with risk signals', async () => {
    const profiles = await listMerchantProfiles();
    expect(profiles.some((p) => p.riskSignals.length > 0)).toBe(true);
  });

  it('puts only human-review cases in the review queue', async () => {
    const queue = await listReviewQueue();
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((e) => e.case.requiresHumanReview)).toBe(true);
  });

  it('filters cases by merchant', async () => {
    const related = await casesForMerchant('merchant_demo_001');
    expect(related.every((c) => c.merchantId === 'merchant_demo_001')).toBe(true);
  });
});

describe('provider selection', () => {
  it('defaults to fixtures when THEMIS_DASHBOARD_DATA_SOURCE is unset or empty', async () => {
    expect((await getProvider({})).source).toBe('fixtures');
    setDataProvider(undefined);
    expect((await getProvider({ THEMIS_DASHBOARD_DATA_SOURCE: ' ' })).source).toBe('fixtures');
    expect(await dataStatus()).toEqual({ source: 'fixtures', stale: false, skippedRecords: 0 });
  });

  it('rejects an unknown data source', async () => {
    await expect(getProvider({ THEMIS_DASHBOARD_DATA_SOURCE: 'dynamo' })).rejects.toThrow(/fixtures or aws/);
  });

  it('aws mode requires the existing table and bucket variables', async () => {
    await expect(getProvider({ THEMIS_DASHBOARD_DATA_SOURCE: 'aws', CASES_TABLE: 'c' })).rejects.toThrow(/MERCHANTS_TABLE/);
  });
});
