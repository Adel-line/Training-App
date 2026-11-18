import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { makeApi, type Api } from "./client.ts";
import { NotConnectedError, RateLimitedError, StravaAuthError } from "./errors.ts";
import { claimNext, complete, defer, delMeta, fail, getMeta, isRunning, nextDueAt, savePayload, setMeta, type Job } from "./jobs.ts";
import { toActivityRow, type ActivityRow } from "./mapping.ts";
import { pauseUntil, shouldPause } from "./rate.ts";
import { getTokenRow } from "./tokens.ts";

const PER_PAGE = 50;
const MAX_ATTEMPTS = 8;
const RATE_KEY = "strava_rate_limited_until";

export type Ctx = { db: DatabaseSync; api: Api; now: () => Date };
export const defaultCtx = (db: DatabaseSync, fetchImpl: typeof fetch = fetch): Ctx => ({ db, api: makeApi(db, fetchImpl), now: () => new Date() });

/* ---------- activity storage ---------- */

export function upsertActivity(db: DatabaseSync, a: ActivityRow) {
  db.prepare(
    `INSERT INTO strava_activities (strava_activity_id, start_date, name, distance_m, moving_time_s, elevation_gain_m, avg_hr, avg_speed_mps, activity_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(strava_activity_id) DO UPDATE SET start_date = excluded.start_date, name = excluded.name, distance_m = excluded.distance_m,
       moving_time_s = excluded.moving_time_s, elevation_gain_m = excluded.elevation_gain_m, avg_hr = excluded.avg_hr,
       avg_speed_mps = excluded.avg_speed_mps, activity_type = excluded.activity_type`,
  ).run(a.strava_activity_id, a.start_date, a.name, a.distance_m, a.moving_time_s, a.elevation_gain_m, a.avg_hr, a.avg_speed_mps, a.activity_type);
}

const tombstone = (db: DatabaseSync, id: number) =>
  db.prepare("SELECT event_time FROM strava_deleted WHERE strava_activity_id = ?").get(id) as { event_time: number } | undefined;

/** Removes an activity and records when, so an older create/update event can't resurrect it. */
export function removeActivity(db: DatabaseSync, id: number, eventTime: number) {
  db.prepare("DELETE FROM strava_activities WHERE strava_activity_id = ?").run(id);
  db.prepare(
    `INSERT INTO strava_deleted (strava_activity_id, event_time) VALUES (?, ?)
     ON CONFLICT(strava_activity_id) DO UPDATE SET event_time = MAX(event_time, excluded.event_time)`,
  ).run(id, eventTime);
}

/* ---------- job handlers ---------- */

type Outcome = "done" | "deferred" | "stop";

const backfillPayload = z.object({ after: z.number(), page: z.number().int().min(1), imported: z.number().int(), seen: z.number().int() });

