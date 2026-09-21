import { hashDynamoKey, type DynamoClient } from './idempotency.ts';
import { OutboundMessageSchema, type OutboundMessage } from '../../../packages/contracts/src/index.ts';
import type { Payload } from './outbound.ts';

/** PENDING: recorded, not yet sent. ACCEPTED/FAILED: provider accepted / transport rejected. DELIVERED/UNDELIVERABLE: final provider event. */
export type DeliveryState = 'PENDING' | 'ACCEPTED' | 'FAILED' | 'DELIVERED' | 'UNDELIVERABLE';
export type FinalDeliveryState = 'DELIVERED' | 'UNDELIVERABLE';
const OPEN: readonly DeliveryState[] = ['PENDING', 'ACCEPTED', 'FAILED'];

export interface DeliveryRecord {
  readonly customerExternalId: string;
  readonly messageId: string;
  readonly state: DeliveryState;
  /** Absent for email records. */
  readonly message?: OutboundMessage;
  readonly providerMessageId?: string;
  readonly error?: string;
}

export interface DeliveryStore {
  /** Put-if-absent as PENDING; returns the existing record when the messageId was already begun. */
  begin(record: { customerExternalId: string; messageId: string; message?: OutboundMessage }): Promise<DeliveryRecord>;
  get(customerExternalId: string, messageId: string): Promise<DeliveryRecord | null>;
  markAccepted(customerExternalId: string, messageId: string, providerMessageId: string): Promise<void>;
  markFailed(customerExternalId: string, messageId: string, error: string): Promise<void>;
  /** Final provider event. Returns false for an unknown provider id; final states are never overwritten. */
  applyEvent(providerMessageId: string, state: FinalDeliveryState): Promise<boolean>;
}

export class MemoryDeliveryStore implements DeliveryStore {
  readonly records = new Map<string, DeliveryRecord>();
  private readonly byProvider = new Map<string, string>();
  private static key(customer: string, messageId: string) { return JSON.stringify([customer, messageId]); }
  async begin(input: { customerExternalId: string; messageId: string; message?: OutboundMessage }) {
    const key = MemoryDeliveryStore.key(input.customerExternalId, input.messageId);
    const existing = this.records.get(key);
    if (existing) return existing;
    const record: DeliveryRecord = { ...input, state: 'PENDING' };
    this.records.set(key, record);
    return record;
  }
  async get(customer: string, messageId: string) { return this.records.get(MemoryDeliveryStore.key(customer, messageId)) ?? null; }
  private patch(customer: string, messageId: string, change: Partial<DeliveryRecord>) {
    const key = MemoryDeliveryStore.key(customer, messageId);
    const current = this.records.get(key);
    if (!current || !OPEN.includes(current.state)) return;
    this.records.set(key, { ...current, ...change });
  }
  async markAccepted(customer: string, messageId: string, providerMessageId: string) {
    this.patch(customer, messageId, { state: 'ACCEPTED', providerMessageId });
    this.byProvider.set(providerMessageId, MemoryDeliveryStore.key(customer, messageId));
  }
  async markFailed(customer: string, messageId: string, error: string) { this.patch(customer, messageId, { state: 'FAILED', error }); }
  async applyEvent(providerMessageId: string, state: FinalDeliveryState) {
    const key = this.byProvider.get(providerMessageId);
    const current = key && this.records.get(key);
    if (!current) return false;
    if (OPEN.includes(current.state)) this.records.set(key, { ...current, state });
    return true;
  }
}

export interface DeliveryDynamoClient extends DynamoClient {
  getItem(payload: Payload): Promise<{ Item?: Record<string, unknown> }>;
}

const str = (value: unknown): string | undefined => (value as { S?: string } | undefined)?.S;
const recordKey = (customer: string, messageId: string) => hashDynamoKey(JSON.stringify(['THEMIS', 'DELIVERY', customer, messageId]));
const providerKey = (providerMessageId: string) => hashDynamoKey(JSON.stringify(['THEMIS', 'DELIVERY_PROVIDER', providerMessageId]));
const isConditionFailure = (error: unknown) => error instanceof Error && error.name === 'ConditionalCheckFailedException';

