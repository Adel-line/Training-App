import type { DatabaseSync } from "node:sqlite";
import { safeEqual } from "./config.ts";
import { disconnectLocal } from "./connection.ts";
import { enqueue, getMeta } from "./jobs.ts";
import { SUBSCRIPTION_META } from "./meta.ts";
import { getTokenRow } from "./tokens.ts";
import { eventSchema } from "./worker.ts";

export type WebhookResult = { status: number; json?: unknown; text?: string; enqueued?: boolean };

export { SUBSCRIPTION_META };

/**
 * Strava's subscription validation: GET with hub.mode=subscribe, hub.challenge and hub.verify_token.
 * Respond 200 with {"hub.challenge": <value>} as JSON (within 2 seconds).
 */
export function handleVerification(query: URLSearchParams, expectedToken: string): WebhookResult {
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token") ?? "";
  const challenge = query.get("hub.challenge");
  if (mode !== "subscribe" || !challenge || !expectedToken || !safeEqual(token, expectedToken)) return { status: 403, text: "Forbidden" };
  return { status: 200, json: { "hub.challenge": challenge } };
}

/**
 * Handles one pushed event. Only validates and queues it (a single quick insert); fetching
 * activity details happens later in the worker, so the 200 is well inside Strava's 2-second deadline.
 *  - malformed payload -> 400
 *  - a subscription id that isn't ours -> 403
 *  - events for an athlete that isn't (or is no longer) connected -> 200 and ignored, so Strava stops retrying
 *  - athlete deauthorization -> disconnect immediately
 */
export function handleEvent(db: DatabaseSync, body: unknown, now = new Date()): WebhookResult {
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return { status: 400, text: "Bad request" };
  const ev = parsed.data;

  const known = getMeta(db, SUBSCRIPTION_META);
  if (known && ev.subscription_id !== undefined && String(ev.subscription_id) !== known) return { status: 403, text: "Forbidden" };

  const conn = getTokenRow(db);
  if (!conn || conn.athlete_id !== ev.owner_id) return { status: 200, text: "ignored" };

  if (ev.object_type === "athlete") {
    if (ev.aspect_type === "update" && ev.updates?.authorized === "false") disconnectLocal(db, now); // deauthorized on Strava's side
    return { status: 200, text: "EVENT_RECEIVED" };
  }

  const key = `evt:${ev.object_id}:${ev.aspect_type}:${ev.event_time}:${JSON.stringify(ev.updates ?? {})}`;
  const inserted = enqueue(db, { kind: "webhook_event", dedupeKey: key, payload: ev }, now); // duplicate deliveries insert nothing
  return { status: 200, text: "EVENT_RECEIVED", enqueued: inserted };
}
