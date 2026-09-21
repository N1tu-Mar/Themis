import type { ClaimMeta, ClaimReconciler, ClaimRef, ClaimResolution, IdempotencyStore, LeasedClaim } from './inbound.ts';
import type { Payload } from './outbound.ts';
export interface DynamoClient {
  putItem(payload: Payload): Promise<unknown>;
  updateItem(payload: Payload): Promise<unknown>;
}
export async function hashDynamoKey(key: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return { S: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') };
}
// Low-level DynamoDB API boundary. Infrastructure owns the table and permissions.
export const CLAIM_STATE_INDEX = 'ClaimStateIndex';
export interface ClaimDynamoClient extends DynamoClient {
  query(payload: Payload): Promise<{ Items?: Record<string, unknown>[] }>;
}
type Attr = { S?: string; N?: string } | undefined;
const isConditionFailure = (error: unknown) => error instanceof Error && error.name === 'ConditionalCheckFailedException';
export class DynamoIdempotencyStore implements IdempotencyStore {
  private table: string;
  private client: DynamoClient;
  constructor(table: string, client: DynamoClient) {
    if (!table.trim()) throw new Error('Missing idempotency table');
    this.table = table; this.client = client;
  }
  async claim(key: string, meta?: ClaimMeta): Promise<boolean> {
    try {
      await this.client.putItem({ TableName: this.table,
        Item: { idempotencyKey: await hashDynamoKey(key), state: { S: 'PROCESSING' }, claimState: { S: 'PROCESSING' }, claimedAt: { S: new Date().toISOString() },
          ...(meta ? { customerExternalId: { S: meta.customerExternalId }, messageId: { S: meta.messageId }, channel: { S: meta.channel } } : {}) },
        ConditionExpression: 'attribute_not_exists(idempotencyKey)' });
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }
  async complete(key: string): Promise<void> {
    await this.client.updateItem({ TableName: this.table, Key: { idempotencyKey: await hashDynamoKey(key) },
      UpdateExpression: 'SET #state = :completed REMOVE claimState, leaseOwner, leaseUntil', ConditionExpression: '#state = :processing',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: { ':completed': { S: 'COMPLETED' }, ':processing': { S: 'PROCESSING' } } });
  }
}

// Reconciler side. `claimState` is set only while a claim is PROCESSING/REVIEW/QUARANTINED, so the sparse KEYS_ONLY
// ClaimStateIndex (claimState, claimedAt) lists open claims without a table Scan. Ceiling: one index partition per state.
export class DynamoClaimReconciler implements ClaimReconciler {
  private readonly table: string;
  private readonly client: ClaimDynamoClient;
  constructor(table: string, client: ClaimDynamoClient) {
    if (!table.trim()) throw new Error('Missing idempotency table');
    this.table = table; this.client = client;
  }
  async listStale(before: Date, limit: number): Promise<ClaimRef[]> {
    const { Items = [] } = await this.client.query({ TableName: this.table, IndexName: CLAIM_STATE_INDEX, Limit: limit,
      KeyConditionExpression: '#cs = :processing AND claimedAt < :before', ScanIndexForward: true,
      ExpressionAttributeNames: { '#cs': 'claimState' },
      ExpressionAttributeValues: { ':processing': { S: 'PROCESSING' }, ':before': { S: before.toISOString() } } });
    return Items.map(item => ({ claimId: (item.idempotencyKey as Attr)!.S!, claimedAt: (item.claimedAt as Attr)!.S! }));
  }
  async lease(claimId: string, owner: string, now: Date, leaseMs: number): Promise<LeasedClaim | null> {
    try {
      const out = await this.client.updateItem({ TableName: this.table, Key: { idempotencyKey: { S: claimId } }, ReturnValues: 'ALL_NEW',
        UpdateExpression: 'SET leaseOwner = :owner, leaseUntil = :until ADD attempts :one',
        ConditionExpression: '#state = :processing AND (attribute_not_exists(leaseUntil) OR leaseUntil < :now)',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':owner': { S: owner }, ':until': { S: new Date(now.getTime() + leaseMs).toISOString() },
          ':now': { S: now.toISOString() }, ':one': { N: '1' }, ':processing': { S: 'PROCESSING' } } }) as { Attributes?: Record<string, Attr> };
      const a = out.Attributes ?? {};
      const channel = a.channel?.S;
      const meta: ClaimMeta | undefined = a.customerExternalId?.S && a.messageId?.S && (channel === 'RCS' || channel === 'SMS')
        ? { customerExternalId: a.customerExternalId.S, messageId: a.messageId.S, channel } : undefined;
      return { claimId, claimedAt: a.claimedAt?.S ?? '', attempts: Number(a.attempts?.N ?? 1), ...(meta ? { meta } : {}) };
    } catch (error) { if (isConditionFailure(error)) return null; throw error; }
  }
  async finish(claimId: string, owner: string, to: ClaimResolution, reason: string): Promise<boolean> {
    // REVIEW/QUARANTINED stay in the index (operators list them); COMPLETED leaves it.
    try {
      await this.client.updateItem({ TableName: this.table, Key: { idempotencyKey: { S: claimId } },
        UpdateExpression: to === 'COMPLETED' ? 'SET #state = :to, reason = :reason, resolvedAt = :at REMOVE claimState, leaseOwner, leaseUntil'
          : 'SET #state = :to, claimState = :to, reason = :reason, resolvedAt = :at REMOVE leaseOwner, leaseUntil',
        ConditionExpression: '#state = :processing AND leaseOwner = :owner',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':to': { S: to }, ':reason': { S: reason }, ':at': { S: new Date().toISOString() },
          ':processing': { S: 'PROCESSING' }, ':owner': { S: owner } } });
      return true;
    } catch (error) { if (isConditionFailure(error)) return false; throw error; }
  }
}
