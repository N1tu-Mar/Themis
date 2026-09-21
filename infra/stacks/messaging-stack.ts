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
import { MESSAGING_FUNCTION_NAME, type AgentStack } from './agent-stack';

export interface MessagingStackProps extends cdk.StackProps {
  readonly config: ThemisConfig;
  readonly data: DataStack;
  readonly agent: AgentStack;
}

/**
 * Inbound customer messaging (prompt.md #30-#33): trusted channel topic(s)
 * subscribe one normalizer Lambda that forwards into the AgentCore Runtime.
 * Delivery telemetry uses a distinct, unsubscribed SNS topic. No SQS queue is
 * needed: SNS -> Lambda retries plus the idempotency table cover inbound retry
 * safety for a hackathon-scale demo.
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
  /** SMS inbound topic (or the only enabled channel's topic). */
  public readonly inboundTopic: sns.Topic;
  /** Distinct RCS topic when both channels are enabled: plain RCS and SMS payloads cannot be told apart. */
  public readonly rcsInboundTopic: sns.Topic;
  /** Delivery telemetry only; never carries customer messages and has no normalizer subscription. */
  public readonly deliveryEventTopic: sns.Topic;
  public readonly normalizerFunction: lambda.Function;
  public readonly normalizerLogGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);
    const { config, data, agent } = props;

    this.inboundTopic = new sns.Topic(this, 'ThemisInboundMessaging', {
      topicName: 'ThemisInboundMessaging',
      displayName: 'Themis inbound RCS/SMS messages',
    });

    this.rcsInboundTopic = config.enableRcs && config.enableSmsFallback
      ? new sns.Topic(this, 'ThemisInboundRcs', { topicName: 'ThemisInboundRcs', displayName: 'Themis inbound RCS messages' })
      : this.inboundTopic;

    this.deliveryEventTopic = new sns.Topic(this, 'ThemisMessagingDeliveryEvents', {
      topicName: 'ThemisMessagingDeliveryEvents',
      displayName: 'Themis outbound messaging delivery events',
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

    // Outbound: agent replies and the send_* tools. Identities are provisioned manually (see infra README).
    normalizerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sms-voice:SendTextMessage', 'sms-voice:SendRcsMessage'],
      resources: [`arn:aws:sms-voice:${this.region}:${this.account}:*`],
    }));
    if (config.enableSes) {
      normalizerRole.addToPolicy(new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [`arn:aws:ses:${this.region}:${this.account}:identity/${config.sesSenderDomain}`],
      }));
    }

    this.normalizerLogGroup = new logs.LogGroup(this, 'NormalizerLogGroup', {
      logGroupName: '/aws/lambda/ThemisMessageNormalizer',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.normalizerFunction = new lambda.Function(this, 'NormalizerFunction', {
      functionName: MESSAGING_FUNCTION_NAME,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      // esbuild bundle of services/messaging/src/aws-entry.ts (npm --prefix services/messaging run build)
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../services/messaging/dist')),
      role: normalizerRole,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      logGroup: this.normalizerLogGroup,
      environment: {
        THEMIS_MODE: 'aws', // the bundled Lambda entry only supports aws; local mode is the in-process test composition
        IDEMPOTENCY_TABLE: data.idempotencyTable.tableName,
        AGENT_RUNTIME_ARN: agent.runtime.attrAgentRuntimeArn,
        ENABLE_RCS: String(config.enableRcs),
        ENABLE_SMS_FALLBACK: String(config.enableSmsFallback),
        ...(config.enableRcs ? { THEMIS_RCS_TOPIC_ARN: this.rcsInboundTopic.topicArn } : {}),
        ...(config.enableSmsFallback ? { THEMIS_SMS_TOPIC_ARN: this.inboundTopic.topicArn } : {}),
        THEMIS_RCS_POOL_ID: config.rcsPoolId,
        THEMIS_SMS_IDENTITY: config.smsIdentity,
        THEMIS_SES_FROM: config.sesFromAddress,
        THEMIS_SUPPORT: config.supportContact,
      },
    });
    for (const topic of new Set([this.inboundTopic, this.rcsInboundTopic])) {
      topic.addSubscription(new subs.LambdaSubscription(this.normalizerFunction));
    }

    // Role the service assumes to publish inbound customer messages. It can
    // publish only to enabled inbound topics, never the delivery-event topic.
    if (config.enableRcs || config.enableSmsFallback) {
      const smsTwoWayRole = new iam.Role(this, 'SmsTwoWayRole', {
        assumedBy: new iam.ServicePrincipal('sms-voice.amazonaws.com', {
          conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
        }),
        description: 'Assumed by AWS End User Messaging to publish inbound customer messages',
      });
      for (const topic of new Set([this.inboundTopic, this.rcsInboundTopic])) {
        topic.grantPublish(smsTwoWayRole);
      }
      new cdk.CfnOutput(this, 'SmsTwoWayRoleArn', { value: smsTwoWayRole.roleArn });
    }

    if (config.enableSmsFallback) {
      this.deliveryEventTopic.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'AllowSmsVoiceDeliveryEvents',
        principals: [new iam.ServicePrincipal('sms-voice.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.deliveryEventTopic.topicArn],
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: {
            'aws:SourceArn': `arn:aws:sms-voice:${this.region}:${this.account}:configuration-set/ThemisSmsConfigurationSet`,
          },
        },
      }));
      new smsvoice.CfnConfigurationSet(this, 'SmsConfigurationSet', {
        configurationSetName: 'ThemisSmsConfigurationSet',
        eventDestinations: [{
          eventDestinationName: 'delivery-events-to-sns',
          enabled: true,
          // Verify this matching-event-types value against current
          // AWS::SMSVOICEV2::ConfigurationSet docs before deploy.
          matchingEventTypes: ['ALL'],
          snsDestination: { topicArn: this.deliveryEventTopic.topicArn },
        }],
      });

    }

    new cdk.CfnOutput(this, 'InboundTopicArn', { value: this.inboundTopic.topicArn });
    new cdk.CfnOutput(this, 'RcsInboundTopicArn', { value: this.rcsInboundTopic.topicArn });
    new cdk.CfnOutput(this, 'DeliveryEventTopicArn', { value: this.deliveryEventTopic.topicArn });
    new cdk.CfnOutput(this, 'NormalizerFunctionName', { value: this.normalizerFunction.functionName });
  }
}
