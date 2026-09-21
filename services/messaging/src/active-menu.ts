import type { Choice } from './choices.ts';
import { hashDynamoKey } from './idempotency.ts';
import type { Payload } from './outbound.ts';

export interface ActiveMenu {
  readonly customerExternalId: string;
  readonly caseId: string;
  /** Identifies one rendered menu; conditional cleanup by menuId cannot delete a newer menu for the same case. */
  readonly menuId: string;
  readonly choices: readonly Choice[];
}

export type ActiveMenuInput = Omit<ActiveMenu, 'menuId'> & { readonly menuId?: string };

export interface ActiveMenuStore {
  get(customerExternalId: string): Promise<ActiveMenu | null>;
  /** Replaces any existing menu for the customer. */
  set(menu: ActiveMenuInput): Promise<ActiveMenu>;
  /** Deletes only if the stored menu is for `caseId` (and is `menuId`, when given). */
  clear(customerExternalId: string, caseId: string, menuId?: string): Promise<boolean>;
}

function validateText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid active menu ${field}`);
  return value;
}

function validateMenu(menu: ActiveMenuInput): ActiveMenu {
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
  const menuId = menu.menuId === undefined ? crypto.randomUUID() : validateText(menu.menuId, 'menuId');
  return Object.freeze({ customerExternalId, caseId, menuId, choices: Object.freeze(choices) });
}

export class MemoryActiveMenuStore implements ActiveMenuStore {
  private readonly menus = new Map<string, ActiveMenu>();

  async get(customerExternalId: string): Promise<ActiveMenu | null> {
    validateText(customerExternalId, 'customerExternalId');
    return this.menus.get(customerExternalId) ?? null;
  }

  async set(menu: ActiveMenuInput): Promise<ActiveMenu> {
    const validated = validateMenu(menu);
    this.menus.set(validated.customerExternalId, validated);
    return validated;
  }

  async clear(customerExternalId: string, caseId: string, menuId?: string): Promise<boolean> {
    validateText(customerExternalId, 'customerExternalId');
    validateText(caseId, 'caseId');
    const current = this.menus.get(customerExternalId);
    if (!current || current.caseId !== caseId || (menuId !== undefined && current.menuId !== menuId)) return false;
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
      menuId: result.Item.menuId === undefined ? 'legacy' : stringAttribute(result.Item.menuId, 'menuId'),
      choices: choicesAttribute(result.Item.choices),
    });
  }

  async set(menu: ActiveMenuInput): Promise<ActiveMenu> {
    const validated = validateMenu(menu);
    await this.client.putItem({
      TableName: this.table,
      Item: {
        idempotencyKey: await activeMenuKey(validated.customerExternalId),
        recordType: { S: 'ACTIVE_MENU' },
        caseId: { S: validated.caseId },
        menuId: { S: validated.menuId },
        choices: { L: validated.choices.map(choice => ({ M: {
          label: { S: choice.label }, postback: { S: choice.postback },
        } })) },
      },
    });
    return validated;
  }

  async clear(customerExternalId: string, caseId: string, menuId?: string): Promise<boolean> {
    validateText(caseId, 'caseId');
    try {
      await this.client.deleteItem({
        TableName: this.table,
        Key: { idempotencyKey: await activeMenuKey(customerExternalId) },
        ConditionExpression: '#recordType = :activeMenu AND #caseId = :caseId' + (menuId === undefined ? '' : ' AND #menuId = :menuId'),
        ExpressionAttributeNames: { '#recordType': 'recordType', '#caseId': 'caseId', ...(menuId === undefined ? {} : { '#menuId': 'menuId' }) },
        ExpressionAttributeValues: { ':activeMenu': { S: 'ACTIVE_MENU' }, ':caseId': { S: caseId }, ...(menuId === undefined ? {} : { ':menuId': { S: menuId } }) },
      });
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }
}
