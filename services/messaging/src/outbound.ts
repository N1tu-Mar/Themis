import { OutboundMessageSchema, type OutboundMessage } from '../../../packages/contracts/src/index.ts';
import { smsText } from './choices.ts';
export type Payload = Record<string, unknown>;
export interface MessagingClient {
  sendTextMessage(payload: Payload): Promise<{ MessageId?: string }>;
  sendRcsMessage(payload: Payload): Promise<{ MessageId?: string }>;
}
export class DeliveryError extends Error {
  readonly channel: string;
  readonly messageId: string;
  constructor(channel: string, messageId: string, options?: ErrorOptions) {
    super(`Delivery failed for ${channel} message ${messageId}`, options);
    this.channel = channel; this.messageId = messageId;
  }
}
export function messagingPayload(message: OutboundMessage, config: { rcsIdentity: string; smsIdentity: string }) {
  message = OutboundMessageSchema.parse(message);
  if (!/^\+[1-9]\d{7,14}$/.test(message.customerExternalId)) throw new Error('Expected E.164 destination');
  if (message.channel === 'EMAIL') throw new Error('Use the SES case adapter for email');
  const fallback = smsText(message);
  if (fallback.length > 1600) throw new Error('SMS fallback exceeds 1600 characters');
  const base = { DestinationPhoneNumber: message.customerExternalId,
    OriginationIdentity: message.channel === 'RCS' ? config.rcsIdentity : config.smsIdentity };
  if (!base.OriginationIdentity) throw new Error('Missing origination identity');
  if (message.channel === 'RCS' && message.suggestions?.length) {
    if (!config.smsIdentity) throw new Error('Missing SMS fallback identity');
    if (message.suggestions.length > 11 || message.suggestions.some(c => c.label.length > 25 || c.postback.length > 2048)) throw new Error('RCS suggestion limit exceeded');
    return { operation: 'sendRcsMessage' as const, payload: { ...base,
      RcsMessageContent: { Content: { TextMessage: { Body: message.text } },
        Suggestions: message.suggestions.map(c => ({ Reply: { Text: c.label, PostbackData: c.postback } })) },
      FallbackConfiguration: { Channel: 'SMS', MessageBody: fallback, OriginationIdentity: config.smsIdentity },
    } };
  }
  // Text RCS uses an Infra-managed pool containing RCS and SMS identities for fallback.
  return { operation: 'sendTextMessage' as const, payload: { ...base, MessageBody: fallback, MessageType: 'TRANSACTIONAL' } };
}
export class ChannelAdapter {
  readonly captured: { operation: string; payload: Payload }[] = [];
  private config: { mode: 'local' | 'aws'; rcsIdentity: string; smsIdentity: string };
  private client?: MessagingClient;
  constructor(config: { mode: 'local' | 'aws'; rcsIdentity: string; smsIdentity: string }, client?: MessagingClient) { this.config = config; this.client = client; }
  async send(message: OutboundMessage): Promise<string> {
    const request = messagingPayload(message, this.config);
    if (this.config.mode === 'local') {
      this.captured.push(structuredClone(request));
      return `local:${message.messageId}`;
    }
    try {
      if (!this.client) throw new Error('AWS messaging client not configured');
      const result = await this.client[request.operation](request.payload);
      if (!result.MessageId) throw new Error('AWS did not accept message');
      return result.MessageId;
    } catch (cause) { throw new DeliveryError(message.channel, message.messageId, { cause }); }
  }
}
