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
import { SESv2Client, SendEmailCommand, type SendEmailCommandInput } from '@aws-sdk/client-sesv2';
import {
  PinpointSMSVoiceV2Client,
  SendRcsMessageCommand,
  SendTextMessageCommand,
  type SendRcsMessageCommandInput,
  type SendTextMessageCommandInput,
} from '@aws-sdk/client-pinpoint-sms-voice-v2';
import { createMessagingRuntime } from './composition.ts';

const dynamoSdk = new DynamoDBClient({});
// An AgentCore timeout is ambiguous: the runtime may already have performed
// side effects. Disable SDK retries and let the durable admission claim remain.
const agentRuntimeSdk = new BedrockAgentCoreClient({ maxAttempts: 1 });
const smsVoice = new PinpointSMSVoiceV2Client({});
const sesV2 = new SESv2Client({});

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
      const body = await output.response?.transformToByteArray();
      if (output.statusCode !== undefined && (output.statusCode < 200 || output.statusCode >= 300)) {
        throw new Error(`AgentCore runtime returned HTTP ${output.statusCode}`);
      }
      try { return body ? JSON.parse(new TextDecoder().decode(body)) : undefined; } catch { return undefined; }
    },
  },
  messagingClient: {
    sendTextMessage: input => smsVoice.send(new SendTextMessageCommand(input as unknown as SendTextMessageCommandInput)),
    sendRcsMessage: input => smsVoice.send(new SendRcsMessageCommand(input as unknown as SendRcsMessageCommandInput)),
  },
  sesClient: { sendEmail: input => sesV2.send(new SendEmailCommand(input as unknown as SendEmailCommandInput)) },
});

/** AWS Lambda handler exported by dist/index.mjs. */
export const handler = runtime.handler;
