import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCase, getCaseReport, getMerchantProfile, auditEventsForCase } from '@/lib/data/adapter';
import { Badge, Card, CardHeader, EmptyState, SeverityBadge, Stamp, StatusBadge } from '@/components/ui';
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
    <li className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5 last:border-0">
      <div>
        <p className="text-sm text-ink/85">{item.claim}</p>
        <p className="mt-0.5 font-mono text-[11px] text-muted">{titleCase(item.type)} · source: {titleCase(item.source)}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone={item.reliability === 'HIGH' ? 'success' : item.reliability === 'LOW' ? 'alert' : 'neutral'}>
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
        <Link href="/cases" className="font-mono text-xs text-muted hover:text-ink">← All cases</Link>
        <div className="mt-1 flex items-center justify-between">
          <div>
            <h1 className="font-mono text-lg font-semibold text-ink">{caseId}</h1>
            <p className="text-sm text-muted">
              {report.merchant?.canonicalName ?? 'Unmatched merchant'} · {titleCase(report.classification)}
            </p>
          </div>
          <StatusBadge status={kase.status} />
        </div>
      </div>

      <div className="flex items-center rounded-md border border-line bg-white px-5 py-4">
        {STAGES.map((label, i) => (
          <Fragment key={label}>
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[11px] ${
                  i <= stage ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted'
                }`}
              >
                {i + 1}
              </span>
              <span className={`font-mono text-[10px] uppercase tracking-wide ${i <= stage ? 'text-ink' : 'text-muted'}`}>
                {label}
              </span>
            </div>
            {i < STAGES.length - 1 && <div className={`mx-3 h-px flex-1 ${i < stage ? 'bg-ink' : 'bg-line'}`} />}
          </Fragment>
        ))}
      </div>

      {kase.requiresHumanReview && report.humanReviewEvents.length > 0 && (
        <Card className="border-flag/40 bg-flag-soft">
          <div className="px-5 py-3 text-sm text-ink">
            <p className="font-semibold text-flag">Escalated for human review</p>
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
        <p className="px-5 py-4 text-sm text-ink/85">{report.customerComplaintSummary}</p>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Affected transactions" subtitle={`Total disputed: ${formatMoney(report.totalDisputedAmount, report.currency)}`} />
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-line">
              {report.transactions.map((t) => (
                <tr key={t.transactionId}>
                  <td className="px-5 py-2.5 text-ink/85">{t.descriptor}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-muted">{formatDate(t.occurredAt)}</td>
                  <td className="px-5 py-2.5 text-right font-mono tabular-nums text-ink">{formatMoney(t.amount, t.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader title="Merchant identity" />
          {report.merchant ? (
            <div className="px-5 py-4 text-sm">
              <p className="font-medium text-ink">{report.merchant.canonicalName}</p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted">Known descriptors</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {report.merchant.aliases.map((a) => <Badge key={a}>{a}</Badge>)}
              </div>
              <Link href={`/merchants/${report.merchant.merchantId}`} className="mt-3 inline-block text-xs text-trust hover:underline">
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
            <li key={i} className="flex gap-3 border-l border-line pb-4 pl-4 last:pb-0">
              <div>
                <p className="font-mono text-[11px] text-muted">{formatDate(event.timestamp)}</p>
                <p className="text-sm text-ink/85">{event.summary}</p>
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
          <div className="divide-y divide-line">
            {[...evidenceByCategory.entries()].map(([category, items]) => (
              <div key={category}>
                <p className="bg-paper px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
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
          <div className="border-t border-line bg-flag-soft px-4 py-2.5">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-flag">Missing evidence</p>
            <ul className="mt-1 list-inside list-disc text-sm text-ink/85">
              {report.missingEvidence.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </div>
        )}
      </Card>

      {merchantProfile && (
        <Card>
          <CardHeader title="Merchant intelligence" subtitle="What Themis has learned about this merchant" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 px-5 py-4 text-sm">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wide text-muted">Case history</p>
              <p className="mt-1 text-ink/85">
                {merchantProfile.caseStatistics.totalCases} total · {merchantProfile.caseStatistics.openCases} open ·{' '}
                {merchantProfile.caseStatistics.resolvedCustomerDisputes} resolved disputes
              </p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wide text-muted">Billing pattern</p>
              {merchantProfile.billingPatterns.map((b, i) => (
                <p key={i} className="mt-1 font-mono text-ink/85">
                  {formatMoney(b.amount, report.currency)} every {b.cadenceDays}d
                </p>
              ))}
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wide text-muted">Risk signals</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {merchantProfile.riskSignals.length === 0 ? (
                  <span className="text-line">None active</span>
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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Resolution proposal" />
          {report.resolution ? (
            <div className="px-5 py-4 text-sm text-ink/85">
              <p>Classification: <span className="font-medium text-ink">{titleCase(report.resolution.classification)}</span></p>
              <p className="mt-1">Confidence: <span className="font-mono font-medium text-ink">{Math.round(report.resolution.confidence * 100)}%</span></p>
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
            <ul className="divide-y divide-line">
              {report.policyDecisions.map((p) => (
                <li key={p.decisionId} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <span className="font-medium text-ink">{titleCase(p.action)}</span>
                    <p className="mt-0.5 text-xs text-muted">{p.rationale}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-line">{p.decisionId}</p>
                  </div>
                  <Stamp outcome={p.outcome} />
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
            <thead className="border-b border-line bg-paper font-mono text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Time</th>
                <th className="px-5 py-2 font-medium">Actor</th>
                <th className="px-5 py-2 font-medium">Action</th>
                <th className="px-5 py-2 font-medium">Tool</th>
                <th className="px-5 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {auditEvents.map((e) => (
                <tr key={e.eventId}>
                  <td className="px-5 py-2 font-mono text-xs text-muted">{formatDate(e.timestamp)}</td>
                  <td className="px-5 py-2 text-ink/85">{titleCase(e.actor)}</td>
                  <td className="px-5 py-2 text-ink/85">{titleCase(e.action)}</td>
                  <td className="px-5 py-2 font-mono text-xs text-muted">{e.tool}</td>
                  <td className="px-5 py-2">
                    <Badge tone={e.result === 'SUCCESS' ? 'success' : e.result === 'FAILURE' ? 'alert' : 'neutral'}>
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
