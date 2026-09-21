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
/** Identity of the inbound message, stored on the claim so a reconciler can act without the (hashed) key. */
export interface ClaimMeta { readonly customerExternalId: string; readonly messageId: string; readonly channel: Channel }
export interface IdempotencyStore {
  // Atomically reserve a key. A failed or interrupted processing attempt stays reserved.
  claim(key: string, meta?: ClaimMeta): Promise<boolean>;
  /** Conditional on the claim still being PROCESSING; a claim the reconciler already moved throws ConditionalCheckFailedException. */
  complete(key: string): Promise<void>;
}
const isConditionFailure = (error: unknown) => error instanceof Error && error.name === 'ConditionalCheckFailedException';
export type ClaimState = 'PROCESSING' | 'COMPLETED' | 'REVIEW' | 'QUARANTINED';
/** Non-PROCESSING outcomes the reconciler may set. REVIEW: customer notified, operator must verify. QUARANTINED: reconciler cannot act. */
export type ClaimResolution = Exclude<ClaimState, 'PROCESSING'>;
export interface ClaimRef { readonly claimId: string; readonly claimedAt: string }
export interface LeasedClaim extends ClaimRef { readonly meta?: ClaimMeta; readonly attempts: number }
/**
 * Bounded, lease-protected reconciliation of claims left PROCESSING by a crash or ambiguous failure. Nothing here can
 * re-admit an inbound message: PROCESSING only ever moves forward, and deleting a claim (which would allow replay) is
 * an operator-only action outside this interface.
 */
export interface ClaimReconciler {
  /** Oldest-first PROCESSING claims claimed before `before`, at most `limit`. */
  listStale(before: Date, limit: number): Promise<ClaimRef[]>;
  /** Take the claim if PROCESSING and unleased (or lease expired); counts an attempt. Null when another worker holds it or it moved. */
  lease(claimId: string, owner: string, now: Date, leaseMs: number): Promise<LeasedClaim | null>;
  /** Conditional on still being PROCESSING and leased by `owner`. False when the lease was lost or the claim moved. */
  finish(claimId: string, owner: string, to: ClaimResolution, reason: string): Promise<boolean>;
}
type MemoryClaim = { state: ClaimState; claimedAt: string; meta?: ClaimMeta; attempts: number; owner?: string; leaseUntil?: number; reason?: string };
export class MemoryIdempotencyStore implements IdempotencyStore, ClaimReconciler {
  private readonly claims = new Map<string, MemoryClaim>();
  private readonly clock: () => Date;
  constructor(clock: () => Date = () => new Date()) { this.clock = clock; }
  get states(): ReadonlyMap<string, ClaimState> { return new Map([...this.claims].map(([key, claim]) => [key, claim.state])); }
  detail(key: string): Readonly<MemoryClaim> | undefined { return this.claims.get(key); }
  async claim(key: string, meta?: ClaimMeta): Promise<boolean> {
    if (this.claims.has(key)) return false;
    this.claims.set(key, { state: 'PROCESSING', claimedAt: this.clock().toISOString(), attempts: 0, ...(meta ? { meta } : {}) });
    return true;
  }
  async complete(key: string): Promise<void> {
    const claim = this.claims.get(key);
    if (claim && claim.state !== 'PROCESSING' && claim.state !== 'COMPLETED') throw Object.assign(new Error('claim moved'), { name: 'ConditionalCheckFailedException' });
    if (claim) claim.state = 'COMPLETED';
  }
  async listStale(before: Date, limit: number): Promise<ClaimRef[]> {
    return [...this.claims].filter(([, c]) => c.state === 'PROCESSING' && Date.parse(c.claimedAt) < before.getTime())
      .sort(([, a], [, b]) => a.claimedAt.localeCompare(b.claimedAt)).slice(0, limit).map(([claimId, c]) => ({ claimId, claimedAt: c.claimedAt }));
  }
  async lease(claimId: string, owner: string, now: Date, leaseMs: number): Promise<LeasedClaim | null> {
    const c = this.claims.get(claimId);
    if (!c || c.state !== 'PROCESSING' || (c.leaseUntil !== undefined && c.leaseUntil >= now.getTime())) return null;
    c.owner = owner; c.leaseUntil = now.getTime() + leaseMs; c.attempts++;
    return { claimId, claimedAt: c.claimedAt, attempts: c.attempts, ...(c.meta ? { meta: c.meta } : {}) };
  }
  async finish(claimId: string, owner: string, to: ClaimResolution, reason: string): Promise<boolean> {
    const c = this.claims.get(claimId);
    if (!c || c.state !== 'PROCESSING' || c.owner !== owner) return false;
    c.state = to; c.reason = reason; delete c.owner; delete c.leaseUntil;
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
  // A reconciler that already moved the claim wins; the work is done either way, so a lost race is not an error.
  private async finish(key: string) {
    try { await this.store.complete(key); } catch (error) { if (!isConditionFailure(error)) throw error; }
  }
  async process(message: InboundMessage, prepare?: (message: InboundMessage) => Promise<InboundMessage>): Promise<'processed' | 'duplicate'> {
    message = InboundMessageSchema.parse(message);
    const key = JSON.stringify([message.customerExternalId, message.messageId]);
    const meta = { customerExternalId: message.customerExternalId, messageId: message.messageId, channel: message.channel as Channel };
    if (!await this.store.claim(key, meta)) {
      if (this.resume && await this.resume(message)) {
        await this.finish(key);
      }
      return 'duplicate';
    }
    await this.consume(prepare ? await prepare(message) : message);
    await this.finish(key);
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
