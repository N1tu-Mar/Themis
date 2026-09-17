'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge, Card, CardHeader } from '@/components/ui';
import { formatMoney, titleCase } from '@/lib/format';
import type { ReviewQueueEntry } from '@/lib/data/adapter';

type Decision = 'APPROVED' | 'REJECTED' | 'MORE_EVIDENCE' | null;

export function ReviewCard({ entry }: { entry: ReviewQueueEntry }) {
  const [decision, setDecision] = useState<Decision>(null);
  const { case: kase, request, report, merchantName } = entry;
  const proposal = report?.resolution;

  return (
    <Card>
      <CardHeader
        title={kase.caseId}
        subtitle={`${merchantName} · ${formatMoney(kase.totalDisputedAmount, kase.currency)}`}
        action={
          <Link href={`/cases/${kase.caseId}`} className="text-xs text-trust hover:underline">
            Open case →
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-6 px-5 py-4 text-sm">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">Reason for escalation</p>
          <p className="mt-1 text-ink/85">{request ? titleCase(request.reason) : 'Flagged by policy gate'}</p>
          {request && <p className="mt-1 text-xs text-muted">{request.summary}</p>}

          <p className="mt-3 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">Missing / conflicting evidence</p>
          {report && report.missingEvidence.length > 0 ? (
            <ul className="mt-1 list-inside list-disc text-ink/85">
              {report.missingEvidence.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-muted">
              {(report?.resolution?.contradictoryEvidence.length ?? 0) > 0
                ? `${report!.resolution!.contradictoryEvidence.length} contradictory item(s) — see case evidence`
                : 'None recorded'}
            </p>
          )}
        </div>

        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">Agent proposal</p>
          {proposal ? (
            <>
              <p className="mt-1 text-ink/85">{titleCase(proposal.classification)}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {proposal.recommendedActions.map((a) => <Badge key={a} tone="progress">{titleCase(a)}</Badge>)}
              </div>
              <p className="mt-1 font-mono text-xs text-muted">Confidence {Math.round(proposal.confidence * 100)}%</p>
            </>
          ) : (
            <p className="mt-1 text-muted">No proposal on file.</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        {decision ? (
          <Badge tone={decision === 'APPROVED' ? 'success' : decision === 'REJECTED' ? 'alert' : 'neutral'}>
            {decision === 'APPROVED' && 'Approved'}
            {decision === 'REJECTED' && 'Rejected'}
            {decision === 'MORE_EVIDENCE' && 'More evidence requested'}
          </Badge>
        ) : (
          <>
            <button
              onClick={() => setDecision('APPROVED')}
              className="rounded-sm border border-trust/30 bg-trust-soft px-3 py-1.5 text-xs font-medium text-trust transition-colors hover:bg-trust hover:text-white"
            >
              Approve proposed action
            </button>
            <button
              onClick={() => setDecision('REJECTED')}
              className="rounded-sm border border-alert/30 bg-alert-soft px-3 py-1.5 text-xs font-medium text-alert transition-colors hover:bg-alert hover:text-white"
            >
              Reject proposed action
            </button>
            <button
              onClick={() => setDecision('MORE_EVIDENCE')}
              className="rounded-sm border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink/80 transition-colors hover:bg-paper"
            >
              Request more evidence
            </button>
          </>
        )}
      </div>
    </Card>
  );
}
