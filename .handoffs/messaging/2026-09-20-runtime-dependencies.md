# Request: install messaging runtime dependencies at the root

From: messaging (`agent/messaging/runtime-composition`)
To: integration

`services/messaging/package.json` now declares:

- `@aws-sdk/client-dynamodb`
- `@aws-sdk/client-bedrock-agentcore`
- build-only TypeScript, Node types, and esbuild versions already used by the repo

Please run `npm install` from the repository root and commit the resulting root
`package-lock.json` change. Messaging ownership excludes the root lockfile, so it
was deliberately not edited here. Local verification used a no-lock install.

Then verify:

```sh
npm --prefix services/messaging run build
npm --prefix services/messaging test
```

The build bundles all runtime dependencies into `services/messaging/dist/index.mjs`.
