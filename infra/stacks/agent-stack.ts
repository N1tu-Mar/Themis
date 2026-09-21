import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';
import type { ThemisConfig } from '../config/env';
import { TOOL_DEFINITIONS } from '../config/tool-schemas';
import type { DataStack } from './data-stack';

/** Fixed so the tools adapter can address messaging without a CloudFormation dependency cycle (messaging depends on this stack). */
export const MESSAGING_FUNCTION_NAME = 'ThemisMessageNormalizer';

export interface AgentStackProps extends cdk.StackProps {
  readonly config: ThemisConfig;
  readonly data: DataStack;
}

/**
 * The agent/tools layer: one Lambda exposing the full tool surface, an
 * AgentCore Gateway target wired to it, AgentCore Memory for conversational
 * continuity, an AgentCore Policy Engine gating the money/account-impacting
 * tools, and the AgentCore Runtime that hosts the Themis orchestrator.
 *
 * Deliberately NOT provisioned: AgentCore WorkloadIdentity / OAuth credential
 * providers (all tools are internal - the Gateway invokes the Lambda under
 * its own IAM role, no per-user OAuth needed) and a custom AgentCore Browser
 * resource (the MVP uses the AWS-managed default browser tool via IAM
 * permission on the runtime role, gated by ENABLE_BROWSER_RESEARCH - a custom
 * browser resource is only needed for custom network/certificate config,
 * which nothing here requires). Adding either would be a placeholder purely
 * to pad the architecture diagram.
 */
