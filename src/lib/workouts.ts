import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { isValidDate, SESSION_TYPES } from "./plan";

/* ---------- Types shared with the client ---------- */

export type Side = "left" | "right";

export type WorkoutExerciseRow = {
  id: string;
  position: number;
  exercise_id: string;
  replaces_exercise_id: string | null;
  name: string;
  measurement_type: "reps" | "seconds";
  per_side: 0 | 1;
  sets: number;
  target_min: number;
  target_max: number;
  increment_kg: number | null;
};

export type SetRow = {
  id: string;
  workout_exercise_id: string;
  exercise_id: string;
  set_number: number;
  side: Side | null;
  reps: number | null;
  duration_seconds: number | null;
  weight_kg: number | null;
  rir: number | null;
};

export type LibraryExercise = {
  id: string;
  name: string;
  muscle_group: string;
  measurement_type: "reps" | "seconds";
  per_side: 0 | 1;
  default_sets: number;
  default_min: number;
  default_max: number;
  increment_kg: number | null;
};

export type HistoryEntry = { date: string; sets: Omit<SetRow, "id" | "workout_exercise_id" | "exercise_id">[] };

export type WorkoutBundle = {
  workout: { id: string; date: string; session_type: string; notes: string; started_at: string; finished_at: string | null };
  exercises: WorkoutExerciseRow[];
  sets: SetRow[];
  library: LibraryExercise[];
  history: Record<string, HistoryEntry>; // by exercise id: latest completed workout's sets
};

/* ---------- Create (idempotent) + read ---------- */

export const startSchema = z.object({
  id: z.uuid(),
  date: z.string().refine(isValidDate, "Invalid date"),
  session_type: z.enum(SESSION_TYPES),
});

