import {
  CaseSchema,
  CaseReportSchema,
  MerchantProfileSchema,
  HumanReviewRequestSchema,
  AuditEventSchema,
  type Case,
  type CaseReport,
  type MerchantProfile,
  type HumanReviewRequest,
  type AuditEvent,
} from '@themis/contracts';

import casesRaw from '../../../../fixtures/cases/demo.json';
import reportsRaw from '../../../../fixtures/cases/demo-reports.json';
import merchantProfilesRaw from '../../../../fixtures/merchants/demo-profiles.json';
import humanReviewRaw from '../../../../fixtures/cases/demo-human-review-requests.json';
import auditEventsRaw from '../../../../fixtures/cases/demo-audit-events.json';

const cases: Case[] = CaseSchema.array().parse(casesRaw);
const reports: CaseReport[] = CaseReportSchema.array().parse(reportsRaw);
const merchantProfiles: MerchantProfile[] = MerchantProfileSchema.array().parse(merchantProfilesRaw);
const humanReviewRequests: HumanReviewRequest[] = HumanReviewRequestSchema.array().parse(humanReviewRaw);
const auditEvents: AuditEvent[] = AuditEventSchema.array().parse(auditEventsRaw);

/** Frontend data boundary: every UI component reads through here, never the fixture files directly. */
export function listCases(): Case[] {
  return cases;
}

export function getCase(caseId: string): Case | undefined {
  return cases.find((c) => c.caseId === caseId);
}

export function getCaseReport(caseId: string): CaseReport | undefined {
  return reports.find((r) => r.caseId === caseId);
}

export function listMerchantProfiles(): MerchantProfile[] {
  return merchantProfiles;
}

export function getMerchantProfile(merchantId: string): MerchantProfile | undefined {
  return merchantProfiles.find((m) => m.merchantId === merchantId);
}

export function casesForMerchant(merchantId: string): Case[] {
  return cases.filter((c) => c.merchantId === merchantId);
}

export interface ReviewQueueEntry {
  case: Case;
  request: HumanReviewRequest | undefined;
  report: CaseReport | undefined;
  merchantName: string;
}

export function listReviewQueue(): ReviewQueueEntry[] {
  return cases
    .filter((c) => c.requiresHumanReview)
    .map((c) => {
      const report = getCaseReport(c.caseId);
      return {
        case: c,
        request: humanReviewRequests.find((r) => r.caseId === c.caseId),
        report,
        merchantName: report?.merchant?.canonicalName ?? 'Unmatched merchant',
      };
    });
}

export function auditEventsForCase(caseId: string): AuditEvent[] {
  return auditEvents.filter((e) => e.caseId === caseId);
}

const NOW = cases.reduce((latest, c) => (c.updatedAt > latest ? c.updatedAt : latest), cases[0]?.updatedAt ?? new Date().toISOString());
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export function commonDisputeType(merchantId: string): string | undefined {
  const counts = new Map<string, number>();
  for (const c of casesForMerchant(merchantId)) {
    counts.set(c.claimType, (counts.get(c.claimType) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function recentCaseCount(merchantId: string): number {
  const cutoff = new Date(NOW).getTime() - NINETY_DAYS_MS;
  return casesForMerchant(merchantId).filter((c) => new Date(c.createdAt).getTime() >= cutoff).length;
}
