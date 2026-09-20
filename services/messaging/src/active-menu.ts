import type { Choice } from './choices.ts';
import { hashDynamoKey } from './idempotency.ts';
import type { Payload } from './outbound.ts';

export interface ActiveMenu {
  readonly customerExternalId: string;
  readonly caseId: string;
  readonly choices: readonly Choice[];
}

export interface ActiveMenuStore {
  get(customerExternalId: string): Promise<ActiveMenu | null>;
  set(menu: ActiveMenu): Promise<void>;
  clear(customerExternalId: string, caseId: string): Promise<boolean>;
}

function validateText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid active menu ${field}`);
  return value;
}

function validateMenu(menu: ActiveMenu): ActiveMenu {
  const customerExternalId = validateText(menu.customerExternalId, 'customerExternalId');
  const caseId = validateText(menu.caseId, 'caseId');
  if (!Array.isArray(menu.choices) || !menu.choices.length || menu.choices.length > 11) {
    throw new Error('Active menu must contain between 1 and 11 choices');
  }
  const seen = new Set<string>();
  const choices = menu.choices.map((choice) => {
    const label = validateText(choice?.label, 'choice label');
    const postback = validateText(choice?.postback, 'choice postback');
    if (label.length > 25 || postback.length > 2048) throw new Error('Active menu choice exceeds channel limits');
    if (seen.has(postback)) throw new Error('Active menu postbacks must be unique');
    seen.add(postback);
    return Object.freeze({ label, postback });
  });
  return Object.freeze({ customerExternalId, caseId, choices: Object.freeze(choices) });
}

export class MemoryActiveMenuStore implements ActiveMenuStore {
  private readonly menus = new Map<string, ActiveMenu>();

  async get(customerExternalId: string): Promise<ActiveMenu | null> {
    validateText(customerExternalId, 'customerExternalId');
    return this.menus.get(customerExternalId) ?? null;
  }

  async set(menu: ActiveMenu): Promise<void> {
    const validated = validateMenu(menu);
    this.menus.set(validated.customerExternalId, validated);
  }

  async clear(customerExternalId: string, caseId: string): Promise<boolean> {
    validateText(customerExternalId, 'customerExternalId');
    validateText(caseId, 'caseId');
    const current = this.menus.get(customerExternalId);
    if (!current || current.caseId !== caseId) return false;
    return this.menus.delete(customerExternalId);
  }
}

export interface ActiveMenuDynamoClient {
  getItem(payload: Payload): Promise<{ Item?: Record<string, unknown> }>;
  putItem(payload: Payload): Promise<unknown>;
  deleteItem(payload: Payload): Promise<unknown>;
}

type StringAttribute = { S: string };
type MapAttribute = { M: Record<string, unknown> };
type ListAttribute = { L: unknown[] };

function stringAttribute(value: unknown, field: string): string {
  if (!value || typeof value !== 'object' || typeof (value as Partial<StringAttribute>).S !== 'string') {
    throw new Error(`Invalid active menu Dynamo ${field}`);
  }
  return (value as StringAttribute).S;
}

function choicesAttribute(value: unknown): Choice[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Partial<ListAttribute>).L)) {
    throw new Error('Invalid active menu Dynamo choices');
  }
  return (value as ListAttribute).L.map((entry) => {
    if (!entry || typeof entry !== 'object' || !(entry as Partial<MapAttribute>).M) {
      throw new Error('Invalid active menu Dynamo choice');
    }
    const map = (entry as MapAttribute).M;
    return { label: stringAttribute(map.label, 'choice label'), postback: stringAttribute(map.postback, 'choice postback') };
  });
}

async function activeMenuKey(customerExternalId: string) {
  validateText(customerExternalId, 'customerExternalId');
  return hashDynamoKey(JSON.stringify(['THEMIS', 'ACTIVE_MENU', customerExternalId]));
}

export class DynamoActiveMenuStore implements ActiveMenuStore {
  private readonly table: string;
  private readonly client: ActiveMenuDynamoClient;
  constructor(table: string, client: ActiveMenuDynamoClient) {
    if (!table.trim()) throw new Error('Missing active menu table');
    this.table = table;
    this.client = client;
  }

  async get(customerExternalId: string): Promise<ActiveMenu | null> {
    const result = await this.client.getItem({
      TableName: this.table,
      Key: { idempotencyKey: await activeMenuKey(customerExternalId) },
      ConsistentRead: true,
    });
    if (!result.Item) return null;
    if (stringAttribute(result.Item.recordType, 'recordType') !== 'ACTIVE_MENU') {
      throw new Error('Unexpected record at active menu key');
    }
    return validateMenu({
      customerExternalId,
      caseId: stringAttribute(result.Item.caseId, 'caseId'),
      choices: choicesAttribute(result.Item.choices),
    });
  }

  async set(menu: ActiveMenu): Promise<void> {
    const validated = validateMenu(menu);
    await this.client.putItem({
      TableName: this.table,
      Item: {
        idempotencyKey: await activeMenuKey(validated.customerExternalId),
        recordType: { S: 'ACTIVE_MENU' },
        caseId: { S: validated.caseId },
        choices: { L: validated.choices.map(choice => ({ M: {
          label: { S: choice.label }, postback: { S: choice.postback },
        } })) },
      },
    });
  }

  async clear(customerExternalId: string, caseId: string): Promise<boolean> {
    validateText(caseId, 'caseId');
    try {
      await this.client.deleteItem({
        TableName: this.table,
        Key: { idempotencyKey: await activeMenuKey(customerExternalId) },
        ConditionExpression: '#recordType = :activeMenu AND #caseId = :caseId',
        ExpressionAttributeNames: { '#recordType': 'recordType', '#caseId': 'caseId' },
        ExpressionAttributeValues: { ':activeMenu': { S: 'ACTIVE_MENU' }, ':caseId': { S: caseId } },
      });
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }
}
