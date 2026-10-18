const test = require("node:test");
const assert = require("node:assert");
const { subject } = require("../client");

// Cases mirror the server's internal/pubsub TestSubjectIsInjective and
// TestSubjectMapping (priompt/priompt#33).
test("distinct URIs map to distinct subjects", () => {
  for (const [a, b] of [
    ["priompt://acme/a.b", "priompt://acme/a/b"],
    ["priompt://acme/corp/x", "priompt://acme.corp/x"],
    ["priompt://acme/a.b/c", "priompt://acme/a/b.c"],
  ]) {
    assert.notStrictEqual(subject(a), subject(b), `${a} and ${b} share a subject`);
  }
});

test("dot-free URIs keep their subject", () => {
  assert.strictEqual(subject("priompt://acme/support/agent"), "priompt.acme.support.agent");
  assert.strictEqual(subject("priompt://acme/support/agent-v2_x"), "priompt.acme.support.agent-v2_x");
});

test("bytes outside [A-Za-z0-9_-] are percent-encoded with uppercase hex", () => {
  assert.strictEqual(subject("priompt://acme.corp/x/a.b"), "priompt.acme%2Ecorp.x.a%2Eb");
  // Encoded per UTF-8 byte, as the server's Go loop does.
  assert.strictEqual(subject("priompt://acme/café"), "priompt.acme.caf%C3%A9");
});
