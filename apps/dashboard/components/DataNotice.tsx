import type { DataStatus } from '@/lib/data/adapter';
import { formatDate } from '@/lib/format';

/** Renders nothing for healthy data (so fixture mode looks unchanged); otherwise a stale / skipped-records notice. */
export function DataNotice({ status }: { status: DataStatus }) {
  if (!status.stale && status.skippedRecords === 0) return null;
  return (
    <div role="status" className="rounded-md border border-flag/30 bg-flag-soft px-4 py-2.5 text-sm text-flag">
      {status.stale && (
        <p>
          <span className="font-medium">Showing stale data.</span> The backend could not be reached; this is the last copy
          {status.staleSince ? ` fetched ${formatDate(status.staleSince)}` : ''}. Newer cases and merchant updates may be missing.
        </p>
      )}
      {status.skippedRecords > 0 && (
        <p>
          <span className="font-medium">{status.skippedRecords} record(s) hidden.</span> They failed contract validation and are not shown.
        </p>
      )}
    </div>
  );
}
