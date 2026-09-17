import { listReviewQueue } from '@/lib/data/adapter';
import { ReviewCard } from '@/components/ReviewCard';
import { EmptyState, Card } from '@/components/ui';

export default function ReviewPage() {
  const queue = listReviewQueue();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Escalation queue</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">Human review</h1>
        <p className="mt-0.5 text-sm text-muted">{queue.length} case(s) escalated by policy — mock actions only, no backend write yet</p>
      </div>

      {queue.length === 0 ? (
        <Card><EmptyState label="No cases currently require human review." /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {queue.map((entry) => <ReviewCard key={entry.case.caseId} entry={entry} />)}
        </div>
      )}
    </div>
  );
}
