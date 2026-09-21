import Link from 'next/link';
import { dataStatus, listCases, listMerchantProfiles, commonDisputeType, recentCaseCount, referenceTime } from '@/lib/data/adapter';
import { SeverityBadge } from '@/components/ui';
import { DataNotice } from '@/components/DataNotice';

export const dynamic = 'force-dynamic';
import { formatDate, titleCase } from '@/lib/format';

export default async function MerchantsPage() {
  const [profiles, cases, now] = await Promise.all([listMerchantProfiles(), listCases(), referenceTime()]);
  const status = await dataStatus();
  const merchants = [...profiles].sort((a, b) => b.caseStatistics.totalCases - a.caseStatistics.totalCases);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Institutional memory</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">Merchants</h1>
        <p className="mt-0.5 font-mono text-xs text-muted">{merchants.length} on record</p>
      </div>

      <DataNotice status={status} />

      <div className="overflow-hidden rounded-md border border-line bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-paper font-mono text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Merchant</th>
              <th className="px-4 py-2.5 font-medium">Known descriptors</th>
              <th className="px-4 py-2.5 font-medium text-right">Cases</th>
              <th className="px-4 py-2.5 font-medium">Recent trend</th>
              <th className="px-4 py-2.5 font-medium">Common dispute</th>
              <th className="px-4 py-2.5 font-medium">Risk signals</th>
              <th className="px-4 py-2.5 font-medium">Last researched</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {merchants.map((m) => {
              const merchantCases = cases.filter((c) => c.merchantId === m.merchantId);
              const dispute = commonDisputeType(merchantCases);
              const recent = recentCaseCount(merchantCases, now);
              return (
                <tr key={m.merchantId} className="transition-colors hover:bg-paper">
                  <td className="px-4 py-2.5">
                    <Link href={`/merchants/${m.merchantId}`} className="font-medium text-ink hover:underline">
                      {m.canonicalName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{m.aliases.slice(0, 2).join(', ')}{m.aliases.length > 2 ? ` +${m.aliases.length - 2}` : ''}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink/80">
                    {m.caseStatistics.totalCases}
                    <span className="ml-1 text-xs text-muted">({m.caseStatistics.openCases} open)</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink/70">{recent} in last 90d</td>
                  <td className="px-4 py-2.5 text-ink/80">{dispute ? titleCase(dispute) : '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {m.riskSignals.length === 0 ? (
                        <span className="text-xs text-line">None active</span>
                      ) : (
                        m.riskSignals.map((r, i) => <SeverityBadge key={i} severity={r.severity} />)
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{formatDate(m.updatedAt)}</td>
                </tr>
              );
            })}
            {merchants.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">No merchant profiles on record yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
