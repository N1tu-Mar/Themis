// Gateway tool definitions for the AgentCore Gateway target that fronts the
// Lambda tools adapter. Names and parameter shapes are derived directly from
// the AGENT TOOL SURFACE list (prompt.md #11) and the field names already
// locked in packages/contracts/src/index.ts, so the Gateway's tool contract
// stays in sync with the shared schemas instead of inventing a parallel one.
//
// Schemas are intentionally flat (matches TOOL DESIGN STANDARD, prompt.md
// #12: compact structured JSON, not full resource validation - the Lambda
// adapter still validates with the real Pydantic/Zod models). If bank-tools
// or agentcore change a tool's parameters, update this file in the same PR.

export interface ToolParam {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean' | 'array';
  readonly required?: boolean;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly params: readonly ToolParam[];
}

const str = (name: string, required = true): ToolParam => ({ name, type: 'string', required });
const num = (name: string, required = true): ToolParam => ({ name, type: 'number', required });
const arr = (name: string, required = false): ToolParam => ({ name, type: 'array', required });
const bool = (name: string, required = false): ToolParam => ({ name, type: 'boolean', required });

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  { name: 'search_transactions', description: 'Search a customer\'s transactions by optional free-text query.', params: [str('customerId'), str('query', false)] },
  { name: 'get_transaction_details', description: 'Fetch one transaction by id.', params: [str('transactionId')] },
  { name: 'get_transaction_auth_signals', description: 'Fetch authentication signals (CVV/AVS/3DS/device) for one transaction.', params: [str('transactionId')] },
  { name: 'find_related_transactions', description: 'Find transactions related to a given transaction (same merchant/recurring series).', params: [str('transactionId')] },
  { name: 'get_customer_dispute_history', description: 'List a customer\'s prior dispute cases.', params: [str('customerId')] },
  { name: 'resolve_merchant', description: 'Resolve a raw merchant descriptor to a canonical merchant record.', params: [str('descriptor')] },
  { name: 'get_merchant_profile', description: 'Fetch a merchant\'s profile including billing patterns and case statistics.', params: [str('merchantId')] },
  { name: 'get_merchant_risk_signals', description: 'Fetch a merchant\'s active risk signals.', params: [str('merchantId')] },
  { name: 'get_case', description: 'Fetch one case by id.', params: [str('caseId')] },
  { name: 'create_case', description: 'Create a new dispute case for a customer.', params: [str('customerId'), str('claimType'), arr('transactionIds')] },
  { name: 'update_case', description: 'Update mutable fields on an existing case.', params: [str('caseId'), str('status', false), str('claimType', false), str('merchantId', false), num('confidence', false), bool('requiresHumanReview', false)] },
  { name: 'save_evidence', description: 'Attach a structured evidence record to a case.', params: [str('caseId'), str('category'), str('type'), str('claim'), str('source'), str('reliability')] },
  { name: 'generate_case_report', description: 'Generate and persist the customer-facing case report.', params: [str('caseId')] },
  { name: 'propose_payment_block', description: 'Propose blocking future recurring payments to a merchant. Policy-gated.', params: [str('caseId'), str('merchantId')] },
  { name: 'propose_card_replacement', description: 'Propose replacing the customer\'s card. Policy-gated.', params: [str('caseId')] },
  { name: 'propose_dispute_creation', description: 'Propose formally disputing one or more transactions. Policy-gated.', params: [str('caseId'), arr('transactionIds')] },
  { name: 'propose_provisional_credit', description: 'Propose issuing a provisional credit. Policy-gated on amount.', params: [str('caseId'), num('amount')] },
  { name: 'escalate_case', description: 'Escalate a case to human review.', params: [str('caseId'), str('reason')] },
  { name: 'send_customer_message', description: 'Send an RCS/SMS message to the customer.', params: [str('caseId'), str('channel'), str('text')] },
  { name: 'send_case_email', description: 'Send a transactional case-summary email via SES.', params: [str('caseId'), str('subject', false)] },
];
