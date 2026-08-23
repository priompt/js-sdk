#!/usr/bin/env node
// stub-agent.js — a stand-in for a production agent that reads its prompts from
// priompt by address instead of hard-coding them, and reacts to change pushes.
//
//   node stub-agent.js <label> <uri> [uri...]
//
// It does the thing the whole pub/sub layer exists for: hot-reload a safe edit,
// hold a structural one. The verdict rides along with the notification, so the
// decision needs no extra round trip.
//
// env: PRIOMPT_HOST  (localhost:8443)
//      PRIOMPT_TOKEN (bearer token, if the server requires one)
//      PRIOMPT_NATS  (nats://127.0.0.1:4222 — carry the broker credential in the
//                     url when it needs one: nats://<token>@host:4222)

const { PromptClient } = require("./client");

const HOST = process.env.PRIOMPT_HOST || "localhost:8443";
const TOKEN = process.env.PRIOMPT_TOKEN || "";
const NATS = process.env.PRIOMPT_NATS || "nats://127.0.0.1:4222";

// Verdicts an agent may act on without a human. Anything else is held.
//
// The empty verdict is deliberately NOT in this set. The server returns "" when
// it could not classify the change at all — a misconfigured or unreachable
// embedding endpoint, for instance — and it publishes anyway, because the new
// version is durable and the verdict is only advisory. So "" does not mean
// "safe"; it means "nobody checked".
//
// Treating it as safe inverts the whole point of the gate: the moment the
// safety check breaks, every change would sail through unreviewed, and it would
// look exactly like a run of harmless edits. An unauthenticated forged
// notification carries no verdict either. Fail closed.
const AUTO_RELOAD = new Set(["minor edit", "localized tweak", "new"]);

// Stand-in values so a rendered prompt looks like a real call.
const SAMPLES = {
	name: "Sujal",
	org: "Acme",
	count: "3",
	categories: "billing|bug|feature",
	ticket: "card declined twice",
	team: "payments",
	agent: "planner-1",
	goal: "ship the beta",
	date: "2026-08-17",
	audience: "the team",
	thread: "12 messages"
};

const [label, ...uris] = process.argv.slice(2);
if (!label || uris.length === 0) {
	console.error("usage: node stub-agent.js <label> <uri> [uri...]");
	process.exit(1);
}

const stamp = () => new Date().toTimeString().slice(0, 8);
const short = (h) => (h ? h.slice(0, 8) : "--------");
const log = (tag, msg) =>
	console.log(`${stamp()}  ${label.padEnd(9)} ${tag.padEnd(11)} ${msg}`);

const live = new Map(); // uri -> { template, slots, version } the agent is serving
const held = new Map(); // uri -> version it refused to take

function render(uri) {
	const p = live.get(uri);
	if (!p) return "(not loaded)";
	const out = p.template.replace(/\{(\w+)\}/g, (_, k) => SAMPLES[k] ?? `<${k}>`);
	return out.split("\n")[0].slice(0, 72);
}

async function load(client, uri) {
	const p = await client.get(uri);
	live.set(uri, { template: p.template, slots: p.slots || [], version: p.version_hash });
	return p.version_hash;
}

async function main() {
	const client = new PromptClient({ host: HOST, token: TOKEN, natsUrl: NATS });

	for (const uri of uris) {
		const v = await load(client, uri);
		log("BOOT", `${uri}  @${short(v)}`);
	}

	// One subscription per URI: the notification body carries {version,
	// classification} but not the URI, so a wildcard subject would leave the
	// agent unable to tell which prompt moved. The closure supplies it.
	for (const uri of uris) {
		await client.subscribe(uri, async (version, classification) => {
			const verdict = classification || "(none)";
			const current = live.get(uri);

			if (current && current.version === version) return; // our own echo

			if (AUTO_RELOAD.has(classification)) {
				await load(client, uri);
				held.delete(uri);
				log("RELOAD", `${uri}  ${verdict} -> now @${short(version)}`);
				log("", `  serving: ${render(uri)}`);
			} else {
				held.set(uri, version);
				const why = classification
					? `${verdict} — needs review`
					: `no verdict — the server could not classify this change; ` +
						`check its embedding endpoint`;
				log("HELD", `${uri}  ${why}`);
				log("", `  still serving @${short(current && current.version)}, ` +
					`pending @${short(version)}`);
			}
		});
	}
	log("READY", `subscribed to ${uris.length} prompt(s) on ${NATS}`);

	// Heartbeat: keep using the prompts, so a version flip is visible in the
	// stream rather than being a single line you have to go looking for.
	let i = 0;
	setInterval(() => {
		const uri = uris[i++ % uris.length];
		const p = live.get(uri);
		const flag = held.has(uri) ? " [holding update]" : "";
		log("CALL", `${uri.split("/").pop()} @${short(p && p.version)}${flag}  "${render(uri)}"`);
	}, 4000);
}

main().catch((e) => {
	console.error(`${stamp()}  ${label}  FATAL  ${e.message}`);
	process.exit(1);
});
