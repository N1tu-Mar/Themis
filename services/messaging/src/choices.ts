import type { InboundMessage, OutboundMessage } from '../../../packages/contracts/src/index.ts';
export const CHOICES = Object.freeze([
  { label: 'Confirm all transactions', postback: 'CONFIRM_ALL_TRANSACTIONS' },
  { label: 'Select transactions', postback: 'SELECT_TRANSACTIONS' },
  { label: 'I recognize this', postback: 'RECOGNIZE' },
  { label: "I don't recognize this", postback: 'DO_NOT_RECOGNIZE' },
  { label: 'I canceled this', postback: 'CANCELED' },
  { label: 'Open dispute', postback: 'OPEN_DISPUTE' },
  { label: 'Request human review', postback: 'HUMAN_REVIEW' },
]);
export type Choice = NonNullable<OutboundMessage['suggestions']>[number];
// Numeric replies are interpreted ONLY against the active customer menu.
export function normalizeChoice(message: InboundMessage, choices: readonly Choice[] = []): InboundMessage {
  const input = message.text.trim().toLowerCase().replaceAll('’', "'");
  const numeric = /^[1-9]\d*$/.test(input) ? choices[Number(input) - 1] : undefined;
  const match = numeric ?? choices.find(c => c.label.toLowerCase().replaceAll('’', "'") === input);
  if (message.postback !== null) {
    if (!choices.some(c => c.postback === message.postback)) throw new Error('Unknown or stale postback');
    return message;
  }
  return match ? { ...message, postback: match.postback } : message;
}
export function smsText(message: OutboundMessage): string {
  if (!message.suggestions?.length) return message.text;
  return `${message.text}\n\nReply:\n${message.suggestions.map((c, i) => `${i + 1} — ${c.label}`).join('\n')}`;
}
