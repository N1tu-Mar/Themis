import { OutboundMessageSchema, type OutboundMessage } from '../../../packages/contracts/src/index.ts';
import type { ActiveMenuStore } from './active-menu.ts';
import { parseSuggestions } from './choices.ts';
import type { DeliveryState, DeliveryStore, FinalDeliveryState } from './delivery-store.ts';
import type { SesAdapter } from './email.ts';
import type { ChannelAdapter } from './outbound.ts';

/** Case statuses after which a case menu must not stay actionable. */
export const TERMINAL_CASE_STATUSES: ReadonlySet<string> = new Set(['RESOLVED', 'CLOSED']);
const SETTLED: readonly DeliveryState[] = ['ACCEPTED', 'DELIVERED', 'UNDELIVERABLE'];

export interface DeliveryResult { readonly state: DeliveryState; readonly providerMessageId?: string }

/**
 * Menu-first, idempotent outbound delivery. The delivery record is keyed by (customer, messageId), so a Lambda retry
 * re-sends only what is not yet accepted and never re-runs anything upstream (AgentCore, case or money effects).
 */
export class OutboundService {
  private readonly channel: ChannelAdapter;
  private readonly menus: ActiveMenuStore;
  private readonly deliveries: DeliveryStore;
  private readonly rcsEnabled: boolean;
  constructor(options: { channel: ChannelAdapter; menus: ActiveMenuStore; deliveries: DeliveryStore; rcsEnabled: boolean }) {
    this.channel = options.channel; this.menus = options.menus; this.deliveries = options.deliveries; this.rcsEnabled = options.rcsEnabled;
  }

  /** `terminal`: the case is finished — send text only; the caller clears the case's menu. */
  async deliver(input: OutboundMessage, terminal = false): Promise<DeliveryResult> {
    let message = OutboundMessageSchema.parse(input);
    if (message.suggestions) parseSuggestions(message.suggestions);
    // Without RCS the same choices go out as numbered SMS text (smsText), matching the stored menu.
    if (message.channel === 'RCS' && !this.rcsEnabled) message = { ...message, channel: 'SMS' };
    if (terminal) {
      const { suggestions: _dropped, ...text } = message;
      message = text;
    }
    const record = await this.deliveries.begin({ customerExternalId: message.customerExternalId, messageId: message.messageId, message });
    if (SETTLED.includes(record.state)) return record;
    // Persist the menu before delivery so an early customer reply can never miss it.
    if (message.suggestions?.length) {
      await this.menus.set({ customerExternalId: message.customerExternalId, caseId: message.caseId, menuId: `menu:${message.messageId}`, choices: message.suggestions });
    }
    return this.send(record.message!);
  }

  /** Retry path for a duplicate inbound: re-send a recorded reply. True once it is settled. */
  async resume(customerExternalId: string, messageId: string): Promise<boolean> {
    const record = await this.deliveries.get(customerExternalId, messageId);
    if (!record?.message) return false;
    if (!SETTLED.includes(record.state)) await this.send(record.message);
    return true;
  }

  private async send(message: OutboundMessage): Promise<DeliveryResult> {
    try {
      const providerMessageId = await this.channel.send(message);
      await this.deliveries.markAccepted(message.customerExternalId, message.messageId, providerMessageId);
      return { state: 'ACCEPTED', providerMessageId };
    } catch (error) {
      await this.deliveries.markFailed(message.customerExternalId, message.messageId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

type EmailInput = Parameters<SesAdapter['send']>[0];
export type NotificationResult = { status: 'SENT'; messageId: string } | { status: 'FAILED'; error: string };

/** Formal case email. A failure is reported and recorded but never touches case state — the case outcome is already decided. */
export async function sendCaseNotification(ses: SesAdapter, deliveries: DeliveryStore, input: EmailInput): Promise<NotificationResult> {
  // Invalid case data is a caller bug, not a delivery failure: let it throw before anything is recorded.
  const messageId = `email:${input.case.caseId}:${input.case.status}:${input.recipient}`;
  const record = await deliveries.begin({ customerExternalId: input.recipient, messageId });
  if (SETTLED.includes(record.state) && record.providerMessageId) return { status: 'SENT', messageId: record.providerMessageId };
  try {
    const providerMessageId = await ses.send(input);
    await deliveries.markAccepted(input.recipient, messageId, providerMessageId);
    return { status: 'SENT', messageId: providerMessageId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await deliveries.markFailed(input.recipient, messageId, detail);
    return { status: 'FAILED', error: detail };
  }
}

/** Maps an End User Messaging event record to a final state; null for non-final progress events. */
export function parseDeliveryEvent(payload: unknown): { providerMessageId: string; state: FinalDeliveryState } | null {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid delivery event');
  const { eventType, messageId, isFinal } = payload as Record<string, unknown>;
  if (typeof eventType !== 'string' || typeof messageId !== 'string' || !messageId) throw new Error('Invalid delivery event');
  if (eventType.endsWith('_DELIVERED')) return { providerMessageId: messageId, state: 'DELIVERED' };
  if (/_(SUCCESSFUL|QUEUED|PENDING|READ)$/.test(eventType) || isFinal === false) return null;
  return { providerMessageId: messageId, state: 'UNDELIVERABLE' };
}

/** SNS boundary for delivery events, deliberately separate from inbound customer messages. Touches only the delivery store. */
export function createDeliveryEventHandler(options: { topics: ReadonlySet<string>; store: DeliveryStore }) {
  return async (event: unknown) => {
    const records = (event as { Records?: unknown } | null)?.Records;
    if (!Array.isArray(records) || !records.length) throw new Error('Malformed SNS event');
    const results: string[] = [];
    for (const candidate of records) {
      const record = candidate as { EventSource?: string; Sns?: { TopicArn?: string; Message?: string } } | null;
      if (record?.EventSource !== 'aws:sns' || !record.Sns?.TopicArn || !options.topics.has(record.Sns.TopicArn)) throw new Error('Untrusted SNS source');
      let payload: unknown;
      try { payload = JSON.parse(record.Sns.Message ?? ''); } catch { throw new Error('Malformed SNS message'); }
      if (payload && typeof payload === 'object' && ('inboundMessageId' in payload || 'messageBody' in payload)) {
        throw new Error('Inbound customer message received on the delivery event topic');
      }
      const parsed = parseDeliveryEvent(payload);
      if (!parsed) { results.push('ignored'); continue; }
      // Unknown provider id: the event beat markAccepted. Throw so SNS redelivers it.
      if (!await options.store.applyEvent(parsed.providerMessageId, parsed.state)) throw new Error('Delivery event for unknown provider message');
      results.push(parsed.state);
    }
    return results;
  };
}
