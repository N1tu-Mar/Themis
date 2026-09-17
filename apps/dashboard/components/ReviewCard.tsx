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
          <Link href={`/cases/${kase.caseId}`} className="text-xs text-blue-700 hover:underline">
            Open case →
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-6 px-5 py-4 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reason for escalation</p>
          <p className="mt-1 text-slate-700">{request ? titleCase(request.reason) : 'Flagged by policy gate'}</p>
          {request && <p className="mt-1 text-xs text-slate-500">{request.summary}</p>}

          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Missing / conflicting evidence</p>
          {report && report.missingEvidence.length > 0 ? (
            <ul className="mt-1 list-inside list-disc text-slate-700">
              {report.missingEvidence.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-slate-500">
              {(report?.resolution?.contradictoryEvidence.length ?? 0) > 0
                ? `${report!.resolution!.contradictoryEvidence.length} contradictory item(s) — see case evidence`
                : 'None recorded'}
            </p>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Agent proposal</p>
          {proposal ? (
            <>
              <p className="mt-1 text-slate-700">{titleCase(proposal.classification)}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {proposal.recommendedActions.map((a) => <Badge key={a} tone="progress">{titleCase(a)}</Badge>)}
              </div>
              <p className="mt-1 text-xs text-slate-500">Confidence {Math.round(proposal.confidence * 100)}%</p>
            </>
          ) : (
            <p className="mt-1 text-slate-500">No proposal on file.</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 px-5 py-3">
        {decision ? (
          <Badge tone={decision === 'APPROVED' ? 'success' : decision === 'REJECTED' ? 'attention' : 'neutral'}>
            {decision === 'APPROVED' && 'Approved'}
            {decision === 'REJECTED' && 'Rejected'}
            {decision === 'MORE_EVIDENCE' && 'More evidence requested'}
          </Badge>
        ) : (
          <>
            <button
              onClick={() => setDecision('APPROVED')}
              className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              Approve proposed action
            </button>
            <button
              onClick={() => setDecision('REJECTED')}
              className="rounded border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
            >
              Reject proposed action
            </button>
            <button
              onClick={() => setDecision('MORE_EVIDENCE')}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Request more evidence
            </button>
          </>
        )}
      </div>
    </Card>
  );
}
