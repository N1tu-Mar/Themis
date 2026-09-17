import { test } from 'node:test';
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
