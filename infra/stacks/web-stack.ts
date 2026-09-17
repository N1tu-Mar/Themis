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

    // Compute role for Amplify's SSR (WEB_COMPUTE) runtime. Starts with only
    // log access; extend with explicit table/bucket grants here if a
    // dashboard SSR route ends up calling AWS services directly instead of
    // going through the agent/bank-tools APIs.
    const computeRole = new iam.Role(this, 'ComputeRole', {
      assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
      description: 'Amplify Hosting SSR compute role for apps/dashboard',
    });
    computeRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));

    const app = new amplify.CfnApp(this, 'DashboardApp', {
      name: 'themis-dashboard',
      description: 'Themis internal investigator dashboard (apps/dashboard)',
      platform: 'WEB_COMPUTE',
      computeRoleArn: computeRole.roleArn,
      environmentVariables: [
        { name: 'THEMIS_MODE', value: config.themisMode },
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
