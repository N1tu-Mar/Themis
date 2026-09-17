import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCase, getCaseReport, getMerchantProfile, auditEventsForCase } from '@/lib/data/adapter';
import { Badge, Card, CardHeader, EmptyState, SeverityBadge, StatusBadge } from '@/components/ui';
import { formatDate, formatMoney, titleCase } from '@/lib/format';
import type { Evidence } from '@themis/contracts';

const STAGES = ['Complaint', 'Investigation', 'Evidence', 'Policy', 'Outcome'] as const;

function stageIndex(status: string): number {
  if (['NEW', 'INTAKE'].includes(status)) return 0;
  if (['TRANSACTION_MATCHING', 'AWAITING_TRANSACTION_CONFIRMATION', 'CLASSIFYING_DISPUTE', 'INVESTIGATING', 'AWAITING_CUSTOMER_INFORMATION', 'AWAITING_MERCHANT_EVIDENCE'].includes(status)) return 1;
  if (['RESOLUTION_PROPOSED'].includes(status)) return 2;
  if (['POLICY_REVIEW', 'NEEDS_HUMAN_REVIEW'].includes(status)) return 3;
  return 4;
}

function EvidenceCard({ item, supporting, contradictory }: { item: Evidence; supporting: boolean; contradictory: boolean }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
      <div>
        <p className="text-sm text-slate-800">{item.claim}</p>
        <p className="mt-0.5 text-xs text-slate-400">{titleCase(item.type)} · source: {titleCase(item.source)}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone={item.reliability === 'HIGH' ? 'success' : item.reliability === 'LOW' ? 'attention' : 'neutral'}>
          {titleCase(item.reliability)} reliability
        </Badge>
        {supporting && <Badge tone="success">Supporting</Badge>}
        {contradictory && <Badge tone="attention">Contradictory</Badge>}
      </div>
    </li>
  );
}

