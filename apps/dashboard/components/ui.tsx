import type { ReactNode } from 'react';
import { statusTone, titleCase } from '@/lib/format';

const TONE_CLASSES: Record<string, string> = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  progress: 'bg-blue-50 text-blue-700 border-blue-200',
  attention: 'bg-amber-50 text-amber-800 border-amber-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-slate-50 text-slate-500 border-slate-200',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONE_CLASSES[statusTone(status)];
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {titleCase(status)}
    </span>
  );
}

const SEVERITY_CLASSES: Record<string, string> = {
  LOW: 'bg-slate-100 text-slate-600 border-slate-200',
  ELEVATED: 'bg-amber-50 text-amber-800 border-amber-200',
  HIGH: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[severity] ?? SEVERITY_CLASSES.LOW}`}
    >
      {titleCase(severity)}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof TONE_CLASSES }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <p className="px-5 py-6 text-sm text-slate-400">{label}</p>;
}
