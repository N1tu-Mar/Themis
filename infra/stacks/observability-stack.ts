import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { AgentStack } from './agent-stack';
import type { MessagingStack } from './messaging-stack';

export interface ObservabilityStackProps extends cdk.StackProps {
  readonly agent: AgentStack;
  readonly messaging: MessagingStack;
}

/**
 * Minimal operational visibility (prompt.md #8, #45): failures in message
 * handling, tool calls, and policy decisions should be visible in one place.
 * Not an enterprise SIEM - two Lambda error alarms, two log-based metrics
 * derived directly from the AuditEventSchema fields (result, policyOutcome)
 * that the tools adapter is expected to log, and one dashboard.
 */
export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { agent, messaging } = props;

    const toolsAdapterLogs = agent.toolsAdapterLogGroup;

    // Audit records are structured JSON (AuditEventSchema: result, tool,
    // policyOutcome - prompt.md #45, never chain-of-thought). These filters
    // count the two failure/deny cases directly from that shape.
    const toolFailures = new logs.MetricFilter(this, 'ToolFailureFilter', {
      logGroup: toolsAdapterLogs,
      metricNamespace: 'Themis',
      metricName: 'ToolFailures',
      filterPattern: logs.FilterPattern.stringValue('$.result', '=', 'FAILURE'),
      metricValue: '1',
    });
    const policyDenials = new logs.MetricFilter(this, 'PolicyDenialFilter', {
      logGroup: toolsAdapterLogs,
      metricNamespace: 'Themis',
      metricName: 'PolicyDenials',
      filterPattern: logs.FilterPattern.stringValue('$.policyOutcome', '=', 'DENY'),
      metricValue: '1',
    });
    const humanReviewRequired = new logs.MetricFilter(this, 'HumanReviewRequiredFilter', {
      logGroup: toolsAdapterLogs,
      metricNamespace: 'Themis',
      metricName: 'HumanReviewRequired',
      filterPattern: logs.FilterPattern.stringValue('$.policyOutcome', '=', 'REQUIRE_HUMAN_REVIEW'),
      metricValue: '1',
    });

    const toolsAdapterErrors = agent.toolsAdapterFunction.metricErrors({ period: cdk.Duration.minutes(5) });
    const normalizerErrors = messaging.normalizerFunction.metricErrors({ period: cdk.Duration.minutes(5) });

    new cloudwatch.Alarm(this, 'ToolsAdapterErrorsAlarm', {
      alarmDescription: 'Tool adapter Lambda is erroring (message handling / tool failures)',
      metric: toolsAdapterErrors,
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'NormalizerErrorsAlarm', {
      alarmDescription: 'Inbound message normalizer Lambda is erroring',
      metric: normalizerErrors,
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'Themis',
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda errors',
        left: [toolsAdapterErrors, normalizerErrors],
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda invocations',
        left: [agent.toolsAdapterFunction.metricInvocations(), messaging.normalizerFunction.metricInvocations()],
      }),
      new cloudwatch.GraphWidget({
        title: 'Tool failures / policy denials / human review',
        left: [
          toolFailures.metric({ statistic: 'Sum' }),
          policyDenials.metric({ statistic: 'Sum' }),
          humanReviewRequired.metric({ statistic: 'Sum' }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Inbound messaging volume',
        left: [messaging.inboundTopic.metricNumberOfMessagesPublished(), messaging.inboundTopic.metricNumberOfNotificationsFailed()],
      }),
    );

    new cdk.CfnOutput(this, 'DashboardName', { value: dashboard.dashboardName });
  }
}
