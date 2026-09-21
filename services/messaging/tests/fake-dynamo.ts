import type { Payload } from '../src/index.ts';

export type Item = Record<string, { S: string } & Record<string, unknown>>;
export const conditionFailed = () => Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' });
export const keyOf = (value: unknown) => (value as { idempotencyKey: { S: string } }).idempotencyKey.S;

/** Minimal DynamoDB double: honours exactly the conditions/expressions the stores emit (SET/REMOVE/ADD, lease conditions, the claim index Query). */
export function fakeDynamo(hooks: { beforeUpdate?: (p: Payload) => void } = {}) {
  const items = new Map<string, Item>();
  const requests: Payload[] = [];
  return {
    items, requests,
    client: {
      async putItem(p: Payload) {
        requests.push(p);
        const key = keyOf(p.Item);
        if (p.ConditionExpression && items.has(key)) throw conditionFailed();
        items.set(key, structuredClone(p.Item) as Item);
        return {};
      },
      async getItem(p: Payload) { requests.push(p); return { Item: structuredClone(items.get(keyOf(p.Key))) }; },
      async updateItem(p: Payload) {
        requests.push(p);
        hooks.beforeUpdate?.(p);
        const item = items.get(keyOf(p.Key));
        const values = (p.ExpressionAttributeValues ?? {}) as Record<string, { S: string; N: string }>;
        const names = (p.ExpressionAttributeNames ?? {}) as Record<string, string>;
        const condition = p.ConditionExpression as string;
        if (!item) throw conditionFailed();
        if (condition.includes('IN') && ![':open0', ':open1', ':open2'].some(v => values[v].S === item.state.S)) throw conditionFailed();
        if (condition.includes(':processing') && item.state.S !== 'PROCESSING') throw conditionFailed();
        if (condition.includes('leaseOwner = :owner') && item.leaseOwner?.S !== values[':owner'].S) throw conditionFailed();
        if (condition.includes('leaseUntil < :now') && item.leaseUntil && item.leaseUntil.S >= values[':now'].S) throw conditionFailed();
        const resolve = (name: string) => names[name] ?? name;
        for (const [, verb, body] of (p.UpdateExpression as string).matchAll(/(SET|REMOVE|ADD) (.*?)(?= (?:SET|REMOVE|ADD) |$)/g)) {
          for (const part of body.split(', ')) {
            if (verb === 'SET') { const [name, value] = part.split(' = '); item[resolve(name)] = values[value] as never; }
            else if (verb === 'REMOVE') delete item[resolve(part)];
            else { const [name, value] = part.split(' '); item[resolve(name)] = { N: String(Number(item[resolve(name)]?.N ?? 0) + Number(values[value].N)) } as never; }
          }
        }
        return p.ReturnValues === 'ALL_NEW' ? { Attributes: structuredClone(item) } : {};
      },
      async query(p: Payload) {
        requests.push(p);
        const values = p.ExpressionAttributeValues as Record<string, { S: string }>;
        const found = [...items.values()].filter(i => i.claimState?.S === values[':processing'].S && String(i.claimedAt.S) < values[':before'].S)
          .sort((a, b) => a.claimedAt.S.localeCompare(b.claimedAt.S)).slice(0, p.Limit as number);
        return { Items: found.map(i => ({ idempotencyKey: i.idempotencyKey, claimedAt: i.claimedAt })) };
      },
      async deleteItem(p: Payload) {
        requests.push(p);
        const key = keyOf(p.Key);
        const item = items.get(key);
        const values = p.ExpressionAttributeValues as Record<string, { S: string }>;
        if (!item || item.caseId.S !== values[':caseId'].S || (values[':menuId'] && item.menuId.S !== values[':menuId'].S)) throw conditionFailed();
        items.delete(key);
        return {};
      },
    },
  };
}