/** Starts a workout from the current template, copying exercises and targets into snapshot rows. Safe to call twice. */
export function createWorkout(db: DatabaseSync, input: z.infer<typeof startSchema>): void {
  if (db.prepare("SELECT 1 FROM workouts WHERE id = ?").get(input.id)) return;
  const templ = db
    .prepare(
      `SELECT t.position, t.sets, t.target_min, t.target_max, e.id AS exercise_id, e.name, e.measurement_type, e.per_side, e.increment_kg
       FROM session_templates t JOIN exercises e ON e.id = t.exercise_id
       WHERE t.session_type = ? ORDER BY t.position`,
    )
    .all(input.session_type) as {
    position: number; sets: number; target_min: number; target_max: number; exercise_id: string; name: string;
    measurement_type: string; per_side: number; increment_kg: number | null;
  }[];
  if (templ.length === 0) throw new Error("This session has no exercise template");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO workouts (id, date, session_type, started_at) VALUES (?, ?, ?, ?)").run(
      input.id, input.date, input.session_type, new Date().toISOString(),
    );
    const ins = db.prepare(
      `INSERT INTO workout_exercises (workout_id, position, exercise_id, name, measurement_type, per_side, sets, target_min, target_max, increment_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const t of templ) {
      ins.run(input.id, t.position, t.exercise_id, t.name, t.measurement_type, t.per_side, t.sets, t.target_min, t.target_max, t.increment_kg);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getBundle(db: DatabaseSync, id: string): WorkoutBundle | null {
  const workout = db
    .prepare("SELECT id, date, session_type, notes, started_at, finished_at FROM workouts WHERE id = ?")
    .get(id) as WorkoutBundle["workout"] | undefined;
  if (!workout) return null;
  const exercises = db
    .prepare(
      `SELECT id, position, exercise_id, replaces_exercise_id, name, measurement_type, per_side, sets, target_min, target_max, increment_kg
       FROM workout_exercises WHERE workout_id = ? ORDER BY position`,
    )
    .all(id) as WorkoutExerciseRow[];
  const sets = db
    .prepare(
      `SELECT id, workout_exercise_id, exercise_id, set_number, side, reps, duration_seconds, weight_kg, rir
       FROM workout_sets WHERE workout_id = ? ORDER BY workout_exercise_id, set_number`,
    )
    .all(id) as SetRow[];
  const library = db
    .prepare(
      `SELECT id, name, muscle_group, measurement_type, per_side, default_sets, default_min, default_max, increment_kg
       FROM exercises WHERE archived = 0 ORDER BY name`,
    )
    .all() as LibraryExercise[];

  // Latest completed workout's sets for every library exercise (so a swapped-in exercise has history too).
  const history: Record<string, HistoryEntry> = {};
  const latest = db.prepare(
    `SELECT w.id AS wid, w.date FROM workouts w
     WHERE w.finished_at IS NOT NULL AND w.id <> ?1
       AND EXISTS (SELECT 1 FROM workout_sets s WHERE s.workout_id = w.id AND s.exercise_id = ?2)
     ORDER BY w.finished_at DESC LIMIT 1`,
  );
  const setsOf = db.prepare(
    `SELECT set_number, side, reps, duration_seconds, weight_kg, rir FROM workout_sets
     WHERE workout_id = ? AND exercise_id = ? ORDER BY set_number, side`,
  );
  for (const ex of library) {
    const l = latest.get(id, ex.id) as { wid: string; date: string } | undefined;
    if (l) history[ex.id] = { date: l.date, sets: setsOf.all(l.wid, ex.id) as HistoryEntry["sets"] };
  }
  return { workout, exercises, sets, library, history };
}

/** An unfinished workout already started for this date and session, if any (used to resume instead of duplicating). */
export function findOpenWorkout(db: DatabaseSync, date: string, sessionType: string): string | null {
  const r = db
    .prepare("SELECT id FROM workouts WHERE date = ? AND session_type = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1")
    .get(date, sessionType) as { id: string } | undefined;
  return r?.id ?? null;
}

/* ---------- Sync operations ---------- */

const base = { opId: z.string().min(1).max(100), seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), workoutId: z.uuid() };

export const opSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("upsert_set"),
    setId: z.string().min(1).max(200),
    weId: z.string().min(1).max(100),
    exerciseId: z.string().min(1).max(100),
    setNumber: z.number().int().min(1).max(50),
    side: z.enum(["left", "right"]).nullable(),
    reps: z.number().int().min(0).max(1000).nullable(),
    durationSeconds: z.number().int().min(1).max(36000).nullable(),
    weightKg: z.number().min(0).max(1000).nullable(),
    rir: z.number().int().min(0).max(4).nullable(),
  }),
  z.object({ ...base, type: z.literal("delete_set"), setId: z.string().min(1).max(200) }),
  z.object({ ...base, type: z.literal("swap_exercise"), weId: z.string().min(1).max(100), exerciseId: z.string().min(1).max(100) }),
  z.object({ ...base, type: z.literal("set_notes"), notes: z.string().max(2000) }),
  z.object({ ...base, type: z.literal("set_finished"), finishedAt: z.iso.datetime().nullable() }),
]);
export type SyncOp = z.infer<typeof opSchema>;

export const syncBodySchema = z.object({ ops: z.array(z.unknown()).max(200) });

export type OpResult = { opId: string; status: "ok" | "stale" | "rejected" | "retry"; error?: string };

export function entityKey(op: SyncOp): string {
  switch (op.type) {
    case "upsert_set":
    case "delete_set":
      return `set:${op.setId}`;
    case "swap_exercise":
      return `we:${op.weId}`;
    case "set_notes":
      return `notes:${op.workoutId}`;
    case "set_finished":
      return `finish:${op.workoutId}`;
  }
}

class Rejected extends Error {}

function describeSqliteError(e: unknown): OpResult["status"] | { rejected: string } {
  const err = e as { errcode?: number; message?: string };
  const primary = (err.errcode ?? 0) & 0xff;
  if (primary === 5 || primary === 6) return "retry"; // busy / locked: temporary
  if (primary === 19) {
    const m = err.message ?? "";
    if (/UNIQUE/i.test(m)) return { rejected: "That set position is already used by a different entry." };
    return { rejected: m.replace(/^.*constraint failed:?\s*/i, "") || "The server refused this entry." };
  }
  return "retry";
}

function applyOne(db: DatabaseSync, op: SyncOp): void {
  const exists = db.prepare("SELECT 1 FROM workouts WHERE id = ?").get(op.workoutId);
  if (!exists) throw new Rejected("This workout no longer exists on the server.");
  switch (op.type) {
    case "upsert_set":
      db.prepare(
        `INSERT INTO workout_sets (id, workout_id, workout_exercise_id, exercise_id, set_number, side, reps, duration_seconds, weight_kg, rir)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET reps = excluded.reps, duration_seconds = excluded.duration_seconds,
           weight_kg = excluded.weight_kg, rir = excluded.rir, side = excluded.side, set_number = excluded.set_number,
           workout_exercise_id = excluded.workout_exercise_id, exercise_id = excluded.exercise_id,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      ).run(op.setId, op.workoutId, op.weId, op.exerciseId, op.setNumber, op.side, op.reps, op.durationSeconds, op.weightKg, op.rir);
      break;
    case "delete_set":
      db.prepare("DELETE FROM workout_sets WHERE id = ? AND workout_id = ?").run(op.setId, op.workoutId);
      break;
    case "swap_exercise": {
      const we = db
        .prepare("SELECT exercise_id, replaces_exercise_id FROM workout_exercises WHERE id = ? AND workout_id = ?")
        .get(op.weId, op.workoutId) as { exercise_id: string; replaces_exercise_id: string | null } | undefined;
      if (!we) throw new Rejected("Exercise slot not found.");
      const ex = db.prepare("SELECT * FROM exercises WHERE id = ?").get(op.exerciseId) as
        | { id: string; name: string; measurement_type: string; per_side: number; increment_kg: number | null; default_min: number; default_max: number }
        | undefined;
      if (!ex) throw new Rejected("Replacement exercise not found.");
      const logged = db.prepare("SELECT COUNT(*) AS n FROM workout_sets WHERE workout_exercise_id = ?").get(op.weId) as { n: number };
      if (logged.n > 0 && we.exercise_id !== op.exerciseId) throw new Rejected("Clear the logged sets before swapping this exercise.");
      const original = we.replaces_exercise_id ?? we.exercise_id;
      db.prepare(
        `UPDATE workout_exercises SET exercise_id = ?, replaces_exercise_id = ?, name = ?, measurement_type = ?, per_side = ?,
           target_min = ?, target_max = ?, increment_kg = ? WHERE id = ?`,
      ).run(ex.id, ex.id === original ? null : original, ex.name, ex.measurement_type, ex.per_side, ex.default_min, ex.default_max, ex.increment_kg, op.weId);
      break;
    }
    case "set_notes":
      db.prepare("UPDATE workouts SET notes = ? WHERE id = ?").run(op.notes, op.workoutId);
      break;
    case "set_finished":
      db.prepare("UPDATE workouts SET finished_at = ? WHERE id = ?").run(op.finishedAt, op.workoutId);
      break;
  }
}

