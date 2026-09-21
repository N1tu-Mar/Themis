import {
  DynamoDBClient, GetItemCommand, QueryCommand, ScanCommand, type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Server-only: credentials come from the Amplify compute role via the SDK default chain, never from the browser.
if (typeof window !== 'undefined') throw new Error('AWS data access is server-side only');

type Row = Record<string, unknown>;

/** Narrow read-only view of DynamoDB returning plain (unmarshalled) rows. */
export interface DynamoAccess {
  scan(table: string, filter: string, values: Record<string, string>): Promise<Row[]>;
  get(table: string, key: Record<string, string>): Promise<Row | undefined>;
  query(table: string, condition: string, values: Record<string, string>): Promise<Row[]>;
}

/** Narrow read-only view of S3. Resolves undefined when the object does not exist. */
export interface ObjectAccess {
  getText(bucket: string, key: string): Promise<string | undefined>;
}

export function unmarshal(attribute: AttributeValue): unknown {
  if ('S' in attribute && attribute.S !== undefined) return attribute.S;
  if ('N' in attribute && attribute.N !== undefined) return Number(attribute.N);
  if ('BOOL' in attribute && attribute.BOOL !== undefined) return attribute.BOOL;
  if ('NULL' in attribute) return null;
  if ('L' in attribute && attribute.L) return attribute.L.map(unmarshal);
  if ('M' in attribute && attribute.M) return unmarshalRow(attribute.M);
  throw new Error('Unsupported DynamoDB attribute type');
}

const unmarshalRow = (item: Record<string, AttributeValue>): Row =>
  Object.fromEntries(Object.entries(item).map(([k, v]) => [k, unmarshal(v)]));

const strings = (values: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { S: v }]));

// ponytail: full-table Scan with a filter. Fine at demo/pilot volume; add a GSI or a
// per-record-type index before the tables hold more than a few thousand rows.
const MAX_PAGES = 200;

export function dynamoAccess(client: Pick<DynamoDBClient, 'send'>): DynamoAccess {
  async function pages(build: (start?: Record<string, AttributeValue>) => ScanCommand | QueryCommand): Promise<Row[]> {
    const rows: Row[] = [];
    let start: Record<string, AttributeValue> | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const out = await client.send(build(start));
      rows.push(...(out.Items ?? []).map(unmarshalRow));
      start = out.LastEvaluatedKey;
      if (!start) return rows;
    }
    throw new Error('DynamoDB read exceeded the page limit');
  }
  return {
    scan: (table, filter, values) => pages((start) => new ScanCommand({
      TableName: table, FilterExpression: filter, ExpressionAttributeValues: strings(values), ExclusiveStartKey: start,
    })),
    query: (table, condition, values) => pages((start) => new QueryCommand({
      TableName: table, KeyConditionExpression: condition, ExpressionAttributeValues: strings(values), ExclusiveStartKey: start,
    })),
    get: async (table, key) => {
      const out = await client.send(new GetItemCommand({ TableName: table, Key: strings(key), ConsistentRead: true }));
      return out.Item ? unmarshalRow(out.Item) : undefined;
    },
  };
}

export function objectAccess(client: Pick<S3Client, 'send'>): ObjectAccess {
  return {
    async getText(bucket, key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return await out.Body?.transformToString();
      } catch (error) {
        if (error instanceof Error && (error.name === 'NoSuchKey' || error.name === 'NotFound')) return undefined;
        throw error;
      }
    },
  };
}

export function defaultAwsAccess(): { dynamo: DynamoAccess; objects: ObjectAccess } {
  return { dynamo: dynamoAccess(new DynamoDBClient({})), objects: objectAccess(new S3Client({})) };
}
