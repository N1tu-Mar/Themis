import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const infraDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// This is the required "cdk synth must not error" check (stop condition #1).
// It shells out to the real `cdk synth` (via the locally installed CLI) with
// dummy account/region context so no AWS credentials are needed. No AWS API
// call - paid or otherwise - happens anywhere in this test file.
test('cdk synth succeeds for every stack', () => {
  const out = execFileSync('npx', ['--no-install', 'cdk', 'synth', '--quiet'], {
    cwd: infraDir,
    encoding: 'utf-8',
    env: { ...process.env, CDK_DEFAULT_ACCOUNT: '123456789012', CDK_DEFAULT_REGION: 'us-east-1' },
  });
  assert.ok(out.length >= 0); // synth exits non-zero (throws) on any error; reaching here is the assertion
});