async function runBackfill(ctx: Ctx, job: Job): Promise<Outcome> {
  const { db, api } = ctx;
  let p = backfillPayload.parse(JSON.parse(job.payload));
  for (;;) {
    if (!isRunning(db, job.id) || !getTokenRow(db)) return "stop"; // cancelled or disconnected
    const res = await api.get("/athlete/activities", { after: p.after, page: p.page, per_page: PER_PAGE });
    if (!isRunning(db, job.id)) return "stop"; // cancelled while the request was in flight: write nothing
    const list = Array.isArray(res.json) ? res.json : [];
    const rows = list.map(toActivityRow).filter((r): r is ActivityRow => r !== null);
    db.exec("BEGIN");
    try {
      for (const r of rows) if (!tombstone(db, r.strava_activity_id)) upsertActivity(db, r); // never resurrect deletions
      p = { ...p, page: p.page + 1, imported: p.imported + rows.length, seen: p.seen + list.length };
      savePayload(db, job.id, p, ctx.now()); // progress survives interruptions: the next run resumes at this page
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    if (list.length < PER_PAGE) return "done";
    if (shouldPause(res.rate)) {
      defer(db, job.id, pauseUntil(res.rate!, ctx.now()), "Waiting for the Strava rate limit to reset", false, ctx.now());
      return "deferred";
    }
  }
}

export const eventSchema = z.object({
  object_type: z.enum(["activity", "athlete"]),
  object_id: z.number().int(),
  aspect_type: z.enum(["create", "update", "delete"]),
  owner_id: z.number().int(),
  subscription_id: z.number().int().optional(),
  event_time: z.number().int(),
  updates: z.record(z.string(), z.unknown()).optional(),
});
export type StravaEvent = z.infer<typeof eventSchema>;

async function runEvent(ctx: Ctx, job: Job): Promise<Outcome> {
  const { db, api } = ctx;
  const ev = eventSchema.parse(JSON.parse(job.payload));
  const row = getTokenRow(db);
  if (!row || row.athlete_id !== ev.owner_id) return "done"; // disconnected, or not our athlete: ignore
  if (ev.object_type !== "activity") return "done";
  const id = ev.object_id;

  if (ev.aspect_type === "delete") {
    removeActivity(db, id, ev.event_time);
    return "done";
  }
  const tomb = tombstone(db, id);
  if (tomb && tomb.event_time >= ev.event_time) return "done"; // stale: older than the delete we already applied

  const res = await api.get(`/activities/${id}`);
  if (!isRunning(db, job.id)) return "stop";
  if (res.status === 404 || res.status === 403) {
    removeActivity(db, id, ev.event_time); // gone, or no longer visible to us
    return "done";
  }
  const act = toActivityRow(res.json);
  if (!act) {
    // Updated to an unsupported type (or unusable data): it must not stay in the local list.
    db.prepare("DELETE FROM strava_activities WHERE strava_activity_id = ?").run(id);
    return "done";
  }
  upsertActivity(db, act);
  db.prepare("DELETE FROM strava_deleted WHERE strava_activity_id = ? AND event_time < ?").run(id, ev.event_time);
  return "done";
}

/* ---------- the loop ---------- */

const backoffMs = (attempts: number) => Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));

export function rateLimitedUntil(db: DatabaseSync): Date | null {
  const v = getMeta(db, RATE_KEY);
  return v ? new Date(v) : null;
}

export type Step = { state: "idle" } | { state: "paused"; until: Date } | { state: "processed" };

export async function processOne(ctx: Ctx): Promise<Step> {
  const { db } = ctx;
  const until = rateLimitedUntil(db);
  if (until && until > ctx.now()) return { state: "paused", until };
  if (until) delMeta(db, RATE_KEY);

  const job = claimNext(db, ctx.now());
  if (!job) return { state: "idle" };
  try {
    const outcome = job.kind === "backfill" ? await runBackfill(ctx, job) : await runEvent(ctx, job);
    if (outcome === "done") complete(db, job.id, ctx.now());
  } catch (e) {
    const msg = (e as Error).message;
    if (e instanceof RateLimitedError) {
      setMeta(db, RATE_KEY, e.until.toISOString()); // persisted: survives restarts and applies to every job
      defer(db, job.id, e.until, msg, false, ctx.now());
    } else if (e instanceof NotConnectedError) {
      fail(db, job.id, "Strava is not connected", ctx.now());
    } else if (e instanceof StravaAuthError) {
      fail(db, job.id, msg, ctx.now());
    } else if (job.attempts >= MAX_ATTEMPTS) {
      fail(db, job.id, `${msg} (gave up after ${job.attempts} tries)`, ctx.now());
    } else {
      defer(db, job.id, new Date(ctx.now().getTime() + backoffMs(job.attempts)), msg, true, ctx.now());
    }
  }
  return { state: "processed" };
}

/** Works through everything that is due. Returns when the next wake-up is needed (null = nothing scheduled). */
export async function drain(ctx: Ctx): Promise<Date | null> {
  for (;;) {
    const step = await processOne(ctx);
    if (step.state === "paused") return step.until;
    if (step.state === "idle") break;
  }
  const next = nextDueAt(ctx.db);
  const paused = rateLimitedUntil(ctx.db);
  if (next && paused && paused > next) return paused;
  return next;
}
