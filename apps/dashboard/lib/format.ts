export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

const STATUS_TONE: Record<string, 'neutral' | 'progress' | 'attention' | 'success' | 'closed'> = {
  NEW: 'neutral',
  INTAKE: 'neutral',
  TRANSACTION_MATCHING: 'progress',
  AWAITING_TRANSACTION_CONFIRMATION: 'progress',
  CLASSIFYING_DISPUTE: 'progress',
  INVESTIGATING: 'progress',
  AWAITING_CUSTOMER_INFORMATION: 'attention',
  AWAITING_MERCHANT_EVIDENCE: 'attention',
  RESOLUTION_PROPOSED: 'progress',
  POLICY_REVIEW: 'progress',
  NEEDS_HUMAN_REVIEW: 'attention',
  ACTION_APPROVED: 'success',
  RESOLVED: 'success',
  CLOSED: 'closed',
};

export function statusTone(status: string): 'neutral' | 'progress' | 'attention' | 'success' | 'closed' {
  return STATUS_TONE[status] ?? 'neutral';
}
