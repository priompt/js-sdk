const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { PromptClient } = require("../client");

function bearer(opts, env) {
  const saved = { PRIOMPT_URL: process.env.PRIOMPT_URL, PRIOMPT_TOKEN: process.env.PRIOMPT_TOKEN };
  for (const k of Object.keys(saved)) {
    if (k in env) process.env[k] = env[k];
    else delete process.env[k];
  }
  try {
    const c = new PromptClient(opts);
    c.close();
    const v = c._meta.get("authorization");
    return v.length ? v[0] : undefined;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("PRIOMPT_TOKEN is sent as the bearer token", () => {
  assert.strictEqual(bearer({ host: "localhost:1" }, { PRIOMPT_TOKEN: "envtok" }), "Bearer envtok");
});

test("PRIOMPT_TOKEN wins over the token in PRIOMPT_URL", () => {
  assert.strictEqual(
    bearer({}, { PRIOMPT_URL: "priompt://urltok@localhost:1", PRIOMPT_TOKEN: "envtok" }),
    "Bearer envtok"
  );
});

test("an explicit token wins over PRIOMPT_TOKEN", () => {
  assert.strictEqual(bearer({ host: "localhost:1", token: "argtok" }, { PRIOMPT_TOKEN: "envtok" }), "Bearer argtok");
});

test("the token in PRIOMPT_URL is used when PRIOMPT_TOKEN is unset", () => {
  assert.strictEqual(bearer({}, { PRIOMPT_URL: "priompt://urltok@localhost:1" }), "Bearer urltok");
});

test("no token configured sends no authorization header", () => {
  assert.strictEqual(bearer({ host: "localhost:1" }, {}), undefined);
});

test("vendored proto carries the published go_package", () => {
  const proto = fs.readFileSync(path.join(__dirname, "../proto/priompt/v1/prompt.proto"), "utf8");
  assert.match(proto, /option go_package = "github\.com\/priompt\/proto\/gen\/priompt\/v1;priomptv1";/);
});
