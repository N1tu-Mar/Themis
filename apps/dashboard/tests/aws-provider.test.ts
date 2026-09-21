// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { GetItemCommand, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { createAwsProvider } from '@/lib/data/aws-provider';
import { dynamoAccess, objectAccess, type DynamoAccess, type ObjectAccess } from '@/lib/data/aws-access';
import { DataSourceError } from '@/lib/data/provider';
import cases from '../../../fixtures/cases/demo.json';
import reports from '../../../fixtures/cases/demo-reports.json';
import profiles from '../../../fixtures/merchants/demo-profiles.json';
import reviews from '../../../fixtures/cases/demo-human-review-requests.json';
import audits from '../../../fixtures/cases/demo-audit-events.json';

type Row = Record<string, unknown>;
const config = { casesTable: 'cases', merchantsTable: 'merchants', auditTable: 'audit', artifactsBucket: 'artifacts' };

/** In-memory tables laid out exactly like bank-tools' Dynamo store; interprets only the filters the provider emits. */
function backend() {
  const state = {
    failing: false,
    reads: 0,
    tables: {
      cases: [...structuredClone(cases) as Row[], { caseId: 'E#ev_1', doc: {} }] as Row[],
      merchants: [...(profiles as Row[]).map((p) => ({ merchantId: `P#${p.merchantId}`, doc: structuredClone(p) })), { merchantId: 'M#x', doc: {} }] as Row[],
      audit: [
        ...(audits as Row[]).map((a) => ({ caseId: a.caseId, eventId: `audit_${a.eventId}`, doc: a })),
        ...(reviews as Row[]).map((r, i) => ({ caseId: r.caseId, eventId: `review_${i}`, doc: r })),
        { caseId: 'case_demo_a', eventId: 'policy_1', doc: {} },
      ] as Row[],
    },
    objects: new Map<string, string>((reports as Row[]).map((r) => [`reports/${r.caseId}.json`, JSON.stringify(r)])),
  };
  const prefixFilter = (rows: Row[], expr: string, values: Record<string, string>) => {
    const m = /(NOT )?begins_with\((\w+), (:\w+)\)/.exec(expr)!;
    return rows.filter((r) => String(r[m[2]]).startsWith(values[m[3]]) === !m[1]);
  };
  const guard = () => { state.reads++; if (state.failing) throw new Error('backend down'); };
  const dynamo: DynamoAccess = {
    scan: async (table, filter, values) => { guard(); return prefixFilter(state.tables[table as keyof typeof state.tables], filter, values); },
    get: async (table, key) => { guard(); const [k, v] = Object.entries(key)[0]; return state.tables[table as keyof typeof state.tables].find((r) => r[k] === v); },
    query: async (table, condition, values) => {
      guard();
      return prefixFilter(state.tables.audit.filter((r) => r.caseId === values[':c']), condition, values);
    },
  };
  const objects: ObjectAccess = { getText: async (_b, key) => { guard(); return state.objects.get(key); } };
  return { state, provider: createAwsProvider(config, { dynamo, objects }, () => new Date('2026-09-20T12:00:00Z')) };
}

