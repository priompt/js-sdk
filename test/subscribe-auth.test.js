const test = require("node:test");
const assert = require("node:assert");
const { PromptClient } = require("../client");
const { startFakeNats } = require("./fake-nats");

test("subscribe with a wrong NATS token rejects promptly with the authorization error", async (t) => {
  const broker = await startFakeNats({ token: "s3cret", lossyAuthErr: true });
  t.after(() => broker.close());
  const client = new PromptClient({ host: "localhost:1", natsUrl: broker.url.replace("nats://", "nats://wrong@") });
  t.after(() => client.close());

  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("subscribe() did not settle within 5s")), 5000);
  });
  t.after(() => clearTimeout(timer));
  const sub = client.subscribe("priompt://acme/support/agent", () => {});
  sub.then((nc) => nc.close(), () => {}); // don't leak a connection if it ever succeeds

  await assert.rejects(Promise.race([sub, deadline]), /Authorization Violation/);
});

test("subscribe with the right NATS token still delivers events", async (t) => {
  const broker = await startFakeNats({ token: "s3cret", lossyAuthErr: true });
  t.after(() => broker.close());
  const client = new PromptClient({ host: "localhost:1", natsUrl: broker.url, natsToken: "s3cret" });
  t.after(() => client.close());

  const got = new Promise((resolve) => {
    client.subscribe("priompt://acme/support/agent", (version, classification) => resolve({ version, classification }))
      .then((nc) => {
        t.after(() => nc.close());
        return nc.flush();
      })
      .then(() => broker.publish("priompt.acme.support.agent", JSON.stringify({ version: "abc123", classification: "minor edit" })));
  });
  assert.deepStrictEqual(await got, { version: "abc123", classification: "minor edit" });
});
