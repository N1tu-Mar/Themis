import { InboundMessageSchema, type InboundMessage } from '../../../packages/contracts/src/index.ts';
import { normalizeChoice, type Choice } from './choices.ts';
export type Channel = 'RCS' | 'SMS';
export type SnsRecord = { EventSource: string; Sns: { TopicArn: string; Timestamp: string; Message: string } };
const MAX_INBOUND_TEXT_LENGTH = 4_000;
const MAX_PROVIDER_MESSAGE_ID_LENGTH = 256;
// End User Messaging delivery records carry eventType/messageStatus and never inboundMessageId.
export function isDeliveryEvent(payload: unknown): boolean {
  return !!payload && typeof payload === 'object' && ('eventType' in payload || 'messageStatus' in payload);
}
export function normalizeInbound(payload: unknown, channel: Channel, receivedAt: string): InboundMessage {
  if (channel !== 'RCS' && channel !== 'SMS') throw new Error('Unsupported inbound channel');
  if (!payload || typeof payload !== 'object') throw new Error('Invalid inbound payload');
  const event = payload as Record<string, unknown>;
  if (typeof event.messageBody !== 'string') throw new Error('Expected messageBody text');
  if (event.messageBody.length > MAX_INBOUND_TEXT_LENGTH) throw new Error('Inbound message exceeds maximum length');
  if (typeof event.originationNumber !== 'string' || !/^\+[1-9]\d{7,14}$/.test(event.originationNumber)) throw new Error('Invalid inbound sender');
  if (typeof event.inboundMessageId !== 'string' || !event.inboundMessageId || event.inboundMessageId.length > MAX_PROVIDER_MESSAGE_ID_LENGTH) {
    throw new Error('Invalid inbound message id');
  }
  let text = event.messageBody;
  let postback: string | null = null;
  if (channel === 'RCS') {
    let body: unknown;
    try { body = JSON.parse(text); } catch { /* Ordinary text is not JSON. */ }
    if (body && typeof body === 'object' && 'type' in body && body.type === 'SUGGESTION') {
      const suggestion = body as Record<string, unknown>;
      if (typeof suggestion.text !== 'string' || typeof suggestion.postbackData !== 'string') throw new Error('Invalid suggestion');
      text = suggestion.text;
      postback = suggestion.postbackData;
    }
  }
  return InboundMessageSchema.parse({ channel, customerExternalId: event.originationNumber,
    messageId: event.inboundMessageId, text, postback, receivedAt });
}
export interface IdempotencyStore {
  // Atomically reserve a key. A failed or interrupted processing attempt stays reserved.
  claim(key: string): Promise<boolean>;
  complete(key: string): Promise<void>;
}
// Operator/job boundary for claims left PROCESSING by a crash or ambiguous failure. Nothing replays automatically:
// a claim is either confirmed COMPLETED or RELEASED (deleted so the inbound message may be admitted again).
export interface StuckClaim { readonly claimId: string; readonly claimedAt: string }
export interface ClaimReconciler {
  listStuck(olderThanMs: number, now?: Date): Promise<StuckClaim[]>;
  /** Conditional on the claim still being PROCESSING; false when it already moved. */
  resolve(claimId: string, resolution: 'COMPLETED' | 'RELEASED'): Promise<boolean>;
}
export class MemoryIdempotencyStore implements IdempotencyStore, ClaimReconciler {
  readonly states = new Map<string, 'PROCESSING' | 'COMPLETED'>();
  private readonly claimedAt = new Map<string, string>();
  async claim(key: string): Promise<boolean> {
    if (this.states.has(key)) return false;
    this.states.set(key, 'PROCESSING');
    this.claimedAt.set(key, new Date().toISOString());
    return true;
  }
  async complete(key: string): Promise<void> { this.states.set(key, 'COMPLETED'); }
  async listStuck(olderThanMs: number, now = new Date()): Promise<StuckClaim[]> {
    return [...this.states].filter(([key, state]) => state === 'PROCESSING' && now.getTime() - Date.parse(this.claimedAt.get(key)!) >= olderThanMs)
      .map(([claimId]) => ({ claimId, claimedAt: this.claimedAt.get(claimId)! }));
  }
  async resolve(claimId: string, resolution: 'COMPLETED' | 'RELEASED'): Promise<boolean> {
    if (this.states.get(claimId) !== 'PROCESSING') return false;
    if (resolution === 'COMPLETED') this.states.set(claimId, 'COMPLETED'); else { this.states.delete(claimId); this.claimedAt.delete(claimId); }
    return true;
  }
}
export class InboundProcessor {
  private store: IdempotencyStore;
  private consume: (message: InboundMessage) => Promise<void>;
  private resume?: (message: InboundMessage) => Promise<boolean>;
  // `resume` runs only for a duplicate: it may re-attempt delivery of an already-computed reply (never the consume
  // effects) and returns true once that reply is settled, which lets the retained claim complete.
  constructor(store: IdempotencyStore, consume: (message: InboundMessage) => Promise<void>, resume?: (message: InboundMessage) => Promise<boolean>) {
    this.store = store; this.consume = consume; this.resume = resume;
  }
  async process(message: InboundMessage, prepare?: (message: InboundMessage) => Promise<InboundMessage>): Promise<'processed' | 'duplicate'> {
    message = InboundMessageSchema.parse(message);
    const key = JSON.stringify([message.customerExternalId, message.messageId]);
    if (!await this.store.claim(key)) {
      if (this.resume && await this.resume(message)) {
        try { await this.store.complete(key); } catch (error) { if (!(error instanceof Error && error.name === 'ConditionalCheckFailedException')) throw error; }
      }
      return 'duplicate';
    }
    await this.consume(prepare ? await prepare(message) : message);
    await this.store.complete(key);
    return 'processed';
  }
}
export function createSnsHandler(options: {
  topics: Readonly<Record<string, Channel>>;
  processor: InboundProcessor;
  choicesFor: (customer: string) => Promise<readonly Choice[]>;
}) {
  // Lambda SNS subscription boundary; do not expose this as an unauthenticated HTTP endpoint.
  return async (event: unknown) => {
    if (!event || typeof event !== 'object' || !Array.isArray((event as { Records?: unknown }).Records)
      || !(event as { Records: unknown[] }).Records.length) {
      throw new Error('Malformed SNS event');
    }
    const results: string[] = [];
    for (const candidate of (event as { Records: unknown[] }).Records) {
      if (!candidate || typeof candidate !== 'object') throw new Error('Malformed SNS record');
      const record = candidate as Partial<SnsRecord>;
      if (record.EventSource !== 'aws:sns' || !record.Sns || typeof record.Sns !== 'object') throw new Error('Untrusted SNS source');
      const { TopicArn, Timestamp, Message } = record.Sns;
      if (typeof TopicArn !== 'string' || typeof Timestamp !== 'string' || typeof Message !== 'string') {
        throw new Error('Malformed SNS record');
      }
      const channel = options.topics[TopicArn];
      if (!channel) throw new Error('Untrusted SNS source');
      let payload: unknown;
      try { payload = JSON.parse(Message); } catch { throw new Error('Malformed SNS message'); }
      if (isDeliveryEvent(payload)) throw new Error('Delivery event received on an inbound message topic');
      const message = normalizeInbound(payload, channel, Timestamp);
      results.push(await options.processor.process(message, async m => normalizeChoice(m, await options.choicesFor(m.customerExternalId))));
    }
    return results;
  };
}
