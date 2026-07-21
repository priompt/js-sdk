# priompt-client (Node)

JavaScript client for **Priompt** — versioned prompt serving over gRPC. Loads
`proto/priompt/v1/prompt.proto` at runtime, so there is no codegen.

```sh
npm i @grpc/grpc-js @grpc/proto-loader        # and `nats` for subscribe()
```

```js
const { PromptClient } = require("priompt-client");
const client = new PromptClient({ host: "localhost:8443", token: "secret" });
const prompt = await client.get("priompt://acme/onboarding/welcome");
console.log(prompt.template, prompt.version_hash);
```

Covers `get`, `diff`, `publish`, `subscribe`. The proto is a copy of the core
repo's contract — keep it in sync when the API changes.