/**
 * Applies client operations one by one, each in its own transaction. An operation older than
 * what the server already applied for the same entity is skipped ("stale"), which makes retries
 * and out-of-order delivery harmless. One bad operation never blocks the others.
 */
export function applyOps(db: DatabaseSync, rawOps: unknown[]): OpResult[] {
  const results: OpResult[] = [];
  const parsed = rawOps.map((raw) => ({ raw, res: opSchema.safeParse(raw) }));
  // Process in the order the client made the edits.
  const ordered = parsed
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => (a.res.success && b.res.success ? a.res.data.seq - b.res.data.seq : a.i - b.i));
  const byIndex = new Map<number, OpResult>();

  for (const p of ordered) {
    if (!p.res.success) {
      const opId = typeof (p.raw as { opId?: unknown })?.opId === "string" ? (p.raw as { opId: string }).opId : "?";
      byIndex.set(p.i, { opId, status: "rejected", error: "Malformed change: " + p.res.error.issues[0]?.message });
      continue;
    }
    const op = p.res.data;
    const key = entityKey(op);
    const seen = db.prepare("SELECT seq FROM sync_state WHERE entity_key = ?").get(key) as { seq: number } | undefined;
    if (seen && seen.seq >= op.seq) {
      byIndex.set(p.i, { opId: op.opId, status: "stale" });
      continue;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      applyOne(db, op);
      db.prepare("INSERT INTO sync_state (entity_key, seq) VALUES (?, ?) ON CONFLICT(entity_key) DO UPDATE SET seq = excluded.seq").run(key, op.seq);
      db.exec("COMMIT");
      byIndex.set(p.i, { opId: op.opId, status: "ok" });
    } catch (e) {
      db.exec("ROLLBACK");
      if (e instanceof Rejected) byIndex.set(p.i, { opId: op.opId, status: "rejected", error: e.message });
      else {
        const d = describeSqliteError(e);
        byIndex.set(p.i, typeof d === "string" ? { opId: op.opId, status: d } : { opId: op.opId, status: "rejected", error: d.rejected });
      }
    }
  }
  parsed.forEach((_, i) => results.push(byIndex.get(i)!));
  return results;
}
