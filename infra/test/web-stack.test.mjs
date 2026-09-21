import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from '../dist/stacks/data-stack.js';
import { WebStack } from '../dist/stacks/web-stack.js';
import { loadConfig } from '../dist/config/env.js';

function synth() {
  const app = new cdk.App();
  const config = loadConfig();
  const data = new DataStack(app, 'TestData5', { config });
  const stack = new WebStack(app, 'TestWeb', { config, data });
  return Template.fromStack(stack);
}

test('provisions one Amplify app with no repository connected (manual step)', () => {
  const t = synth();
  t.resourceCountIs('AWS::Amplify::App', 1);
  const apps = t.findResources('AWS::Amplify::App');
  for (const app of Object.values(apps)) {
    if ('Repository' in app.Properties) throw new Error('repository should not be wired from CDK - see class doc comment');
  }
});

test('provisions a main branch for the app', () => {
  const t = synth();
  t.resourceCountIs('AWS::Amplify::Branch', 1);
  t.hasResourceProperties('AWS::Amplify::Branch', { BranchName: 'main' });
});

function statements(template) {
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .flatMap((policy) => policy.Properties.PolicyDocument.Statement);
}

function actions(statement) {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

test('Amplify compute role has exact read-only access to dashboard data', () => {
  const t = synth();
  const dataStatements = statements(t).filter((statement) =>
    actions(statement).some((action) => action.startsWith('dynamodb:') || action.startsWith('s3:')));

  const dynamo = dataStatements.find((statement) => actions(statement).includes('dynamodb:Scan'));
  assert.deepEqual(new Set(actions(dynamo)), new Set(['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan']));
  assert.equal(dynamo.Resource.length, 3);

  const getReport = dataStatements.find((statement) => actions(statement).includes('s3:GetObject'));
  assert.deepEqual(actions(getReport), ['s3:GetObject']);
  assert.match(JSON.stringify(getReport.Resource), /reports\/\*/);

  const listReports = dataStatements.find((statement) => actions(statement).includes('s3:ListBucket'));
  assert.deepEqual(actions(listReports), ['s3:ListBucket']);
  assert.deepEqual(listReports.Condition, { StringLike: { 's3:prefix': ['reports/*'] } });

  const forbidden = dataStatements.flatMap(actions).filter((action) =>
    /(?:Put|Update|Delete|Write|BatchWrite)/i.test(action));
  assert.deepEqual(forbidden, []);
});

test('Amplify live SSR environment and build spec expose only server-side data settings', () => {
  const t = synth();
  const apps = Object.values(t.findResources('AWS::Amplify::App'));
  assert.equal(apps.length, 1);
  const props = apps[0].Properties;
  const env = Object.fromEntries(props.EnvironmentVariables.map(({ Name, Value }) => [Name, Value]));

  assert.equal(env.THEMIS_DASHBOARD_DATA_SOURCE, 'aws');
  assert.equal(env.AMPLIFY_MONOREPO_APP_ROOT, 'apps/dashboard');
  for (const name of ['CASES_TABLE', 'MERCHANTS_TABLE', 'AUDIT_TABLE', 'ARTIFACTS_BUCKET']) {
    assert.ok(env[name], `${name} must be passed to Amplify`);
  }
  assert.equal(Object.keys(env).some((name) => name.startsWith('NEXT_PUBLIC_')), false);
  assert.equal(Object.keys(env).some((name) => /(?:SECRET|ACCESS_KEY|CREDENTIAL)/.test(name)), false);

  assert.match(props.BuildSpec, /appRoot: apps\/dashboard/);
  assert.match(props.BuildSpec, /AWS_REGION=%s/);
  assert.match(props.BuildSpec, /THEMIS_DASHBOARD_DATA_SOURCE\|CASES_TABLE\|MERCHANTS_TABLE\|AUDIT_TABLE\|ARTIFACTS_BUCKET/);
  assert.doesNotMatch(props.BuildSpec, /NEXT_PUBLIC_/);
  assert.doesNotMatch(props.BuildSpec, /AWS_ACCESS_KEY|AWS_SECRET|AWS_SESSION_TOKEN/);
});
