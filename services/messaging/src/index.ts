export * from './inbound.ts';
export * from './choices.ts';
export * from './outbound.ts';
export * from './email.ts';
export * from './active-menu.ts';
export * from './runtime.ts';
export * from './composition.ts';
import { ChannelAdapter, type MessagingClient } from './outbound.ts';
import { SesAdapter, type SesClient } from './email.ts';
import { InboundProcessor, MemoryIdempotencyStore, type IdempotencyStore } from './inbound.ts';
import type { InboundMessage } from '../../../packages/contracts/src/index.ts';
export function createMessaging(options: {
  env: Record<string, string | undefined>;
  consume: (message: InboundMessage) => Promise<void>;
  store?: IdempotencyStore; messagingClient?: MessagingClient; sesClient?: SesClient;
}) {
  const mode = options.env.THEMIS_MODE ?? 'local';
  if (mode !== 'local' && mode !== 'aws') throw new Error('Invalid THEMIS_MODE');
  if (mode === 'aws' && (!options.store || !options.messagingClient || !options.sesClient || !options.env.THEMIS_RCS_POOL_ID || !options.env.THEMIS_SMS_IDENTITY || !options.env.THEMIS_SES_FROM || !options.env.THEMIS_SUPPORT)) throw new Error('Missing AWS messaging configuration or durable idempotency store');
  return {
    inbound: new InboundProcessor(options.store ?? new MemoryIdempotencyStore(), options.consume),
    channel: new ChannelAdapter({ mode, rcsIdentity: options.env.THEMIS_RCS_POOL_ID ?? 'local-rcs-pool', smsIdentity: options.env.THEMIS_SMS_IDENTITY ?? 'local-sms' }, options.messagingClient),
    email: new SesAdapter(mode, options.sesClient),
    sender: options.env.THEMIS_SES_FROM ?? 'cases@themis.example',
    support: options.env.THEMIS_SUPPORT ?? 'support@themis.example',
  };
}
export * from './idempotency.ts';
export * from './delivery-store.ts';
export * from './delivery.ts';
export * from './reconciler.ts';
