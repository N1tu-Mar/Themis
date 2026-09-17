import Link from 'next/link';
import { listCases, getMerchantProfile } from '@/lib/data/adapter';
import { StatusBadge } from '@/components/ui';
import { formatDate, formatMoney, titleCase } from '@/lib/format';

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
  let cases = listCases();
  if (status) cases = cases.filter((c) => c.status === status);
  if (review === '1') cases = cases.filter((c) => c.requiresHumanReview);
  cases = [...cases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Cases</h1>
          <p className="text-sm text-slate-500">{cases.length} of {listCases().length} cases</p>
        </div>
        <form className="flex items-center gap-3 text-sm" action="/cases">
          <select
            name="status"
            defaultValue={status ?? ''}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-700"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-slate-600">
            <input type="checkbox" name="review" value="1" defaultChecked={review === '1'} />
            Needs review
          </label>
          <button type="submit" className="rounded border border-slate-300 bg-slate-900 px-3 py-1.5 text-white">
            Apply
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
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
          <tbody className="divide-y divide-slate-100">
            {cases.map((c) => {
              const merchant = c.merchantId ? getMerchantProfile(c.merchantId) : undefined;
              return (
                <tr key={c.caseId} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/cases/${c.caseId}`} className="font-medium text-slate-900 hover:underline">
                      {c.caseId}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-2.5 text-slate-700">{merchant?.canonicalName ?? 'Unmatched'}</td>
                  <td className="px-4 py-2.5 text-slate-700">{titleCase(c.claimType)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {formatMoney(c.totalDisputedAmount, c.currency)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{formatDate(c.updatedAt)}</td>
                  <td className="px-4 py-2.5">
                    {c.requiresHumanReview ? (
                      <span className="text-xs font-medium text-amber-700">● Escalated</span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {cases.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                  No cases match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
