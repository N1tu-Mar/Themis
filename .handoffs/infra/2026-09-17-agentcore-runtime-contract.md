# Request: implement the AgentCore Runtime entry point

From: infra (`agent/infra/aws`)
To: agentcore

## What infra provisioned

`AWS::BedrockAgentCore::Runtime` named `ThemisOrchestrator`
(`infra/stacks/agent-stack.ts`), packaged from an S3 asset built by zipping
`services/agent/` at synth time (via `aws-cdk-lib/aws-s3-assets`). Whatever
is in that directory when someone runs `cdk deploy` is what ships - infra
does not write to `services/agent/**`.

## Entry point contract the Runtime config expects

```
entryPoint: ["python3", "src/orchestrator/main.py"]
runtime:    "PYTHON_3_12"   # unverified enum value - see caveat below
```

So `services/agent/src/orchestrator/main.py` must exist and be runnable as
`python3 src/orchestrator/main.py` from the root of the zipped
`services/agent/` directory.

Environment variables the Runtime receives (read via `os.environ`):

```
THEMIS_MODE, ENABLE_PROACTIVE_DETECTION, ENABLE_BROWSER_RESEARCH
BEDROCK_MODEL_ID_FAST, BEDROCK_MODEL_ID_REASONING
GATEWAY_IDENTIFIER, GATEWAY_URL, MEMORY_ID
```

IAM already granted to the Runtime's role: `bedrock:InvokeModel` /
`InvokeModelWithResponseStream` scoped to the two configured model ARNs,
`bedrock-agentcore:InvokeGateway` scoped to the Gateway, Memory
read/write/list scoped to the Memory resource, and (only when
`ENABLE_BROWSER_RESEARCH=true`) the AWS-managed default Browser tool's
Start/StopBrowserSession actions. Call the Gateway for tools, not DynamoDB/S3
directly - the tools adapter Lambda behind the Gateway is what's allowed to
touch the data tier (see the tools-adapter handoff).

## Verify before first deploy (new-service caveat)

`runtime: "PYTHON_3_12"` and `authorizerType: "AWS_IAM"` on the Gateway are
infra's best-documented values for a CloudFormation surface
(`AWS::BedrockAgentCore::*`) that GA'd very recently. `cdk synth` type-checks
fine against the installed `aws-cdk-lib` version but does not validate these
enum strings against the live service. If `cdk deploy` rejects either value,
fix it in `infra/stacks/agent-stack.ts` (it's a one-line change) and let
infra know what the correct value was so the comment gets updated.
