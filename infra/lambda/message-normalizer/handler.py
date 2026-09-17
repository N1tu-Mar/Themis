"""Placeholder inbound-message normalizer Lambda, subscribed to the
ThemisInboundMessaging SNS topic.

Infra owns this file only as a bootstrap so `cdk deploy` produces a working
subscriber before the real normalizer lands. Replace per
.handoffs/infra/messaging-lambda-contract.md - infra does not implement
channel-specific parsing logic.

Responsibilities the real implementation must keep:
- Idempotency: check/write THEMIS_IDEMPOTENCY_TABLE keyed on the inbound
  provider message id before invoking the agent runtime (prompt.md #31).
- Normalize RCS/SMS payloads into the InboundMessage shape from
  packages/contracts (channel, customerExternalId, messageId, text, postback,
  receivedAt).
- Invoke the AgentCore Runtime (THEMIS_AGENT_RUNTIME_ARN) with the normalized
  message; never call Bedrock directly from here.
"""
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    for record in event.get("Records", []):
        sns = record.get("Sns", {})
        logger.info(json.dumps({
            "status": "not_implemented",
            "message": "Message normalizer placeholder - see .handoffs/infra/messaging-lambda-contract.md",
            "snsMessageId": sns.get("MessageId"),
        }))
    return {"status": "not_implemented"}
