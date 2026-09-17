#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { loadConfig } from '../config/env';
import { DataStack } from '../stacks/data-stack';
import { MessagingStack } from '../stacks/messaging-stack';
import { AgentStack } from '../stacks/agent-stack';
import { ObservabilityStack } from '../stacks/observability-stack';
import { WebStack } from '../stacks/web-stack';

const app = new cdk.App();
const config = loadConfig();
const env: cdk.Environment = { account: config.account, region: config.region };
const tags = { project: 'themis', mode: config.themisMode };

const data = new DataStack(app, 'ThemisData', { env, tags, config });
const agent = new AgentStack(app, 'ThemisAgent', { env, tags, config, data });
const messaging = new MessagingStack(app, 'ThemisMessaging', { env, tags, config, data, agent });
new ObservabilityStack(app, 'ThemisObservability', { env, tags, agent, messaging });
new WebStack(app, 'ThemisWeb', { env, tags, config, data });
