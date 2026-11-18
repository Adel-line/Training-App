import type { DatabaseSync } from "node:sqlite";
import { enqueue, cancelAll, delMeta } from "./jobs.ts";
import { getTokenRow } from "./tokens.ts";

export const BACKFILL_DAYS = 90;

/** Stores a fresh connection and queues the one-time 90-day backfill for it. */
export function saveConnection(
  db: DatabaseSync,
  t: { athleteId: number; accessToken: string; refreshToken: string; expiresAt: number; scope: string },
  now = new Date(),
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    cancelAll(db, now); // anything left over belongs to a previous connection
    db.prepare(
      `INSERT INTO strava_tokens (id, athlete_id, access_token, refresh_token, expires_at, scope, connected_at, refresh_lease_until, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET athlete_id = excluded.athlete_id, access_token = excluded.access_token, refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at, scope = excluded.scope, connected_at = excluded.connected_at, refresh_lease_until = 0, updated_at = excluded.updated_at`,
    ).run(t.athleteId, t.accessToken, t.refreshToken, t.expiresAt, t.scope, now.toISOString(), now.toISOString());
    // Once per successful connection: the key includes the moment of connecting.
    enqueue(db, {
      kind: "backfill",
      dedupeKey: `backfill:${t.athleteId}:${now.getTime()}`,
      payload: { after: Math.floor(now.getTime() / 1000) - BACKFILL_DAYS * 86400, page: 1, imported: 0, seen: 0 },
    }, now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Removes the stored token pair and cancels pending imports. Imported activities are kept.
 * Afterwards events for this athlete are ignored (the webhook handler finds no connection).
 */
export function disconnectLocal(db: DatabaseSync, now = new Date()): { athleteId: number | null; cancelled: number } {
  const row = getTokenRow(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM strava_tokens WHERE id = 1").run();
    const cancelled = cancelAll(db, now);
    delMeta(db, "strava_rate_limited_until");
    db.exec("COMMIT");
    return { athleteId: row?.athlete_id ?? null, cancelled };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
