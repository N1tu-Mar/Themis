import { parseSuggestions, type Choice } from './choices.ts';
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
  /** Resolves with the runtime's parsed JSON response body (`{reply, status, caseId}`), when it returned one. */
  invokeAgentRuntime(request: AgentRuntimeRequest): Promise<unknown>;
}

export interface AgentReply {
  readonly reply: string;
  readonly status: string;
  readonly caseId: string | null;
  readonly suggestions?: readonly Choice[];
}

function parseReply(output: unknown): AgentReply | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const { reply, status, caseId, suggestions } = output as Record<string, unknown>;
  if (typeof reply !== 'string' || !reply.trim()) return undefined;
  // Bad suggestions are dropped, never the reply: the runtime has already acted and the customer needs the text.
  let choices: Choice[] | undefined;
  try { choices = suggestions === undefined || suggestions === null ? undefined : parseSuggestions(suggestions); } catch { /* text-only */ }
  return { reply, status: typeof status === 'string' ? status : 'UNKNOWN', caseId: typeof caseId === 'string' && caseId ? caseId : null,
    ...(choices ? { suggestions: choices } : {}) };
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

  async consume(message: InboundMessage): Promise<AgentReply | undefined> {
    const validated = InboundMessageSchema.parse(message);
    try {
      return parseReply(await this.client.invokeAgentRuntime({
        agentRuntimeArn: this.agentRuntimeArn,
        runtimeSessionId: await runtimeSessionId(validated.customerExternalId),
        contentType: 'application/json',
        accept: 'application/json',
        payload: new TextEncoder().encode(JSON.stringify(validated)),
        ...(this.qualifier ? { qualifier: this.qualifier } : {}),
      }));
    } catch (cause) {
      // Invocation failures are ambiguous. The caller retains its admission claim
      // and surfaces the failure rather than replaying a possibly-completed action.
      throw new AgentRuntimeInvocationError(validated.messageId, { cause });
    }
  }
}
