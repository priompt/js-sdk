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

test("a throwing onChange or a malformed body does not crash the process", async (t) => {
  const broker = await startFakeNats({ token: "s3cret" });
  t.after(() => broker.close());
  const client = new PromptClient({ host: "localhost:1", natsUrl: broker.url.replace("nats://", "nats://s3cret@") });
  t.after(() => client.close());

  const errors = [];
  const seen = [];
  const done = new Promise((resolve) => {
    const onChange = async (version) => {
      seen.push(version);
      if (seen.length === 1) throw new Error("sync-ish handler bug");
      if (seen.length === 2) return Promise.reject(new Error("async handler bug"));
      if (seen.length === 4) resolve();
    };
    client.subscribe("priompt://acme/a", onChange, { onError: (err) => errors.push(err.message) })
      .then((nc) => {
        t.after(() => nc.close());
        return nc.flush();
      })
      .then(() => {
        broker.publish("priompt.acme.a", JSON.stringify({ version: "v1" }));
        broker.publish("priompt.acme.a", JSON.stringify({ version: "v2" }));
        broker.publish("priompt.acme.a", "null");
        broker.publish("priompt.acme.a", "12345678");
      });
  });
  await done;
  assert.deepStrictEqual(seen, ["v1", "v2", "null", "12345678"]);
  assert.deepStrictEqual(errors, ["sync-ish handler bug", "async handler bug"]);
});
