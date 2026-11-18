import type { DatabaseSync } from "node:sqlite";
import { getMeta } from "./jobs.ts";
import { SUBSCRIPTION_META } from "./webhook.ts";
import { getTokenRow } from "./tokens.ts";

export type StravaStatus = {
  connected: boolean;
  athleteId?: number;
  scope?: string;
  connectedAt?: string;
  backfill: { status: string; imported: number; page: number; error: string | null; runAfter: string } | null;
  pendingEvents: number;
  failedJobs: number;
  rateLimitedUntil: string | null;
  subscriptionId: string | null;
  activityCount: number;
  lastActivity: string | null;
};

export function getStravaStatus(db: DatabaseSync): StravaStatus {
  const t = getTokenRow(db);
  const bf = db.prepare("SELECT status, payload, last_error, run_after FROM strava_jobs WHERE kind = 'backfill' ORDER BY created_at DESC, rowid DESC LIMIT 1").get() as
    | { status: string; payload: string; last_error: string | null; run_after: string }
    | undefined;
  const p = bf ? (JSON.parse(bf.payload) as { imported?: number; page?: number }) : null;
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const until = getMeta(db, "strava_rate_limited_until");
  return {
    connected: Boolean(t),
    athleteId: t?.athlete_id,
    scope: t?.scope,
    connectedAt: t?.connected_at,
    backfill: bf ? { status: bf.status, imported: p?.imported ?? 0, page: p?.page ?? 1, error: bf.last_error, runAfter: bf.run_after } : null,
    pendingEvents: count("SELECT COUNT(*) n FROM strava_jobs WHERE kind = 'webhook_event' AND status IN ('pending','running')"),
    failedJobs: count("SELECT COUNT(*) n FROM strava_jobs WHERE status = 'failed'"),
    rateLimitedUntil: until && new Date(until) > new Date() ? until : null,
    subscriptionId: getMeta(db, SUBSCRIPTION_META),
    activityCount: count("SELECT COUNT(*) n FROM strava_activities"),
    lastActivity: (db.prepare("SELECT MAX(start_date) d FROM strava_activities").get() as { d: string | null }).d,
  };
}
