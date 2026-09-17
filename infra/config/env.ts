// Deployment-time configuration. Values come from process.env (shell / CI) so the
// same infra/** code works for every environment without editing source.
// Application code reads its own copy of these flags from Lambda/Runtime
// environment variables wired below - this file is the single source infra uses
// to populate those environment variables consistently across stacks.

export type ThemisMode = 'local' | 'aws';

export interface ThemisConfig {
  readonly themisMode: ThemisMode;
  readonly region: string;
  readonly account?: string;
  readonly enableRcs: boolean;
  readonly enableSmsFallback: boolean;
  readonly enableSes: boolean;
  readonly enableBrowserResearch: boolean;
  readonly enableProactiveDetection: boolean;
  readonly bedrockModelIdFast: string;
  readonly bedrockModelIdReasoning: string;
  readonly sesSenderDomain: string;
  readonly provisionalCreditAutoApproveLimit: number;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function loadConfig(): ThemisConfig {
  const themisMode = (process.env.THEMIS_MODE as ThemisMode) ?? 'local';

  // No hardcoded default: the exact Bedrock model ID/ARN to use is a product
  // decision for the agentcore workstream, and Bedrock model IDs change over
  // time. AWS-mode deploys must set these explicitly; local mode does not call
  // Bedrock, so a placeholder is fine there.
  const requireForAwsMode = (raw: string | undefined, name: string): string => {
    if (raw) return raw;
    if (themisMode === 'aws') {
      throw new Error(`${name} must be set when THEMIS_MODE=aws (see infra/config/env.ts)`);
    }
    return `unset-${name.toLowerCase()}`;
  };

  return {
    themisMode,
    region: process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
    account: process.env.CDK_DEFAULT_ACCOUNT,
    enableRcs: bool('ENABLE_RCS', false),
    enableSmsFallback: bool('ENABLE_SMS_FALLBACK', true),
    enableSes: bool('ENABLE_SES', true),
    enableBrowserResearch: bool('ENABLE_BROWSER_RESEARCH', false),
    enableProactiveDetection: bool('ENABLE_PROACTIVE_DETECTION', false),
    bedrockModelIdFast: requireForAwsMode(process.env.BEDROCK_MODEL_ID_FAST, 'BEDROCK_MODEL_ID_FAST'),
    bedrockModelIdReasoning: requireForAwsMode(process.env.BEDROCK_MODEL_ID_REASONING, 'BEDROCK_MODEL_ID_REASONING'),
    sesSenderDomain: process.env.SES_SENDER_DOMAIN ?? 'themis-demo.example',
    provisionalCreditAutoApproveLimit: Number(process.env.PROVISIONAL_CREDIT_AUTO_APPROVE_LIMIT ?? '50'),
  };
}
