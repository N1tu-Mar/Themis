import Link from 'next/link';
import { listMerchantProfiles, commonDisputeType, recentCaseCount } from '@/lib/data/adapter';
import { SeverityBadge } from '@/components/ui';
import { formatDate, titleCase } from '@/lib/format';

export default function MerchantsPage() {
  const merchants = [...listMerchantProfiles()].sort((a, b) => b.caseStatistics.totalCases - a.caseStatistics.totalCases);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">Institutional memory</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">Merchants</h1>
        <p className="mt-0.5 font-mono text-xs text-muted">{merchants.length} on record</p>
      </div>

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
              const dispute = commonDisputeType(m.merchantId);
              const recent = recentCaseCount(m.merchantId);
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