export default async function CaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const kase = getCase(caseId);
  const report = getCaseReport(caseId);
  if (!kase || !report) notFound();

  const merchantProfile = report.merchant ? getMerchantProfile(report.merchant.merchantId) : undefined;
  const auditEvents = auditEventsForCase(caseId);
  const supportingIds = new Set(report.resolution?.supportingEvidence ?? []);
  const contradictoryIds = new Set(report.resolution?.contradictoryEvidence ?? []);
  const stage = stageIndex(kase.status);

  const evidenceByCategory = new Map<string, Evidence[]>();
  for (const e of report.evidence) {
    const list = evidenceByCategory.get(e.category) ?? [];
    list.push(e);
    evidenceByCategory.set(e.category, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/cases" className="text-xs text-slate-400 hover:text-slate-600">← All cases</Link>
        <div className="mt-1 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{caseId}</h1>
            <p className="text-sm text-slate-500">
              {report.merchant?.canonicalName ?? 'Unmatched merchant'} · {titleCase(report.classification)}
            </p>
          </div>
          <StatusBadge status={kase.status} />
        </div>
      </div>

      {/* Progression */}
      <ol className="flex items-center gap-2 text-xs">
        {STAGES.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1 font-medium ${
                i <= stage ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-400'
              }`}
            >
              {label}
            </span>
            {i < STAGES.length - 1 && <span className="text-slate-300">→</span>}
          </li>
        ))}
      </ol>

      {kase.requiresHumanReview && report.humanReviewEvents.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <div className="px-5 py-3 text-sm text-amber-900">
            <p className="font-semibold">Escalated for human review</p>
            {report.humanReviewEvents.map((r, i) => (
              <div key={i} className="mt-1">
                <p><span className="font-medium">Reason:</span> {titleCase(r.reason)}</p>
                <p><span className="font-medium">Next step:</span> {r.recommendedNextStep}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Customer complaint" />
        <p className="px-5 py-4 text-sm text-slate-700">{report.customerComplaintSummary}</p>
      </Card>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Affected transactions" subtitle={`Total disputed: ${formatMoney(report.totalDisputedAmount, report.currency)}`} />
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100">
              {report.transactions.map((t) => (
                <tr key={t.transactionId}>
                  <td className="px-5 py-2.5 text-slate-700">{t.descriptor}</td>
                  <td className="px-5 py-2.5 text-slate-400">{formatDate(t.occurredAt)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-slate-900">{formatMoney(t.amount, t.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader title="Merchant identity" />
          {report.merchant ? (
            <div className="px-5 py-4 text-sm">
              <p className="font-medium text-slate-900">{report.merchant.canonicalName}</p>
              <p className="mt-1 text-xs text-slate-500">Known descriptors:</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {report.merchant.aliases.map((a) => <Badge key={a}>{a}</Badge>)}
              </div>
              <Link href={`/merchants/${report.merchant.merchantId}`} className="mt-3 inline-block text-xs text-blue-700 hover:underline">
                View merchant intelligence →
              </Link>
            </div>
          ) : (
            <EmptyState label="No merchant matched to this case." />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Timeline" />
        <ol className="px-5 py-4">
          {report.timeline.map((event, i) => (
            <li key={i} className="flex gap-3 border-l border-slate-200 pb-4 pl-4 last:pb-0">
              <div>
                <p className="text-xs text-slate-400">{formatDate(event.timestamp)}</p>
                <p className="text-sm text-slate-700">{event.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardHeader title="Structured evidence" subtitle={`${report.evidence.length} items across ${evidenceByCategory.size} categories`} />
        {report.evidence.length === 0 ? (
          <EmptyState label="No evidence recorded yet." />
        ) : (
          <div className="divide-y divide-slate-100">
            {[...evidenceByCategory.entries()].map(([category, items]) => (
              <div key={category}>
                <p className="bg-slate-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {titleCase(category)}
                </p>
                <ul>
                  {items.map((item) => (
                    <EvidenceCard
                      key={item.evidenceId}
                      item={item}
                      supporting={supportingIds.has(item.evidenceId)}
                      contradictory={contradictoryIds.has(item.evidenceId)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {report.missingEvidence.length > 0 && (
          <div className="border-t border-slate-100 bg-amber-50/50 px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Missing evidence</p>
            <ul className="mt-1 list-inside list-disc text-sm text-amber-900">
              {report.missingEvidence.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </div>
        )}
      </Card>

      {merchantProfile && (
        <Card>
          <CardHeader title="Merchant intelligence" subtitle="What Themis has learned about this merchant" />
          <div className="grid grid-cols-3 gap-4 px-5 py-4 text-sm">
            <div>
              <p className="text-xs text-slate-400">Case history</p>
              <p className="mt-1 text-slate-700">
                {merchantProfile.caseStatistics.totalCases} total · {merchantProfile.caseStatistics.openCases} open ·{' '}
                {merchantProfile.caseStatistics.resolvedCustomerDisputes} resolved disputes
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Billing pattern</p>
              {merchantProfile.billingPatterns.map((b, i) => (
                <p key={i} className="mt-1 text-slate-700">
                  {formatMoney(b.amount, report.currency)} every {b.cadenceDays}d
                </p>
              ))}
            </div>
            <div>
              <p className="text-xs text-slate-400">Risk signals</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {merchantProfile.riskSignals.length === 0 ? (
                  <span className="text-slate-300">None active</span>
                ) : (
                  merchantProfile.riskSignals.map((r, i) => (
                    <SeverityBadge key={i} severity={r.severity} />
                  ))
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Resolution proposal" />
          {report.resolution ? (
            <div className="px-5 py-4 text-sm text-slate-700">
              <p>Classification: <span className="font-medium">{titleCase(report.resolution.classification)}</span></p>
              <p className="mt-1">Confidence: <span className="font-medium">{Math.round(report.resolution.confidence * 100)}%</span></p>
              <p className="mt-1">Recommended actions:</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {report.resolution.recommendedActions.map((a) => <Badge key={a} tone="progress">{titleCase(a)}</Badge>)}
              </div>
            </div>
          ) : (
            <EmptyState label="No resolution proposed yet." />
          )}
        </Card>

        <Card>
          <CardHeader title="Policy decisions" />
          {report.policyDecisions.length === 0 ? (
            <EmptyState label="No policy decisions recorded." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {report.policyDecisions.map((p) => (
                <li key={p.decisionId} className="px-5 py-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{titleCase(p.action)}</span>
                    <Badge tone={p.outcome === 'ALLOW' ? 'success' : p.outcome === 'DENY' ? 'attention' : 'neutral'}>
                      {titleCase(p.outcome)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{p.rationale}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Actions taken" />
        {report.actionsTaken.length === 0 ? (
          <EmptyState label="No actions taken yet." />
        ) : (
          <div className="flex flex-wrap gap-1.5 px-5 py-4">
            {report.actionsTaken.map((a, i) => <Badge key={i} tone="success">{titleCase(a)}</Badge>)}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Audit events" subtitle="Structured actions and outcomes — no hidden reasoning" />
        {auditEvents.length === 0 ? (
          <EmptyState label="No audit events recorded." />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">Time</th>
                <th className="px-5 py-2 font-medium">Actor</th>
                <th className="px-5 py-2 font-medium">Action</th>
                <th className="px-5 py-2 font-medium">Tool</th>
                <th className="px-5 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditEvents.map((e) => (
                <tr key={e.eventId}>
                  <td className="px-5 py-2 text-slate-400">{formatDate(e.timestamp)}</td>
                  <td className="px-5 py-2 text-slate-700">{titleCase(e.actor)}</td>
                  <td className="px-5 py-2 text-slate-700">{titleCase(e.action)}</td>
                  <td className="px-5 py-2 text-slate-500">{e.tool}</td>
                  <td className="px-5 py-2">
                    <Badge tone={e.result === 'SUCCESS' ? 'success' : e.result === 'FAILURE' ? 'attention' : 'neutral'}>
                      {titleCase(e.result)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
