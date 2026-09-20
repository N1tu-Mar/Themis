import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  type DeleteItemCommandInput,
  type GetItemCommandInput,
  type PutItemCommandInput,
  type UpdateItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  type InvokeAgentRuntimeCommandInput,
} from '@aws-sdk/client-bedrock-agentcore';
import { createMessagingRuntime } from './composition.ts';

const dynamoSdk = new DynamoDBClient({});
// An AgentCore timeout is ambiguous: the runtime may already have performed
// side effects. Disable SDK retries and let the durable admission claim remain.
const agentRuntimeSdk = new BedrockAgentCoreClient({ maxAttempts: 1 });

const runtime = createMessagingRuntime(process.env, {
  dynamo: {
    getItem: payload => dynamoSdk.send(new GetItemCommand(payload as unknown as GetItemCommandInput)),
    putItem: payload => dynamoSdk.send(new PutItemCommand(payload as unknown as PutItemCommandInput)),
    updateItem: payload => dynamoSdk.send(new UpdateItemCommand(payload as unknown as UpdateItemCommandInput)),
    deleteItem: payload => dynamoSdk.send(new DeleteItemCommand(payload as unknown as DeleteItemCommandInput)),
  },
  agentRuntime: {
    invokeAgentRuntime: async (request) => {
      const output = await agentRuntimeSdk.send(
        new InvokeAgentRuntimeCommand(request as InvokeAgentRuntimeCommandInput),
      );
      // Drain the streaming response so a mid-stream runtime failure is observed
      // before the admission claim is marked complete and the socket is released.
      await output.response?.transformToByteArray();
      if (output.statusCode !== undefined && (output.statusCode < 200 || output.statusCode >= 300)) {
        throw new Error(`AgentCore runtime returned HTTP ${output.statusCode}`);
      }
      return output;
    },
  },
});

/** AWS Lambda handler exported by dist/index.mjs. */
export const handler = runtime.handler;
