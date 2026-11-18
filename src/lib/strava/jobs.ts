import type { DatabaseSync } from "node:sqlite";

export type JobKind = "backfill" | "webhook_event";
export type Job = {
  id: string;
  kind: JobKind;
  dedupe_key: string;
  payload: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  attempts: number;
  run_after: string;
  last_error: string | null;
};

const iso = (d: Date) => d.toISOString();

/** Adds a job unless one with the same dedupe key already exists (duplicate webhook deliveries are harmless). */
export function enqueue(db: DatabaseSync, j: { kind: JobKind; dedupeKey: string; payload: unknown; runAfter?: Date }, now = new Date()): boolean {
  const r = db
    .prepare("INSERT OR IGNORE INTO strava_jobs (kind, dedupe_key, payload, run_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(j.kind, j.dedupeKey, JSON.stringify(j.payload), iso(j.runAfter ?? now), iso(now), iso(now));
  return Number(r.changes) === 1;
}

/** Atomically takes the oldest due job (safe even if two processes run workers). */
export function claimNext(db: DatabaseSync, now = new Date()): Job | null {
  const row = db
    .prepare(
      `UPDATE strava_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?1
       WHERE id = (SELECT id FROM strava_jobs WHERE status = 'pending' AND run_after <= ?1 ORDER BY created_at, rowid LIMIT 1)
       RETURNING id, kind, dedupe_key, payload, status, attempts, run_after, last_error`,
    )
    .get(iso(now)) as Job | undefined;
  return row ?? null;
}

export const complete = (db: DatabaseSync, id: string, now = new Date()) =>
  void db.prepare("UPDATE strava_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ? AND status = 'running'").run(iso(now), id);

export const fail = (db: DatabaseSync, id: string, error: string, now = new Date()) =>
  void db.prepare("UPDATE strava_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ? AND status = 'running'").run(error.slice(0, 500), iso(now), id);

/** Puts a running job back to pending for later. `countAttempt: false` for rate limits, which aren't failures. */
export function defer(db: DatabaseSync, id: string, runAfter: Date, error: string | null, countAttempt: boolean, now = new Date()) {
  db.prepare(
    `UPDATE strava_jobs SET status = 'pending', run_after = ?, last_error = ?, attempts = MAX(0, attempts - ?), updated_at = ?
     WHERE id = ? AND status = 'running'`,
  ).run(iso(runAfter), error?.slice(0, 500) ?? null, countAttempt ? 0 : 1, iso(now), id);
}

export const savePayload = (db: DatabaseSync, id: string, payload: unknown, now = new Date()) =>
  void db.prepare("UPDATE strava_jobs SET payload = ?, updated_at = ? WHERE id = ? AND status = 'running'").run(JSON.stringify(payload), iso(now), id);

export const isRunning = (db: DatabaseSync, id: string) => Boolean(db.prepare("SELECT 1 FROM strava_jobs WHERE id = ? AND status = 'running'").get(id));

export const cancelAll = (db: DatabaseSync, now = new Date()) =>
  Number(db.prepare("UPDATE strava_jobs SET status = 'cancelled', updated_at = ? WHERE status IN ('pending','running')").run(iso(now)).changes);

/** Jobs left 'running' by a crash or restart go back in the queue. */
export const recoverStale = (db: DatabaseSync, olderThanMs: number, now = new Date()) =>
  Number(
    db
      .prepare("UPDATE strava_jobs SET status = 'pending', updated_at = ?1 WHERE status = 'running' AND updated_at < ?2")
      .run(iso(now), iso(new Date(now.getTime() - olderThanMs))).changes,
  );

export function nextDueAt(db: DatabaseSync): Date | null {
  const r = db.prepare("SELECT MIN(run_after) AS t FROM strava_jobs WHERE status = 'pending'").get() as { t: string | null };
  return r.t ? new Date(r.t) : null;
}

/* ---- small key/value helpers (app_meta) ---- */
export const getMeta = (db: DatabaseSync, key: string): string | null =>
  ((db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value: string } | undefined)?.value) ?? null;
export const setMeta = (db: DatabaseSync, key: string, value: string) =>
  void db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
export const delMeta = (db: DatabaseSync, key: string) => void db.prepare("DELETE FROM app_meta WHERE key = ?").run(key);