export class AgentStack extends cdk.Stack {
  public readonly toolsAdapterFunction: lambda.Function;
  public readonly toolsAdapterLogGroup: logs.LogGroup;
  public readonly gateway: bedrockagentcore.CfnGateway;
  public readonly runtime: bedrockagentcore.CfnRuntime;
  public readonly memory: bedrockagentcore.CfnMemory;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);
    const { config, data } = props;

    // ---- Tools adapter Lambda (Gateway target) --------------------------
    // Asset staged by scripts/build_assets.py: handler + router over bank_tools,
    // merchant_intel and the agent workflow services (see handler.py / router.py).
    const toolsAdapterRole = new iam.Role(this, 'ToolsAdapterRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for the AgentCore Gateway tool-adapter Lambda',
    });
    toolsAdapterRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );
    data.transactionsTable.grantReadWriteData(toolsAdapterRole);
    data.casesTable.grantReadWriteData(toolsAdapterRole);
    data.merchantsTable.grantReadWriteData(toolsAdapterRole);
    data.auditTable.grantReadWriteData(toolsAdapterRole);
    data.idempotencyTable.grantReadWriteData(toolsAdapterRole);
    data.artifactsBucket.grantReadWrite(toolsAdapterRole);
    // send_customer_message / send_case_email are executed by the messaging Lambda.
    toolsAdapterRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:${MESSAGING_FUNCTION_NAME}`],
    }));
    this.toolsAdapterLogGroup = new logs.LogGroup(this, 'ToolsAdapterLogGroup', {
      logGroupName: '/aws/lambda/ThemisToolsAdapter',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.toolsAdapterFunction = new lambda.Function(this, 'ToolsAdapterFunction', {
      functionName: 'ThemisToolsAdapter',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../build/tools-adapter')),
      role: toolsAdapterRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: this.toolsAdapterLogGroup,
      environment: {
        THEMIS_MODE: 'aws',
        TRANSACTIONS_TABLE: data.transactionsTable.tableName,
        CASES_TABLE: data.casesTable.tableName,
        MERCHANTS_TABLE: data.merchantsTable.tableName,
        AUDIT_TABLE: data.auditTable.tableName,
        IDEMPOTENCY_TABLE: data.idempotencyTable.tableName,
        ARTIFACTS_BUCKET: data.artifactsBucket.bucketName,
        MESSAGING_FUNCTION_NAME,
        SES_SENDER_DOMAIN: config.sesSenderDomain,
        ENABLE_SES: String(config.enableSes),
        DEMO_AUTONOMOUS_CREDIT_LIMIT: String(config.provisionalCreditAutoApproveLimit),
        DEMO_CREDIT_CONFIDENCE_THRESHOLD: String(config.creditConfidenceThreshold),
      },
    });

    // ---- Gateway ----------------------------------------------------------
    const gatewayRole = new iam.Role(this, 'GatewayRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Assumed by the AgentCore Gateway to invoke the tools adapter Lambda',
    });
    this.toolsAdapterFunction.grantInvoke(gatewayRole);

    // ---- Policy engine + policies ------------------------------------
    const policyEngine = new bedrockagentcore.CfnPolicyEngine(this, 'PolicyEngine', {
      name: 'ThemisPolicyEngine',
      description: 'Deterministic Cedar gate for financial/account-impacting tool calls (prompt.md #24)',
    });

    const financialActionsCedar = fs
      .readFileSync(path.join(__dirname, '../../policies/financial-actions.cedar'), 'utf-8')
      .replace('__DEMO_AUTONOMOUS_CREDIT_LIMIT__', String(config.provisionalCreditAutoApproveLimit))
      .replace('__DEMO_CREDIT_CONFIDENCE_THRESHOLD__', String(config.creditConfidenceThreshold));
    new bedrockagentcore.CfnPolicy(this, 'FinancialActionsPolicy', {
      name: 'FinancialActions',
      policyEngineId: policyEngine.attrPolicyEngineId,
      description: 'Gates propose_payment_block / propose_card_replacement / propose_dispute_creation / propose_provisional_credit',
      definition: { cedar: { statement: financialActionsCedar } },
    });

    const denyArbitraryCedar = fs.readFileSync(path.join(__dirname, '../../policies/deny-arbitrary-actions.cedar'), 'utf-8');
    new bedrockagentcore.CfnPolicy(this, 'DenyArbitraryActionsPolicy', {
      name: 'DenyArbitraryActions',
      policyEngineId: policyEngine.attrPolicyEngineId,
      description: 'Explicit default-deny fallback for unrecognized actions',
      definition: { cedar: { statement: denyArbitraryCedar } },
    });

    this.gateway = new bedrockagentcore.CfnGateway(this, 'Gateway', {
      name: 'ThemisGateway',
      description: 'Exposes the Themis tool surface to the agent runtime',
      roleArn: gatewayRole.roleArn,
      // AWS_IAM: the Gateway is only ever called by our own Runtime (via its
      // IAM role below), not by end users directly, so no JWT/Cognito
      // authorizer is needed. Verify this value against current AgentCore
      // Gateway docs before first deploy (see infra/policies/README.md for
      // the same caveat about this being a very new CFN surface).
      authorizerType: 'AWS_IAM',
      protocolType: 'MCP',
      protocolConfiguration: { mcp: { supportedVersions: ['2025-03-26'] } },
      policyEngineConfiguration: { arn: policyEngine.attrPolicyEngineArn, mode: 'ENFORCE' },
    });

    new bedrockagentcore.CfnGatewayTarget(this, 'ToolsGatewayTarget', {
      gatewayIdentifier: this.gateway.attrGatewayIdentifier,
      name: 'themis-tools',
      description: 'AGENT TOOL SURFACE (prompt.md #11), backed by the tools adapter Lambda',
      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: this.toolsAdapterFunction.functionArn,
            toolSchema: {
              inlinePayload: TOOL_DEFINITIONS.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: {
                  type: 'object',
                  properties: Object.fromEntries(tool.params.map((p) => [p.name, {
                    type: p.type,
                    ...(p.minimum === undefined ? {} : { minimum: p.minimum }),
                    ...(p.maximum === undefined ? {} : { maximum: p.maximum }),
                    ...(p.items === undefined ? {} : { items: p.items }),
                  }])),
                  required: tool.params.filter((p) => p.required).map((p) => p.name),
                },
              })),
            },
          },
        },
      },
    });

    // ---- Memory -----------------------------------------------------------
    // Conversational continuity only (prompt.md #28) - DynamoDB above remains
    // the system of record for case/financial state. No memory strategies
    // configured: raw event storage is sufficient for the MVP and avoids the
    // extra Bedrock extraction calls (and cost) that strategies incur.
    this.memory = new bedrockagentcore.CfnMemory(this, 'Memory', {
      name: 'ThemisConversationMemory',
      description: 'Per-conversation continuity for the Themis orchestrator',
      eventExpiryDuration: 30,
    });

    // ---- Runtime ------------------------------------------------------
    const runtimeRole = new iam.Role(this, 'RuntimeRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Execution role for the AgentCore Runtime hosting the Themis orchestrator',
    });
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/${config.bedrockModelIdFast}`,
        `arn:aws:bedrock:${this.region}::foundation-model/${config.bedrockModelIdReasoning}`,
      ],
    }));
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock-agentcore:InvokeGateway'],
      resources: [this.gateway.attrGatewayArn],
    }));
    runtimeRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock-agentcore:GetEvent', 'bedrock-agentcore:CreateEvent', 'bedrock-agentcore:ListEvents', 'bedrock-agentcore:RetrieveMemoryRecords'],
      resources: [this.memory.attrMemoryArn],
    }));
    if (config.enableBrowserResearch) {
      // AWS-managed default Browser tool - no CfnBrowserCustom resource
      // needed (see class doc comment). Scoped to this account/region, not
      // "*", but the default browser has no per-resource ARN to narrow to
      // further until one is provisioned.
      runtimeRole.addToPolicy(new iam.PolicyStatement({
        actions: ['bedrock-agentcore:StartBrowserSession', 'bedrock-agentcore:StopBrowserSession'],
        resources: [`arn:aws:bedrock-agentcore:${this.region}:${this.account}:browser/aws.browser.v1`],
      }));
    }

    // Runtime code is staged by scripts/build_assets.py (src/orchestrator + customer directory);
    // `npm run package:aws` additionally vendors boto3 into it. See
    // .handoffs/infra/2026-09-17-agentcore-runtime-contract.md for the entry_point contract.
    const runtimeCodeAsset = new s3assets.Asset(this, 'RuntimeCodeAsset', {
      path: path.join(__dirname, '../../build/agent-runtime'),
    });

    this.runtime = new bedrockagentcore.CfnRuntime(this, 'Runtime', {
      agentRuntimeName: 'ThemisOrchestrator',
      description: 'Themis dispute-resolution orchestrator (prompt.md #10)',
      roleArn: runtimeRole.roleArn,
      agentRuntimeArtifact: {
        codeConfiguration: {
          code: { s3: { bucket: runtimeCodeAsset.s3BucketName, prefix: runtimeCodeAsset.s3ObjectKey } },
          entryPoint: ['python3', 'src/orchestrator/main.py'],
          // Verify against current AgentCore Runtime CFN enum before deploy
          // (same new-service caveat as authorizerType above).
          runtime: 'PYTHON_3_12',
        },
      },
      environmentVariables: {
        THEMIS_MODE: 'aws',
        THEMIS_STRUCTURED_TOOLS: 'true',
        ENABLE_PROACTIVE_DETECTION: String(config.enableProactiveDetection),
        ENABLE_BROWSER_RESEARCH: String(config.enableBrowserResearch),
        ENABLE_REASONING_ESCALATION: String(config.enableReasoningEscalation),
        BEDROCK_MODEL_ID_FAST: config.bedrockModelIdFast,
        BEDROCK_MODEL_ID_REASONING: config.bedrockModelIdReasoning,
        GATEWAY_IDENTIFIER: this.gateway.attrGatewayIdentifier,
        GATEWAY_URL: this.gateway.attrGatewayUrl,
        MEMORY_ID: this.memory.attrMemoryId,
      },
    });

    new cdk.CfnOutput(this, 'ToolsAdapterFunctionName', { value: this.toolsAdapterFunction.functionName });
    new cdk.CfnOutput(this, 'GatewayIdentifier', { value: this.gateway.attrGatewayIdentifier });
    new cdk.CfnOutput(this, 'GatewayUrl', { value: this.gateway.attrGatewayUrl });
    new cdk.CfnOutput(this, 'MemoryId', { value: this.memory.attrMemoryId });
    new cdk.CfnOutput(this, 'AgentRuntimeArn', { value: this.runtime.attrAgentRuntimeArn });
    new cdk.CfnOutput(this, 'PolicyEngineId', { value: policyEngine.attrPolicyEngineId });
  }
}
