import {
  CaseSchema, CaseReportSchema, MerchantProfileSchema, HumanReviewRequestSchema, AuditEventSchema,
} from '@themis/contracts';
import type { DataProvider } from './provider';

import casesRaw from '../../../../fixtures/cases/demo.json';
import reportsRaw from '../../../../fixtures/cases/demo-reports.json';
import merchantProfilesRaw from '../../../../fixtures/merchants/demo-profiles.json';
import humanReviewRaw from '../../../../fixtures/cases/demo-human-review-requests.json';
import auditEventsRaw from '../../../../fixtures/cases/demo-audit-events.json';

const cases = CaseSchema.array().parse(casesRaw);
const reports = CaseReportSchema.array().parse(reportsRaw);
const merchantProfiles = MerchantProfileSchema.array().parse(merchantProfilesRaw);
const humanReviewRequests = HumanReviewRequestSchema.array().parse(humanReviewRaw);
const auditEvents = AuditEventSchema.array().parse(auditEventsRaw);

export const fixturesProvider: DataProvider = {
  source: 'fixtures',
  listCases: async () => cases,
  getCase: async (caseId) => cases.find((c) => c.caseId === caseId),
  getCaseReport: async (caseId) => reports.find((r) => r.caseId === caseId),
  listMerchantProfiles: async () => merchantProfiles,
  getMerchantProfile: async (merchantId) => merchantProfiles.find((m) => m.merchantId === merchantId),
  listHumanReviewRequests: async () => humanReviewRequests,
  listAuditEvents: async (caseId) => auditEvents.filter((e) => e.caseId === caseId),
  status: () => ({ source: 'fixtures', stale: false, skippedRecords: 0 }),
};
