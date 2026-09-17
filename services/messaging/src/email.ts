import { CaseSchema, CaseReportSchema, type Case, type CaseReport } from '../../../packages/contracts/src/index.ts';
import { DeliveryError, type Payload } from './outbound.ts';
export function caseEmail(input: { case: Case; report: CaseReport; recipient: string; sender: string; support: string; nextSteps: readonly string[] }) {
  const c = CaseSchema.parse(input.case);
  const report = CaseReportSchema.parse(input.report);
  if (report.caseId !== c.caseId || report.currency !== c.currency || report.totalDisputedAmount !== c.totalDisputedAmount) throw new Error('Case/report mismatch');
  if (report.transactions.length !== c.transactionIds.length || new Set(c.transactionIds).size !== c.transactionIds.length || new Set(report.transactions.map(t => t.transactionId)).size !== report.transactions.length || report.transactions.some(t => !c.transactionIds.includes(t.transactionId) || t.customerId !== c.customerId || t.currency !== c.currency || (c.merchantId !== null && t.merchantId !== c.merchantId)) || (report.merchant?.merchantId ?? null) !== c.merchantId) throw new Error('Case/report references mismatch');
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency: c.currency }).resolvedOptions().maximumFractionDigits!;
  const scale = 10 ** digits;
  const minor = (value: number) => { const amount = Math.round(value * scale); if (!Number.isSafeInteger(amount) || Math.abs(value * scale - amount) > 0.000001) throw new Error('Amount has invalid currency precision'); return amount; };
  if (report.transactions.reduce((sum, t) => sum + minor(t.amount), 0) !== minor(c.totalDisputedAmount)) throw new Error('Transaction total mismatch');
  if (!input.support.trim() || !input.nextSteps.length || input.nextSteps.some(s => !s.trim())) throw new Error('Support and next steps are required');
  for (const address of [input.sender, input.recipient]) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Invalid email address');
  const amount = (n: number) => `${c.currency} ${n.toFixed(digits)}`;
  const body = [
    `Case number: ${c.caseId}`, `Merchant: ${report.merchant?.canonicalName ?? 'Not identified'}`,
    `Status: ${c.status}`, `Total disputed amount: ${amount(c.totalDisputedAmount)}`,
    '', 'Transactions:', ...report.transactions.map(t => `${t.transactionId} | ${t.occurredAt} | ${t.descriptor} | ${amount(t.amount)}`),
    '', 'Actions taken:', ...(report.actionsTaken.length ? report.actionsTaken : ['No actions recorded']),
    '', 'Next steps:', ...input.nextSteps, '', `Support: ${input.support}`,
  ].join('\n');
  return { FromEmailAddress: input.sender, Destination: { ToAddresses: [input.recipient] },
    Content: { Simple: { Subject: { Data: `Themis case ${c.caseId}: ${c.status}`, Charset: 'UTF-8' },
      Body: { Text: { Data: body, Charset: 'UTF-8' } } } } };
}
export interface SesClient { sendEmail(payload: Payload): Promise<{ MessageId?: string }> }
export class SesAdapter {
  readonly captured: ReturnType<typeof caseEmail>[] = [];
  private mode: 'local' | 'aws';
  private client?: SesClient;
  constructor(mode: 'local' | 'aws', client?: SesClient) { this.mode = mode; this.client = client; }
  async send(input: Parameters<typeof caseEmail>[0]): Promise<string> {
    const payload = caseEmail(input);
    if (this.mode === 'local') { this.captured.push(structuredClone(payload)); return `local:email:${input.case.caseId}`; }
    try {
      if (!this.client) throw new Error('AWS SES client not configured');
      const result = await this.client.sendEmail(payload);
      if (!result.MessageId) throw new Error('SES did not accept email');
      return result.MessageId;
    } catch (cause) { throw new DeliveryError('EMAIL', input.case.caseId, { cause }); }
  }
}
