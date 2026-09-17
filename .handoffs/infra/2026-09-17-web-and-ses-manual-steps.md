# Manual AWS-side steps: dashboard hosting + SES

From: infra (`agent/infra/aws`)
To: frontend, integration

## Dashboard (Amplify Hosting)

`infra/stacks/web-stack.ts` provisions an `AWS::Amplify::App`
(`themis-dashboard`) and a `main` branch, but does not connect a GitHub
repository - that requires an interactive OAuth/GitHub App authorization that
can't be embedded in CDK code without committing a credential (prompt.md
#47). One-time step after `cdk deploy`:

1. Amplify console -> `themis-dashboard` -> connect the GitHub repo, branch
   `main`, app root `apps/dashboard`.
2. Or skip repo auto-build entirely and `aws amplify start-deployment` with a
   built `apps/dashboard` zip for a one-off demo deploy.

Stack outputs `AmplifyAppId` / `AmplifyDefaultDomain` are available once
deployed.

## SES sender identity

`ENABLE_SES=true` by default (`infra/config/env.ts`). The tools-adapter
Lambda's IAM role only allows `ses:SendEmail`/`ses:SendRawEmail` for
`identity/${SES_SENDER_DOMAIN}` (`SES_SENDER_DOMAIN` env var, default
`themis-demo.example` - override via deploy-time env, no address is
hardcoded per prompt.md #47). Before any real email can send:

1. SES console -> verify the domain or a specific sender address matching
   whatever `SES_SENDER_DOMAIN` is set to at deploy time.
2. If the account is still in the SES sandbox, also verify each recipient
   address used in the demo.

Until this is done, and during automated tests, `send_case_email` should
fail closed (mark delivery pending/failed per prompt.md #46) rather than
error the whole case - that's the tools-adapter's responsibility, not
infra's.
