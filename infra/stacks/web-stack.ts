import * as cdk from 'aws-cdk-lib';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { ThemisConfig } from '../config/env';
import type { DataStack } from './data-stack';

export interface WebStackProps extends cdk.StackProps {
  readonly config: ThemisConfig;
  readonly data: DataStack;
}

/**
 * Amplify Hosting shell for apps/dashboard (prompt.md #9, #35). Provisions
 * the App/Branch resources and their environment variables; does NOT connect
 * a GitHub repository, because that requires an interactive OAuth/GitHub App
 * authorization that cannot be embedded in code without committing a
 * credential (prompt.md #47 forbids that). See
 * .handoffs/infra/web-manual-steps.md for the one-time console step.
 */
export class WebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    const { config, data } = props;

    // Compute role for Amplify's SSR (WEB_COMPUTE) runtime. Dashboard reads
    // use the SDK default credential chain, so no AWS credentials are stored
    // in Amplify environment variables or included in the browser bundle.
    const computeRole = new iam.Role(this, 'ComputeRole', {
      assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
      description: 'Amplify Hosting SSR compute role for apps/dashboard',
    });
    computeRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    computeRole.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [data.casesTable.tableArn, data.merchantsTable.tableArn, data.auditTable.tableArn],
    }));
    computeRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [data.artifactsBucket.arnForObjects('reports/*')],
    }));
    computeRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucket'],
      resources: [data.artifactsBucket.bucketArn],
      conditions: { StringLike: { 's3:prefix': ['reports/*'] } },
    }));

    // Amplify WEB_COMPUTE does not automatically expose app environment
    // variables to a Next.js SSR runtime. Copy only this explicit, non-secret,
    // server-side allowlist into the production environment during the build.
    // AWS_REGION is supplied by Amplify's build environment, with the stack
    // region as a deterministic fallback; AWS_* credentials are never copied.
    const buildSpec = `version: 1
applications:
  - appRoot: apps/dashboard
    frontend:
      phases:
        preBuild:
          commands:
            - npm ci
        build:
          commands:
            - printf 'AWS_REGION=%s\\n' "\${AWS_REGION:-${config.region}}" > .env.production
            - env | grep -E '^(THEMIS_DASHBOARD_DATA_SOURCE|CASES_TABLE|MERCHANTS_TABLE|AUDIT_TABLE|ARTIFACTS_BUCKET)=' >> .env.production
            - npm run build
      artifacts:
        baseDirectory: .next
        files:
          - '**/*'
      cache:
        paths:
          - ../../node_modules/**/*
          - .next/cache/**/*
`;

    const app = new amplify.CfnApp(this, 'DashboardApp', {
      name: 'themis-dashboard',
      description: 'Themis internal investigator dashboard (apps/dashboard)',
      platform: 'WEB_COMPUTE',
      computeRoleArn: computeRole.roleArn,
      buildSpec,
      environmentVariables: [
        { name: 'THEMIS_DASHBOARD_DATA_SOURCE', value: 'aws' },
        { name: 'AMPLIFY_MONOREPO_APP_ROOT', value: 'apps/dashboard' },
        { name: 'CASES_TABLE', value: data.casesTable.tableName },
        { name: 'MERCHANTS_TABLE', value: data.merchantsTable.tableName },
        { name: 'AUDIT_TABLE', value: data.auditTable.tableName },
        { name: 'ARTIFACTS_BUCKET', value: data.artifactsBucket.bucketName },
      ],
    });

    new amplify.CfnBranch(this, 'MainBranch', {
      appId: app.attrAppId,
      branchName: 'main',
      stage: 'PRODUCTION',
      framework: 'Next.js - SSR',
      enableAutoBuild: false, // no repository connected yet - see class doc comment
    });

    new cdk.CfnOutput(this, 'AmplifyAppId', { value: app.attrAppId });
    new cdk.CfnOutput(this, 'AmplifyDefaultDomain', { value: app.attrDefaultDomain });
  }
}
