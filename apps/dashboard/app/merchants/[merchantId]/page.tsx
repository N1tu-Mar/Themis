import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMerchantProfile, casesForMerchant, recentCaseCount, commonDisputeType } from '@/lib/data/adapter';
import { Badge, Card, CardHeader, EmptyState, SeverityBadge, StatusBadge } from '@/components/ui';
import { formatDate, formatMoney, titleCase } from '@/lib/format';

export default async function MerchantDetailPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  const merchant = getMerchantProfile(merchantId);
  if (!merchant) notFound();

  const cases = [...casesForMerchant(merchantId)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const dispute = commonDisputeType(merchantId);
  const recent = recentCaseCount(merchantId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/merchants" className="text-xs text-slate-400 hover:text-slate-600">← All merchants</Link>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">{merchant.canonicalName}</h1>
        <p className="text-sm text-slate-500">{merchant.merchantId}</p>
      </div>

      <Card>
        <CardHeader title="Descriptor aliases" subtitle="Statement descriptors observed for this merchant" />
        <div className="flex flex-wrap gap-1.5 px-5 py-4">
          {merchant.aliases.map((a) => <Badge key={a}>{a}</Badge>)}
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-6">
        <Card>
          <CardHeader title="Case history" />
          <div className="px-5 py-4 text-sm text-slate-700">
            <p>{merchant.caseStatistics.totalCases} total cases</p>
            <p className="mt-1">{merchant.caseStatistics.openCases} open</p>
            <p className="mt-1">{merchant.caseStatistics.resolvedCustomerDisputes} resolved disputes</p>
            <p className="mt-1 text-slate-500">{recent} in last 90 days</p>
            {dispute && <p className="mt-1 text-slate-500">Most common: {titleCase(dispute)}</p>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Billing patterns" />
          {merchant.billingPatterns.length === 0 ? (
            <EmptyState label="No recurring pattern on file." />
          ) : (
            <ul className="px-5 py-4 text-sm text-slate-700">
              {merchant.billingPatterns.map((b, i) => (
                <li key={i}>{formatMoney(b.amount, 'USD')} every {b.cadenceDays} days</li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Research status" />
          <div className="px-5 py-4 text-sm text-slate-700">
            <p>Last researched</p>
            <p className="mt-1 font-medium text-slate-900">{formatDate(merchant.updatedAt)}</p>
            <p className="mt-2 text-xs text-slate-400">Cached — institutional memory reused, not re-researched per case.</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Current risk signals" />
        {merchant.riskSignals.length === 0 ? (
          <EmptyState label="No active risk signals." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {merchant.riskSignals.map((r, i) => (
              <li key={i} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <div>
                  <p className="font-medium text-slate-800">{titleCase(r.type)}</p>
                  <p className="text-xs text-slate-400">
                    Observed {formatDate(r.observedAt)} · expires {formatDate(r.expiresAt)} · {r.evidenceRefs.length} linked evidence items
                  </p>
                </div>
                <SeverityBadge severity={r.severity} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Related cases" subtitle={`${cases.length} cases on record`} />
        {cases.length === 0 ? (
          <EmptyState label="No cases on record for this merchant." />
        ) : (
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100">
              {cases.map((c) => (
                <tr key={c.caseId} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5">
                    <Link href={`/cases/${c.caseId}`} className="font-medium text-slate-900 hover:underline">{c.caseId}</Link>
                  </td>
                  <td className="px-5 py-2.5"><StatusBadge status={c.status} /></td>
                  <td className="px-5 py-2.5 text-slate-600">{titleCase(c.claimType)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-slate-700">{formatMoney(c.totalDisputedAmount, c.currency)}</td>
                  <td className="px-5 py-2.5 text-slate-400">{formatDate(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
