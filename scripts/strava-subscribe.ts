// Manage the (single) Strava webhook subscription.
//   npm run strava:subscribe -- create https://your-host.example/api/strava/webhook
//   npm run strava:subscribe -- view
//   npm run strava:subscribe -- delete
// Reads STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_VERIFY_TOKEN from .env.local (or the environment).
// `create` only works while the callback URL is publicly reachable and the app is running, because Strava
// calls it back to validate it before the subscription is accepted.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { dbPath, migrate } from "../src/lib/db.ts";
import { SUBSCRIPTION_META } from "../src/lib/strava/meta.ts";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const base = (process.env.STRAVA_BASE_URL || "https://www.strava.com").replace(/\/$/, "");
const api = `${base}/api/v3/push_subscriptions`;
const [, , cmd, arg] = process.argv;
const { STRAVA_CLIENT_ID: clientId, STRAVA_CLIENT_SECRET: clientSecret, STRAVA_VERIFY_TOKEN: verifyToken } = process.env;

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}
if (!clientId || !clientSecret) die("Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env.local first.");

const db = new DatabaseSync(dbPath());
migrate(db);
const setMeta = (v: string | null) =>
  v === null
    ? db.prepare("DELETE FROM app_meta WHERE key = ?").run(SUBSCRIPTION_META)
    : db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SUBSCRIPTION_META, v);

async function view(): Promise<{ id: number; callback_url: string }[]> {
  const res = await fetch(`${api}?${new URLSearchParams({ client_id: clientId!, client_secret: clientSecret! })}`);
  if (!res.ok) die(`Strava said ${res.status}: ${await res.text()}`);
  return (await res.json()) as { id: number; callback_url: string }[];
}

if (cmd === "view") {
  const subs = await view();
  if (subs.length === 0) console.log("No subscription.");
  for (const s of subs) console.log(`Subscription ${s.id} -> ${s.callback_url}`);
} else if (cmd === "create") {
  if (!arg) die("Usage: create <public https callback url, ending in /api/strava/webhook>");
  if (!verifyToken) die("Set STRAVA_VERIFY_TOKEN in .env.local (any random string) first.");
  if (!arg.startsWith("https://") && !process.env.STRAVA_BASE_URL) die("The callback URL must be https.");
  if (arg.length > 255) die("Strava limits the callback URL to 255 characters.");
  const existing = await view();
  if (existing.length > 0) die(`A subscription already exists (id ${existing[0].id}, ${existing[0].callback_url}). Run "delete" first; Strava allows only one per app.`);
  const res = await fetch(api, {
    method: "POST",
    body: new URLSearchParams({ client_id: clientId!, client_secret: clientSecret!, callback_url: arg, verify_token: verifyToken }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: number };
  if (!res.ok || !body.id) die(`Strava refused the subscription (${res.status}): ${JSON.stringify(body)}\nIs the app running and is the callback URL reachable from the internet?`);
  setMeta(String(body.id));
  console.log(`Subscription created: id ${body.id}. New activities will now appear within minutes.`);
} else if (cmd === "delete") {
  const subs = await view();
  if (subs.length === 0) console.log("No subscription to delete.");
  for (const s of subs) {
    const res = await fetch(`${api}/${s.id}?${new URLSearchParams({ client_id: clientId!, client_secret: clientSecret! })}`, { method: "DELETE" });
    if (res.status !== 204) die(`Strava said ${res.status}: ${await res.text()}`);
    console.log(`Deleted subscription ${s.id}.`);
  }
  setMeta(null);
} else {
  die("Commands: create <callback_url> | view | delete");
}
