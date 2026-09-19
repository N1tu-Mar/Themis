import type { IdempotencyStore } from './inbound.ts';
import type { Payload } from './outbound.ts';
export interface DynamoClient {
  putItem(payload: Payload): Promise<unknown>;
  updateItem(payload: Payload): Promise<unknown>;
}
// Low-level DynamoDB API boundary. Infrastructure owns the table and permissions.
export class DynamoIdempotencyStore implements IdempotencyStore {
  private table: string;
  private client: DynamoClient;
  constructor(table: string, client: DynamoClient) {
    if (!table.trim()) throw new Error('Missing idempotency table');
    this.table = table; this.client = client;
  }
  private async idempotencyKey(key: string) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return { S: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') };
  }
  async claim(key: string): Promise<boolean> {
    try {
      await this.client.putItem({ TableName: this.table,
        Item: { idempotencyKey: await this.idempotencyKey(key), state: { S: 'PROCESSING' } },
        ConditionExpression: 'attribute_not_exists(idempotencyKey)' });
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }
  async complete(key: string): Promise<void> {
    await this.client.updateItem({ TableName: this.table, Key: { idempotencyKey: await this.idempotencyKey(key) },
      UpdateExpression: 'SET #state = :completed', ConditionExpression: '#state = :processing',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: { ':completed': { S: 'COMPLETED' }, ':processing': { S: 'PROCESSING' } } });
  }
}
