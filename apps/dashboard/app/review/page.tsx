import { listReviewQueue } from '@/lib/data/adapter';
import { ReviewCard } from '@/components/ReviewCard';
import { EmptyState, Card } from '@/components/ui';

export default function ReviewPage() {
  const queue = listReviewQueue();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Human review queue</h1>
        <p className="text-sm text-slate-500">{queue.length} case(s) escalated by policy — mock actions only, no backend write yet</p>
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
