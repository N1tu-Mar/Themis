import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as smsvoice from 'aws-cdk-lib/aws-smsvoice';
import { Construct } from 'constructs';
import * as path from 'path';
import type { ThemisConfig } from '../config/env';
import type { DataStack } from './data-stack';
import type { AgentStack } from './agent-stack';

export interface MessagingStackProps extends cdk.StackProps {
  readonly config: ThemisConfig;
  readonly data: DataStack;
  readonly agent: AgentStack;
}

/**
 * Inbound customer messaging (prompt.md #30-#33): a single SNS topic is the
 * two-way destination for both channels, subscribed by one normalizer
 * Lambda that forwards into the AgentCore Runtime. No SQS queue in front of
 * it - the CDS instructions call for one only if a real reliability need
 * appears, and SNS -> Lambda retries (plus the idempotency table in
 * DataStack) already cover inbound retry safety for a hackathon-scale demo.
 *
 * What CDK does NOT provision here, and why:
 * - RCS sender registration (AWS End User Messaging Social) has no
 *   CloudFormation resource type as of this aws-cdk-lib version - it's
 *   console/API-only. Manual step, documented below.
 * - SMS origination (a real phone number/pool via AWS::SMSVOICEV2) requires
 *   carrier registration that can take days and has an ongoing per-number
 *   cost; provisioning it via CDK would not be reproducible on a hackathon
 *   timeline. Manual step, documented below. The reusable, immediately
 *   reproducible piece - the ConfigurationSet, the two-way IAM role, and the
 *   SNS topic - is provisioned here so attaching a manually-created number is
 *   a one-field console edit.
 */
export class MessagingStack extends cdk.Stack {
  public readonly inboundTopic: sns.Topic;
  public readonly normalizerFunction: lambda.Function;
  public readonly normalizerLogGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);
    const { config, data, agent } = props;

    this.inboundTopic = new sns.Topic(this, 'ThemisInboundMessaging', {
      topicName: 'ThemisInboundMessaging',
      displayName: 'Themis inbound RCS/SMS messages',
    });

    const normalizerRole = new iam.Role(this, 'NormalizerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for the inbound message normalizer Lambda',
    });
    normalizerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );
    data.idempotencyTable.grantReadWriteData(normalizerRole);
    normalizerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock-agentcore:InvokeAgentRuntime'],
      resources: [agent.runtime.attrAgentRuntimeArn],
    }));

    this.normalizerLogGroup = new logs.LogGroup(this, 'NormalizerLogGroup', {
      logGroupName: '/aws/lambda/ThemisMessageNormalizer',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.normalizerFunction = new lambda.Function(this, 'NormalizerFunction', {
      functionName: 'ThemisMessageNormalizer',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/message-normalizer')),
      role: normalizerRole,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      logGroup: this.normalizerLogGroup,
      environment: {
        THEMIS_MODE: config.themisMode,
        IDEMPOTENCY_TABLE: data.idempotencyTable.tableName,
        AGENT_RUNTIME_ARN: agent.runtime.attrAgentRuntimeArn,
        ENABLE_RCS: String(config.enableRcs),
        ENABLE_SMS_FALLBACK: String(config.enableSmsFallback),
      },
    });
    this.inboundTopic.addSubscription(new subs.LambdaSubscription(this.normalizerFunction));

    // Role the End User Messaging SMS service assumes to publish inbound
    // two-way messages to the topic above. Attach its ARN as
    // twoWay.channelRole on the manually-created phone number/pool (see
    // .handoffs/infra/messaging-manual-steps.md). Service principal name is
    // this service's best-documented one at time of writing - confirm
    // against the AWS console if the manual attach step rejects it.
    if (config.enableSmsFallback) {
      const smsTwoWayRole = new iam.Role(this, 'SmsTwoWayRole', {
        assumedBy: new iam.ServicePrincipal('sms-voice.amazonaws.com'),
        description: 'Assumed by AWS End User Messaging SMS to publish inbound two-way messages',
      });
      this.inboundTopic.grantPublish(smsTwoWayRole);

      new smsvoice.CfnConfigurationSet(this, 'SmsConfigurationSet', {
        configurationSetName: 'ThemisSmsConfigurationSet',
        eventDestinations: [{
          eventDestinationName: 'delivery-events-to-sns',
          enabled: true,
          // Verify this matching-event-types value against current
          // AWS::SMSVOICEV2::ConfigurationSet docs before deploy.
          matchingEventTypes: ['ALL'],
          snsDestination: { topicArn: this.inboundTopic.topicArn },
        }],
      });

      new cdk.CfnOutput(this, 'SmsTwoWayRoleArn', { value: smsTwoWayRole.roleArn });
    }

    new cdk.CfnOutput(this, 'InboundTopicArn', { value: this.inboundTopic.topicArn });
    new cdk.CfnOutput(this, 'NormalizerFunctionName', { value: this.normalizerFunction.functionName });
  }
}
