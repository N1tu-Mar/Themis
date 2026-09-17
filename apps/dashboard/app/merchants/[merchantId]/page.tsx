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
        <Link href="/merchants" className="font-mono text-xs text-muted hover:text-ink">← All merchants</Link>
        <h1 className="mt-1 text-xl font-semibold text-ink">{merchant.canonicalName}</h1>
        <p className="font-mono text-xs text-muted">{merchant.merchantId}</p>
      </div>

      <Card>
        <CardHeader title="Descriptor aliases" subtitle="Statement descriptors observed for this merchant" />
        <div className="flex flex-wrap gap-1.5 px-5 py-4">
          {merchant.aliases.map((a) => <Badge key={a}>{a}</Badge>)}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Card>
          <CardHeader title="Case history" />
          <div className="px-5 py-4 text-sm text-ink/85">
            <p>{merchant.caseStatistics.totalCases} total cases</p>
            <p className="mt-1">{merchant.caseStatistics.openCases} open</p>
            <p className="mt-1">{merchant.caseStatistics.resolvedCustomerDisputes} resolved disputes</p>
            <p className="mt-1 text-muted">{recent} in last 90 days</p>
            {dispute && <p className="mt-1 text-muted">Most common: {titleCase(dispute)}</p>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Billing patterns" />
          {merchant.billingPatterns.length === 0 ? (
            <EmptyState label="No recurring pattern on file." />
          ) : (
            <ul className="px-5 py-4 font-mono text-sm text-ink/85">
              {merchant.billingPatterns.map((b, i) => (
                <li key={i}>{formatMoney(b.amount, 'USD')} every {b.cadenceDays} days</li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Research status" />
          <div className="px-5 py-4 text-sm text-ink/85">
            <p>Last researched</p>
            <p className="mt-1 font-mono font-medium text-ink">{formatDate(merchant.updatedAt)}</p>
            <p className="mt-2 text-xs text-muted">Cached — institutional memory reused, not re-researched per case.</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Current risk signals" />
        {merchant.riskSignals.length === 0 ? (
          <EmptyState label="No active risk signals." />
        ) : (
          <ul className="divide-y divide-line">
            {merchant.riskSignals.map((r, i) => (
              <li key={i} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <div>
                  <p className="font-medium text-ink">{titleCase(r.type)}</p>
                  <p className="font-mono text-[11px] text-muted">
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
            <tbody className="divide-y divide-line">
              {cases.map((c) => (
                <tr key={c.caseId} className="transition-colors hover:bg-paper">
                  <td className="px-5 py-2.5">
                    <Link href={`/cases/${c.caseId}`} className="font-mono text-[13px] font-medium text-ink hover:underline">{c.caseId}</Link>
                  </td>
                  <td className="px-5 py-2.5"><StatusBadge status={c.status} /></td>
                  <td className="px-5 py-2.5 text-ink/80">{titleCase(c.claimType)}</td>
                  <td className="px-5 py-2.5 text-right font-mono tabular-nums text-ink/80">{formatMoney(c.totalDisputedAmount, c.currency)}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-muted">{formatDate(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
