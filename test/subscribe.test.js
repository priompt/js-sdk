const test = require("node:test");
const assert = require("node:assert");
const { PromptClient } = require("../client");
const { startFakeNats } = require("./fake-nats");
const pkg = require("../package.json");

test("depends on @nats-io/transport-node, not the deprecated nats package", () => {
  const all = { ...pkg.dependencies, ...pkg.optionalDependencies };
  assert.ok(!("nats" in all), "the `nats` package is deprecated");
  assert.ok("@nats-io/transport-node" in pkg.optionalDependencies);
});

test("subscribe delivers version and classification", async (t) => {
  const broker = await startFakeNats({ token: "s3cret" });
  t.after(() => broker.close());
  const client = new PromptClient({ host: "localhost:1", natsUrl: broker.url.replace("nats://", "nats://s3cret@") });
  t.after(() => client.close());

  const got = new Promise((resolve) => {
    client.subscribe("priompt://acme/support/agent", (version, classification) => resolve({ version, classification }))
      .then((nc) => {
        t.after(() => nc.close());
        return nc.flush(); // SUB has reached the broker
      })
      .then(() => broker.publish("priompt.acme.support.agent", JSON.stringify({ version: "abc123", classification: "minor edit" })));
  });
  assert.deepStrictEqual(await got, { version: "abc123", classification: "minor edit" });
});
