import { InboundMessageSchema, type InboundMessage } from '../../../packages/contracts/src/index.ts';

export interface AgentRuntimeRequest {
  readonly agentRuntimeArn: string;
  readonly runtimeSessionId: string;
  readonly contentType: 'application/json';
  readonly accept: 'application/json';
  readonly payload: Uint8Array;
  readonly qualifier?: string;
}

export interface AgentRuntimeClient {
  invokeAgentRuntime(request: AgentRuntimeRequest): Promise<unknown>;
}

export class AgentRuntimeInvocationError extends Error {
  readonly messageId: string;
  constructor(messageId: string, options?: ErrorOptions) {
    super(`AgentCore runtime invocation failed for inbound message ${messageId}`, options);
    this.messageId = messageId;
  }
}

async function runtimeSessionId(customerExternalId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(customerExternalId));
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `themis-${hex}`;
}

export class AgentRuntimeConsumer {
  private readonly agentRuntimeArn: string;
  private readonly client: AgentRuntimeClient;
  private readonly qualifier?: string;
  constructor(
    agentRuntimeArn: string,
    client: AgentRuntimeClient,
    qualifier?: string,
  ) {
    if (!agentRuntimeArn.trim()) throw new Error('Missing AgentCore runtime ARN');
    this.agentRuntimeArn = agentRuntimeArn;
    this.client = client;
    this.qualifier = qualifier;
  }

  async consume(message: InboundMessage): Promise<void> {
    const validated = InboundMessageSchema.parse(message);
    try {
      await this.client.invokeAgentRuntime({
        agentRuntimeArn: this.agentRuntimeArn,
        runtimeSessionId: await runtimeSessionId(validated.customerExternalId),
        contentType: 'application/json',
        accept: 'application/json',
        payload: new TextEncoder().encode(JSON.stringify(validated)),
        ...(this.qualifier ? { qualifier: this.qualifier } : {}),
      });
    } catch (cause) {
      // Invocation failures are ambiguous. The caller retains its admission claim
      // and surfaces the failure rather than replaying a possibly-completed action.
      throw new AgentRuntimeInvocationError(validated.messageId, { cause });
    }
  }
}
