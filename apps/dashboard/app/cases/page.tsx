import Link from 'next/link';
import { dataStatus, listCases, listMerchantProfiles } from '@/lib/data/adapter';
import { StatusBadge } from '@/components/ui';
import { DataNotice } from '@/components/DataNotice';
import { formatDate, formatMoney, titleCase } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STATUSES = [
  'NEW', 'INTAKE', 'TRANSACTION_MATCHING', 'AWAITING_TRANSACTION_CONFIRMATION',
  'CLASSIFYING_DISPUTE', 'INVESTIGATING', 'AWAITING_CUSTOMER_INFORMATION',
  'AWAITING_MERCHANT_EVIDENCE', 'RESOLUTION_PROPOSED', 'POLICY_REVIEW',
  'NEEDS_HUMAN_REVIEW', 'ACTION_APPROVED', 'RESOLVED', 'CLOSED',
];

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; review?: string }>;
}) {
  const { status, review } = await searchParams;
  const [allCases, merchantProfiles] = await Promise.all([listCases(), listMerchantProfiles()]);
  const notice = await dataStatus();
  const merchantsById = new Map(merchantProfiles.map((m) => [m.merchantId, m]));
  let cases = allCases;
  if (status) cases = cases.filter((c) => c.status === status);
  if (review === '1') cases = cases.filter((c) => c.requiresHumanReview);
  cases = [...cases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Case ledger</p>
          <h1 className="mt-1 text-xl font-semibold text-ink">Cases</h1>
          <p className="mt-0.5 font-mono text-xs text-muted">{cases.length} / {allCases.length} on record</p>
        </div>
        <form className="flex items-center gap-3 text-sm" action="/cases">
          <select
            name="status"
            defaultValue={status ?? ''}
            className="rounded-sm border border-line bg-white px-2 py-1.5 text-ink/80"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-ink/70">
            <input type="checkbox" name="review" value="1" defaultChecked={review === '1'} />
            Needs review
          </label>
          <button type="submit" className="rounded-sm border border-ink bg-ink px-3 py-1.5 text-white transition-colors hover:bg-ink/90">
            Apply
          </button>
        </form>
      </div>

      <DataNotice status={notice} />

      <div className="overflow-hidden rounded-md border border-line bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-paper font-mono text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Case</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Merchant</th>
              <th className="px-4 py-2.5 font-medium">Classification</th>
              <th className="px-4 py-2.5 font-medium text-right">Disputed</th>
              <th className="px-4 py-2.5 font-medium">Updated</th>
              <th className="px-4 py-2.5 font-medium">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {cases.map((c) => {
              const merchant = c.merchantId ? merchantsById.get(c.merchantId) : undefined;
              return (
                <tr key={c.caseId} className="transition-colors hover:bg-paper">
                  <td className="px-4 py-2.5">
                    <Link href={`/cases/${c.caseId}`} className="font-mono text-[13px] font-medium text-ink hover:underline">
                      {c.caseId}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-2.5 text-ink/80">{merchant?.canonicalName ?? 'Unmatched'}</td>
                  <td className="px-4 py-2.5 text-ink/80">{titleCase(c.claimType)}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink/80">
                    {formatMoney(c.totalDisputedAmount, c.currency)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{formatDate(c.updatedAt)}</td>
                  <td className="px-4 py-2.5">
                    {c.requiresHumanReview ? (
                      <span className="text-xs font-medium text-flag">● Escalated</span>
                    ) : (
                      <span className="text-xs text-line">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {cases.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">
                  {allCases.length === 0 ? 'No cases on record yet.' : 'No cases match this filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
