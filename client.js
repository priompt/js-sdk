// Priompt JavaScript adapter (Node). Mirrors the Python client.
// Loads the .proto at runtime via @grpc/proto-loader — no codegen step.
//   npm i @grpc/grpc-js @grpc/proto-loader   (and `nats` only if you subscribe)
const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const PROTO = path.resolve(__dirname, "proto/priompt/v1/prompt.proto");

function loadService() {
  const def = protoLoader.loadSync(PROTO, {
    keepCase: true, // preserve field names like version_hash, new_template
    longs: String,
    enums: String,
    defaults: true,
  });
  return grpc.loadPackageDefinition(def).priompt.v1;
}

function subject(uri) {
  return "priompt." + uri.replace("priompt://", "").replace(/\//g, ".");
}

// parseUrl splits a priompt://<token>@host:port connection URL into { host,
// token }. A value without a scheme is treated as a bare host.
function parseUrl(raw) {
  if (!raw.includes("://")) return { host: raw, token: undefined };
  const u = new URL(raw);
  const host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
  return { host, token: u.username || undefined };
}

// parseNatsUrl splits a credential out of a nats:// url. The nats.js client
// takes the token as a connection option rather than reading it from the url,
// so carrying it in the url — which is how every other Priompt address works —
// has to be unpacked here.
function parseNatsUrl(raw) {
  try {
    const u = new URL(raw);
    const token = decodeURIComponent(u.password || u.username || "");
    u.username = "";
    u.password = "";
    return { servers: u.toString().replace(/\/$/, ""), token: token || undefined };
  } catch {
    return { servers: raw, token: undefined };
  }
}

class PromptClient {
  // One connection string covers local/self-host/cloud: pass url or set
  // PRIOMPT_URL (priompt://<token>@host:port). An explicit host wins; an
  // explicit token overrides the URL's token.
  constructor({ host, token, tls = false, natsUrl, natsToken, url } = {}) {
    if (!host) {
      const raw = url || process.env.PRIOMPT_URL;
      if (raw) {
        const parsed = parseUrl(raw);
        host = parsed.host;
        if (token === undefined) token = parsed.token;
      }
    }
    if (!host) throw new Error("PromptClient needs host, url, or PRIOMPT_URL");
    const pkg = loadService();
    const creds = tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
    this._stub = new pkg.PromptService(host, creds);
    this._meta = new grpc.Metadata();
    if (token) this._meta.add("authorization", `Bearer ${token}`);
    // The broker requires its own credential once it is reachable off-loopback:
    // change events name every prompt that moves and carry the verdict agents
    // gate auto-reload on, so it is not a public channel. Accept the token
    // explicitly, or embedded in the url as nats://<token>@host:4222 — the
    // nats.js client does not read a token out of the URL itself.
    if (natsUrl) {
      const { servers, token: urlToken } = parseNatsUrl(natsUrl);
      this._natsUrl = servers;
      this._natsToken = natsToken !== undefined ? natsToken : urlToken;
    }
  }

  _call(method, req) {
    return new Promise((resolve, reject) =>
      this._stub[method](req, this._meta, (err, res) => (err ? reject(err) : resolve(res)))
    );
  }

  // get fetches the served HEAD, or a pinned version when `ref` (a branch name
  // or commit hash) is given.
  get(uri, ref = "") {
    return this._call("GetPrompt", { uri, ref });
  }

  diff(uri, newTemplate) {
    return this._call("DiffPrompt", { uri, new_template: newTemplate });
  }

  publish(uri, template, slots = []) {
    return this._call("PublishPrompt", { uri, template, slots });
  }

  // subscribe registers as a subscriber: onChange(versionHash, classification)
  // fires on each republish (push). classification is the semantic diff verdict
  // (structural | localized tweak | minor edit | new | ""), so an agent can
  // auto-reload a tweak but hold a structural change. Needs `npm i nats` and
  // natsUrl set. Returns the connection.
  async subscribe(uri, onChange) {
    if (!this._natsUrl) throw new Error("set natsUrl on PromptClient to subscribe");
    const { connect, StringCodec } = require("nats");
    const opts = { servers: this._natsUrl };
    if (this._natsToken) opts.token = this._natsToken;
    const nc = await connect(opts);
    const sc = StringCodec();
    (async () => {
      for await (const m of nc.subscribe(subject(uri))) {
        let ev;
        try {
          ev = JSON.parse(sc.decode(m.data));
        } catch {
          ev = { version: sc.decode(m.data) }; // pre-0.7 bare-hash body
        }
        onChange(ev.version || "", ev.classification || "");
      }
    })();
    return nc;
  }

  close() {
    grpc.closeClient(this._stub);
  }
}

module.exports = { PromptClient };