describe('aws provider', () => {
  it('lists cases without evidence rows, and a newly processed case shows on the next read', async () => {
    const { state, provider } = backend();
    const before = await provider.listCases();
    expect(before).toHaveLength(cases.length);
    state.tables.cases.push({ ...structuredClone(cases[0]), caseId: 'case_new_1', updatedAt: '2026-09-21T00:00:00Z' } as Row);
    expect((await provider.listCases()).map((c) => c.caseId)).toContain('case_new_1');
    expect((await provider.getCase('case_new_1'))?.caseId).toBe('case_new_1');
  });

  it('reflects updated merchant intelligence immediately', async () => {
    const { state, provider } = backend();
    const id = (profiles[0] as Row).merchantId as string;
    expect((await provider.getMerchantProfile(id))?.canonicalName).toBe((profiles[0] as Row).canonicalName);
    const row = state.tables.merchants.find((r) => r.merchantId === `P#${id}`)!;
    (row.doc as Row).canonicalName = 'Renamed By Research';
    expect((await provider.getMerchantProfile(id))?.canonicalName).toBe('Renamed By Research');
    expect((await provider.listMerchantProfiles()).map((m) => m.canonicalName)).toContain('Renamed By Research');
    expect((await provider.listMerchantProfiles()).length).toBe(profiles.length);
  });

  it('reads reports from S3, treating a missing object as absent and a mismatched one as an error', async () => {
    const { state, provider } = backend();
    expect((await provider.getCaseReport('case_demo_d'))?.caseId).toBe('case_demo_d');
    expect(await provider.getCaseReport('case_missing')).toBeUndefined();
    state.objects.set('reports/case_demo_a.json', state.objects.get('reports/case_demo_d.json')!);
    await expect(provider.getCaseReport('case_demo_a')).rejects.toBeInstanceOf(DataSourceError);
  });

  it('returns review requests and per-case audit events (audit rows only, ordered)', async () => {
    const { provider } = backend();
    expect((await provider.listHumanReviewRequests()).length).toBe(reviews.length);
    const events = await provider.listAuditEvents('case_demo_d');
    expect(events.length).toBe((audits as Row[]).filter((a) => a.caseId === 'case_demo_d').length);
    expect([...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))).toEqual(events);
  });

  it('drops records that fail contract validation and reports how many', async () => {
    const { state, provider } = backend();
    state.tables.cases.push({ caseId: 'case_bad', status: 'NOPE' });
    expect(await provider.listCases()).toHaveLength(cases.length);
    expect(provider.status().skippedRecords).toBe(1);
    state.tables.cases.pop();
    await provider.listCases();
    expect(provider.status().skippedRecords).toBe(0);
  });

  it('serves the last good copy as stale when the backend fails, and recovers', async () => {
    const { state, provider } = backend();
    await provider.listCases();
    expect(provider.status().stale).toBe(false);
    state.failing = true;
    expect(await provider.listCases()).toHaveLength(cases.length);
    expect(provider.status()).toMatchObject({ stale: true, staleSince: '2026-09-20T12:00:00.000Z' });
    state.failing = false;
    await provider.listCases();
    expect(provider.status().stale).toBe(false);
  });

  it('throws DataSourceError when the backend fails and nothing was ever read', async () => {
    const { state, provider } = backend();
    state.failing = true;
    await expect(provider.listCases()).rejects.toBeInstanceOf(DataSourceError);
    await expect(provider.getCaseReport('case_demo_a')).rejects.toBeInstanceOf(DataSourceError);
  });

  it('never queries the backend for ids that could address non-case rows', async () => {
    const { state, provider } = backend();
    expect(await provider.getCase('E#ev_1')).toBeUndefined();
    expect(await provider.getMerchantProfile('../x')).toBeUndefined();
    expect(await provider.getCaseReport('a/b')).toBeUndefined();
    expect(await provider.listAuditEvents('a b')).toEqual([]);
    expect(state.reads).toBe(0);
  });
});

describe('aws access adapters', () => {
  it('unmarshals attributes, follows pagination and sends key values as strings', async () => {
    const sent: unknown[] = [];
    const client = { send: async (command: unknown) => {
      sent.push(command);
      if (command instanceof ScanCommand && !command.input.ExclusiveStartKey) {
        return { Items: [{ caseId: { S: 'a' }, n: { N: '2.5' }, ok: { BOOL: true }, nothing: { NULL: true }, list: { L: [{ S: 'x' }] }, map: { M: { k: { S: 'v' } } } }], LastEvaluatedKey: { caseId: { S: 'a' } } };
      }
      if (command instanceof ScanCommand) return { Items: [{ caseId: { S: 'b' } }] };
      if (command instanceof GetItemCommand) return { Item: { merchantId: { S: 'P#m' } } };
      return { Items: [] };
    } } as never;
    const access = dynamoAccess(client);
    const rows = await access.scan('t', 'begins_with(caseId, :p)', { ':p': 'x' });
    expect(rows).toEqual([{ caseId: 'a', n: 2.5, ok: true, nothing: null, list: ['x'], map: { k: 'v' } }, { caseId: 'b' }]);
    expect(await access.get('m', { merchantId: 'P#m' })).toEqual({ merchantId: 'P#m' });
    await access.query('a', 'caseId = :c', { ':c': 'c1' });
    const get = sent.find((c) => c instanceof GetItemCommand) as GetItemCommand;
    expect(get.input).toMatchObject({ Key: { merchantId: { S: 'P#m' } }, ConsistentRead: true });
    const query = sent.find((c) => c instanceof QueryCommand) as QueryCommand;
    expect(query.input.ExpressionAttributeValues).toEqual({ ':c': { S: 'c1' } });
  });

  it('maps a missing S3 object to undefined and rethrows other errors', async () => {
    const body = { transformToString: async () => '{"a":1}' };
    expect(await objectAccess({ send: async () => ({ Body: body }) } as never).getText('b', 'k')).toBe('{"a":1}');
    const missing = objectAccess({ send: async () => { throw Object.assign(new Error('x'), { name: 'NoSuchKey' }); } } as never);
    expect(await missing.getText('b', 'k')).toBeUndefined();
    const denied = objectAccess({ send: async () => { throw Object.assign(new Error('denied'), { name: 'AccessDenied' }); } } as never);
    await expect(denied.getText('b', 'k')).rejects.toThrow('denied');
  });
});
