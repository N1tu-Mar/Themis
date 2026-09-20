import { InboundMessageSchema, type InboundMessage } from '../../../packages/contracts/src/index.ts';
import { normalizeChoice, type Choice } from './choices.ts';
export type Channel = 'RCS' | 'SMS';
export type SnsRecord = { EventSource: string; Sns: { TopicArn: string; Timestamp: string; Message: string } };
export function normalizeInbound(payload: unknown, channel: Channel, receivedAt: string): InboundMessage {
  if (channel !== 'RCS' && channel !== 'SMS') throw new Error('Unsupported inbound channel');
  if (!payload || typeof payload !== 'object') throw new Error('Invalid inbound payload');
  const event = payload as Record<string, unknown>;
  if (typeof event.messageBody !== 'string') throw new Error('Expected messageBody text');
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
export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly states = new Map<string, 'PROCESSING' | 'COMPLETED'>();
  async claim(key: string): Promise<boolean> {
    if (this.states.has(key)) return false;
    this.states.set(key, 'PROCESSING');
    return true;
  }
  async complete(key: string): Promise<void> { this.states.set(key, 'COMPLETED'); }
}
export class InboundProcessor {
  private store: IdempotencyStore;
  private consume: (message: InboundMessage) => Promise<void>;
  constructor(store: IdempotencyStore, consume: (message: InboundMessage) => Promise<void>) { this.store = store; this.consume = consume; }
  async process(message: InboundMessage, prepare?: (message: InboundMessage) => Promise<InboundMessage>): Promise<'processed' | 'duplicate'> {
    message = InboundMessageSchema.parse(message);
    const key = JSON.stringify([message.customerExternalId, message.messageId]);
    if (!await this.store.claim(key)) return 'duplicate';
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
      const message = normalizeInbound(payload, channel, Timestamp);
      results.push(await options.processor.process(message, async m => normalizeChoice(m, await options.choicesFor(m.customerExternalId))));
    }
    return results;
  };
}
