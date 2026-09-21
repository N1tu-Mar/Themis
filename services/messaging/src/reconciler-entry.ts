import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { PinpointSMSVoiceV2Client, SendRcsMessageCommand, SendTextMessageCommand } from '@aws-sdk/client-pinpoint-sms-voice-v2';
import { randomUUID } from 'node:crypto';
import { createReconciler } from './reconciler.ts';

const dynamoSdk = new DynamoDBClient({});
const smsVoice = new PinpointSMSVoiceV2Client({});
type Input<T> = T extends new (input: infer I) => unknown ? I : never;

// Scheduled (EventBridge) entry. The owner id is per invocation: a crashed run's lease simply expires.
export const handler = () => createReconciler(process.env, {
  owner: randomUUID(),
  dynamo: {
    getItem: p => dynamoSdk.send(new GetItemCommand(p as unknown as Input<typeof GetItemCommand>)),
    putItem: p => dynamoSdk.send(new PutItemCommand(p as unknown as Input<typeof PutItemCommand>)),
    updateItem: p => dynamoSdk.send(new UpdateItemCommand(p as unknown as Input<typeof UpdateItemCommand>)),
    query: p => dynamoSdk.send(new QueryCommand(p as unknown as Input<typeof QueryCommand>)),
    // Present only to satisfy the menu store type; the reconciler role has no dynamodb:DeleteItem and never sends menus.
    deleteItem: p => dynamoSdk.send(new DeleteItemCommand(p as unknown as Input<typeof DeleteItemCommand>)),
  },
  messagingClient: {
    sendTextMessage: p => smsVoice.send(new SendTextMessageCommand(p as unknown as Input<typeof SendTextMessageCommand>)),
    sendRcsMessage: p => smsVoice.send(new SendRcsMessageCommand(p as unknown as Input<typeof SendRcsMessageCommand>)),
  },
}).run();