function fromItem(customerExternalId: string, messageId: string, item: Record<string, unknown>): DeliveryRecord {
  if (str(item.recordType) !== 'DELIVERY') throw new Error('Unexpected record at delivery key');
  const state = str(item.state) as DeliveryState;
  const message = str(item.message);
  return { customerExternalId, messageId, state,
    ...(message ? { message: OutboundMessageSchema.parse(JSON.parse(message)) } : {}),
    ...(str(item.providerMessageId) ? { providerMessageId: str(item.providerMessageId)! } : {}),
    ...(str(item.error) ? { error: str(item.error)! } : {}) };
}

// Delivery rows share the idempotency table (same `idempotencyKey` partition key, recordType DELIVERY / DELIVERY_POINTER).
export class DynamoDeliveryStore implements DeliveryStore {
  private readonly table: string;
  private readonly client: DeliveryDynamoClient;
  constructor(table: string, client: DeliveryDynamoClient) {
    if (!table.trim()) throw new Error('Missing delivery table');
    this.table = table; this.client = client;
  }
  async begin(input: { customerExternalId: string; messageId: string; message?: OutboundMessage }) {
    try {
      await this.client.putItem({ TableName: this.table, ConditionExpression: 'attribute_not_exists(idempotencyKey)',
        Item: { idempotencyKey: await recordKey(input.customerExternalId, input.messageId), recordType: { S: 'DELIVERY' }, state: { S: 'PENDING' },
          createdAt: { S: new Date().toISOString() }, ...(input.message ? { message: { S: JSON.stringify(input.message) } } : {}) } });
      return { ...input, state: 'PENDING' as const };
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
      return (await this.get(input.customerExternalId, input.messageId))!;
    }
  }
  async get(customer: string, messageId: string) {
    const { Item } = await this.client.getItem({ TableName: this.table, Key: { idempotencyKey: await recordKey(customer, messageId) }, ConsistentRead: true });
    return Item ? fromItem(customer, messageId, Item) : null;
  }
  private async transition(key: { S: string }, set: Record<string, string>): Promise<boolean> {
    const names = Object.keys(set);
    try {
      await this.client.updateItem({ TableName: this.table, Key: { idempotencyKey: key },
        UpdateExpression: `SET ${names.map(n => `#${n} = :${n}`).join(', ')}`,
        ConditionExpression: '#state IN (:open0, :open1, :open2)',
        ExpressionAttributeNames: Object.fromEntries([...names.map(n => [`#${n}`, n]), ['#state', 'state']]),
        ExpressionAttributeValues: { ...Object.fromEntries(names.map(n => [`:${n}`, { S: set[n] }])), ':open0': { S: OPEN[0] }, ':open1': { S: OPEN[1] }, ':open2': { S: OPEN[2] } } });
      return true;
    } catch (error) { if (isConditionFailure(error)) return false; throw error; }
  }
  async markAccepted(customer: string, messageId: string, providerMessageId: string) {
    const key = await recordKey(customer, messageId);
    // Pointer first: a provider event can only find the record once its provider id is resolvable.
    await this.client.putItem({ TableName: this.table, Item: { idempotencyKey: await providerKey(providerMessageId), recordType: { S: 'DELIVERY_POINTER' }, target: key } });
    await this.transition(key, { state: 'ACCEPTED', providerMessageId });
  }
  async markFailed(customer: string, messageId: string, error: string) {
    await this.transition(await recordKey(customer, messageId), { state: 'FAILED', error: error.slice(0, 500) });
  }
  async applyEvent(providerMessageId: string, state: FinalDeliveryState) {
    const { Item } = await this.client.getItem({ TableName: this.table, Key: { idempotencyKey: await providerKey(providerMessageId) }, ConsistentRead: true });
    const target = Item && (Item.target as { S: string } | undefined);
    if (!target) return false;
    await this.transition(target, { state });
    return true;
  }
}
