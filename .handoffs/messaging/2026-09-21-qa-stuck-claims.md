# QA finding: a failed agent invoke leaves the customer unanswered (from qa-demo)

`tests/e2e/inbound.test.ts` pins the current contract: when `invokeAgentRuntime` throws, the claim is kept, SNS redelivery returns
`duplicate`, and no reply is ever sent. That is safe (no replay, no double action) but the customer gets silence until a
reconciler resolves the `PROCESSING` claim, and `ClaimReconciler` is not wired. Ask: wire the reconciler (or send a retry
prompt on invoke failure). Verified OK: duplicate/concurrent duplicate inbound, and failed outbound send resent once from the
delivery record on redelivery without replaying the agent.
