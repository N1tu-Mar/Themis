import { DynamoActiveMenuStore, type ActiveMenuDynamoClient } from './active-menu.ts';
import { DynamoIdempotencyStore, type DynamoClient } from './idempotency.ts';
import { createSnsHandler, InboundProcessor, type Channel } from './inbound.ts';
import { AgentRuntimeConsumer, type AgentRuntimeClient } from './runtime.ts';
import { ChannelAdapter, type MessagingClient } from './outbound.ts';
import { SesAdapter, type SesClient } from './email.ts';
import { OutboundMessageSchema } from '../../../packages/contracts/src/index.ts';

export interface RuntimeEnvironment {
  readonly idempotencyTable: string;
  readonly activeMenuTable: string;
  readonly agentRuntimeArn: string;
  readonly agentRuntimeQualifier?: string;
  readonly topics: Readonly<Record<string, Channel>>;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function enabled(env: Record<string, string | undefined>, name: string): boolean {
  const value = required(env, name);
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`);
  return value === 'true';
}

function topicArn(value: string, name: string): string {
  if (!/^arn:(?:aws|aws-us-gov|aws-cn):sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

export function parseRuntimeEnvironment(env: Record<string, string | undefined>): RuntimeEnvironment {
  if (required(env, 'THEMIS_MODE') !== 'aws') throw new Error('THEMIS_MODE must be aws for the Lambda runtime');
  const enableRcs = enabled(env, 'ENABLE_RCS');
  const enableSms = enabled(env, 'ENABLE_SMS_FALLBACK');
  if (!enableRcs && !enableSms) throw new Error('At least one inbound messaging channel must be enabled');

  const topics: Record<string, Channel> = {};
  if (enableRcs) topics[topicArn(required(env, 'THEMIS_RCS_TOPIC_ARN'), 'THEMIS_RCS_TOPIC_ARN')] = 'RCS';
  if (enableSms) {
    const arn = topicArn(required(env, 'THEMIS_SMS_TOPIC_ARN'), 'THEMIS_SMS_TOPIC_ARN');
    if (topics[arn]) throw new Error('RCS and SMS inbound topic ARNs must be distinct');
    topics[arn] = 'SMS';
  }

  const idempotencyTable = required(env, 'IDEMPOTENCY_TABLE');
  const agentRuntimeArn = required(env, 'AGENT_RUNTIME_ARN');
  if (!/^arn:(?:aws|aws-us-gov|aws-cn):bedrock-agentcore:[a-z0-9-]+:\d{12}:runtime\/[A-Za-z0-9_-]+$/.test(agentRuntimeArn)) {
    throw new Error('Invalid AGENT_RUNTIME_ARN');
  }
  const qualifier = env.AGENT_RUNTIME_QUALIFIER?.trim();
  return Object.freeze({
    idempotencyTable,
    activeMenuTable: env.ACTIVE_MENU_TABLE?.trim() || idempotencyTable,
    agentRuntimeArn,
    ...(qualifier ? { agentRuntimeQualifier: qualifier } : {}),
    topics: Object.freeze(topics),
  });
}

export interface RuntimeDynamoClient extends DynamoClient, ActiveMenuDynamoClient {}

export interface RuntimeDependencies {
  readonly dynamo: RuntimeDynamoClient;
  readonly agentRuntime: AgentRuntimeClient;
  /** Outbound delivery. Without `messagingClient` the agent's reply is not sent (inbound-only composition). */
  readonly messagingClient?: MessagingClient;
  readonly sesClient?: SesClient;
}

type ToolEvent = { readonly themisTool?: unknown; readonly [key: string]: unknown };

export function createMessagingRuntime(env: Record<string, string | undefined>, dependencies: RuntimeDependencies) {
  const config = parseRuntimeEnvironment(env);
  const activeMenus = new DynamoActiveMenuStore(config.activeMenuTable, dependencies.dynamo);
  const runtime = new AgentRuntimeConsumer(
    config.agentRuntimeArn,
    dependencies.agentRuntime,
    config.agentRuntimeQualifier,
  );
  const channel = dependencies.messagingClient
    ? new ChannelAdapter({ mode: 'aws', rcsIdentity: required(env, 'THEMIS_RCS_POOL_ID'), smsIdentity: required(env, 'THEMIS_SMS_IDENTITY') },
      dependencies.messagingClient)
    : undefined;
  const email = dependencies.sesClient ? new SesAdapter('aws', dependencies.sesClient) : undefined;
  const processor = new InboundProcessor(
    new DynamoIdempotencyStore(config.idempotencyTable, dependencies.dynamo),
    async (message) => {
      const answer = await runtime.consume(message);
      // Replies are sent after admission is claimed: a failed send is surfaced, never replayed into AgentCore.
      if (answer && channel && message.channel !== 'EMAIL') {
        await channel.send(OutboundMessageSchema.parse({
          channel: message.channel, customerExternalId: message.customerExternalId,
          messageId: `reply:${message.messageId}`, caseId: answer.caseId ?? 'no-case-yet', text: answer.reply,
        }));
      }
    },
  );
  const snsHandler = createSnsHandler({
    topics: config.topics,
    processor,
    choicesFor: async customerExternalId => (await activeMenus.get(customerExternalId))?.choices ?? [],
  });
  // Tools-adapter Lambda invokes this function directly ({themisTool, ...}) for send_customer_message / send_case_email.
  const handleTool = async (event: ToolEvent) => {
    if (event.themisTool === 'send_customer_message' && channel) {
      return { messageId: await channel.send(OutboundMessageSchema.parse(event.message)) };
    }
    if (event.themisTool === 'send_case_email' && email) {
      return { messageId: await email.send({
        case: event.case as never, report: event.report as never, recipient: String(event.recipient),
        nextSteps: event.nextSteps as string[], sender: required(env, 'THEMIS_SES_FROM'), support: required(env, 'THEMIS_SUPPORT') }) };
    }
    throw new Error('Unsupported tool event');
  };
  const handler = (event: unknown) => (event && typeof event === 'object' && 'themisTool' in event)
    ? handleTool(event as ToolEvent) : snsHandler(event);
  return Object.freeze({ config, handler, activeMenus });
}
