import Link from 'next/link';
import { listMerchantProfiles, commonDisputeType, recentCaseCount } from '@/lib/data/adapter';
import { SeverityBadge } from '@/components/ui';
import { formatDate, titleCase } from '@/lib/format';

export default function MerchantsPage() {
  const merchants = [...listMerchantProfiles()].sort((a, b) => b.caseStatistics.totalCases - a.caseStatistics.totalCases);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Merchants</h1>
        <p className="text-sm text-slate-500">{merchants.length} merchants with institutional history</p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
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
          <tbody className="divide-y divide-slate-100">
            {merchants.map((m) => {
              const dispute = commonDisputeType(m.merchantId);
              const recent = recentCaseCount(m.merchantId);
              return (
                <tr key={m.merchantId} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/merchants/${m.merchantId}`} className="font-medium text-slate-900 hover:underline">
                      {m.canonicalName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{m.aliases.slice(0, 2).join(', ')}{m.aliases.length > 2 ? ` +${m.aliases.length - 2}` : ''}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {m.caseStatistics.totalCases}
                    <span className="ml-1 text-xs text-slate-400">({m.caseStatistics.openCases} open)</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{recent} in last 90d</td>
                  <td className="px-4 py-2.5 text-slate-700">{dispute ? titleCase(dispute) : '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {m.riskSignals.length === 0 ? (
                        <span className="text-xs text-slate-300">None active</span>
                      ) : (
                        m.riskSignals.map((r, i) => <SeverityBadge key={i} severity={r.severity} />)
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{formatDate(m.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
