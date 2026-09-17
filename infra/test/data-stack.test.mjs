import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from '../dist/stacks/data-stack.js';
import { loadConfig } from '../dist/config/env.js';

function synth() {
  const app = new cdk.App();
  const stack = new DataStack(app, 'TestData', { config: loadConfig() });
  return Template.fromStack(stack);
}

test('provisions the four DynamoDB tables named in prompt.md #28', () => {
  const t = synth();
  for (const name of ['ThemisTransactions', 'ThemisCases', 'ThemisMerchants', 'ThemisAudit']) {
    t.hasResourceProperties('AWS::DynamoDB::Table', { TableName: name });
  }
});

test('adds an idempotency table with TTL for retry safety (prompt.md #31)', () => {
  const t = synth();
  t.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: 'ThemisIdempotency',
    TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
  });
});

test('tables use on-demand billing (no idle cost) and destroy on teardown', () => {
  const t = synth();
  const tables = t.findResources('AWS::DynamoDB::Table');
  const count = Object.keys(tables).length;
  assert.equal(count, 5, `expected 5 tables, found ${count}`);
  for (const [, resource] of Object.entries(tables)) {
    assert.equal(resource.Properties.BillingMode, 'PAY_PER_REQUEST');
    assert.equal(resource.DeletionPolicy, 'Delete');
  }
});

test('cases/transactions tables expose the GSIs the app actually queries', () => {
  const t = synth();
  t.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: 'ThemisTransactions',
    GlobalSecondaryIndexes: Match.arrayWith([
      Match.objectLike({ IndexName: 'byCustomer' }),
      Match.objectLike({ IndexName: 'byMerchant' }),
    ]),
  });
  t.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: 'ThemisCases',
    GlobalSecondaryIndexes: Match.arrayWith([
      Match.objectLike({ IndexName: 'byCustomer' }),
      Match.objectLike({ IndexName: 'byStatus' }),
    ]),
  });
});

test('provisions exactly one private, encrypted S3 bucket for artifacts', () => {
  const t = synth();
  const buckets = t.findResources('AWS::S3::Bucket');
  assert.equal(Object.keys(buckets).length, 1);
  t.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
});

test('exposes table/bucket names as stack outputs for integration', () => {
  const t = synth();
  const outputs = t.findOutputs('*');
  for (const key of ['TransactionsTableName', 'CasesTableName', 'MerchantsTableName', 'AuditTableName', 'ArtifactsBucketName']) {
    assert.ok(outputs[key], `missing output ${key}`);
  }
});
