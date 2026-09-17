import type { ReactNode } from 'react';
import { statusTone, titleCase } from '@/lib/format';

const TONE_CLASSES: Record<string, string> = {
  neutral: 'bg-white text-ink/70 border-line',
  progress: 'bg-trust-soft text-trust border-trust/25',
  attention: 'bg-flag-soft text-flag border-flag/25',
  success: 'bg-trust text-white border-trust',
  closed: 'bg-paper text-muted border-line',
  alert: 'bg-alert-soft text-alert border-alert/25',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONE_CLASSES[statusTone(status)];
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide ${tone}`}>
      {titleCase(status)}
    </span>
  );
}

const SEVERITY_CLASSES: Record<string, string> = {
  LOW: 'bg-white text-ink/60 border-line',
  ELEVATED: 'bg-flag-soft text-flag border-flag/25',
  HIGH: 'bg-alert-soft text-alert border-alert/25',
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide ${SEVERITY_CLASSES[severity] ?? SEVERITY_CLASSES.LOW}`}
    >
      {titleCase(severity)}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof TONE_CLASSES }) {
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

/** The one signature element: a case's policy decision, rendered like an audit stamp. */
const STAMP_TONE: Record<string, string> = {
  ALLOW: 'border-trust text-trust ring-trust/20',
  DENY: 'border-alert text-alert ring-alert/20',
  REQUIRE_HUMAN_REVIEW: 'border-flag text-flag ring-flag/20',
};

export function Stamp({ outcome }: { outcome: 'ALLOW' | 'DENY' | 'REQUIRE_HUMAN_REVIEW' }) {
  const label = outcome === 'REQUIRE_HUMAN_REVIEW' ? 'Needs review' : titleCase(outcome);
  return (
    <span
      className={`inline-flex items-center rounded-sm border-2 bg-white px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] ring-2 ring-offset-2 ring-offset-white ${STAMP_TONE[outcome] ?? STAMP_TONE.REQUIRE_HUMAN_REVIEW}`}
    >
      {label}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-md border border-line bg-white shadow-sm ${className}`}>{children}</div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-5 py-3">
      <div>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <p className="px-5 py-6 text-sm text-muted">{label}</p>;
}
