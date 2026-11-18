import type { HistoryEntry, LibraryExercise, Side, WorkoutBundle, WorkoutExerciseRow } from "../workouts";
import { withTx, wrap } from "./idb";

export type LocalWorkout = {
  id: string;
  workout: WorkoutBundle["workout"];
  exercises: WorkoutExerciseRow[];
  library: LibraryExercise[];
  history: Record<string, HistoryEntry>;
};

export type LocalSet = {
  id: string;
  workoutId: string;
  weId: string;
  exerciseId: string;
  setNumber: number;
  side: Side | null;
  reps: number | null;
  durationSeconds: number | null;
  weightKg: number | null;
  rir: number | null;
};

/** Unlogged inputs the user has adjusted. Local only, never synced. */
export type Draft = {
  key: string; // slot key
  workoutId: string;
  reps?: number | null;
  durationSeconds?: number | null;
  weightKg?: number | null;
  rir?: number | null;
};

export type OpPayload =
  | { type: "upsert_set"; setId: string; weId: string; exerciseId: string; setNumber: number; side: Side | null; reps: number | null; durationSeconds: number | null; weightKg: number | null; rir: number | null }
  | { type: "delete_set"; setId: string }
  | { type: "swap_exercise"; weId: string; exerciseId: string }
  | { type: "set_notes"; notes: string }
  | { type: "set_finished"; finishedAt: string | null };

export type OutboxOp = {
  seq: number; // key; also the ordering stamp the server compares
  opId: string;
  workoutId: string;
  entity: string; // coalescing key, mirrors the server's entity key
  payload: OpPayload;
  status: "pending" | "rejected";
  attempts: number;
  nextAttemptAt: number;
  error?: string;
};

export const slotKey = (weId: string, setNumber: number, side: Side | null) => `${weId}:${setNumber}:${side ?? "-"}`;

function entityOf(p: OpPayload, workoutId: string): string {
  switch (p.type) {
    case "upsert_set":
    case "delete_set":
      return `set:${p.setId}`;
    case "swap_exercise":
      return `we:${p.weId}`;
    case "set_notes":
      return `notes:${workoutId}`;
    case "set_finished":
      return `finish:${workoutId}`;
  }
}

/* ---------- change notifications (same tab + other tabs) ---------- */

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
function bc() {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("training-store");
    channel.onmessage = () => listeners.forEach((l) => l());
  }
  return channel;
}
export function subscribe(fn: () => void): () => void {
  bc();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notify() {
  listeners.forEach((l) => l());
  bc()?.postMessage(1);
}

/* ---------- sequence numbers ---------- */

/** Hybrid clock: strictly increasing per device even if the wall clock goes backwards. Call inside a "meta" tx. */
async function nextSeq(tx: IDBTransaction): Promise<number> {
  const meta = tx.objectStore("meta");
  const last = ((await wrap(meta.get("lastSeq"))) as { value: number } | undefined)?.value ?? 0;
  const seq = Math.max(last + 1, Date.now());
  meta.put({ key: "lastSeq", value: seq });
  return seq;
}

function newOpId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Adds an op to the outbox in the caller's transaction, replacing any pending op for the same entity (latest edit wins). */
async function enqueue(tx: IDBTransaction, workoutId: string, payload: OpPayload): Promise<void> {
  const seq = await nextSeq(tx);
  const outbox = tx.objectStore("outbox");
  const entity = entityOf(payload, workoutId);
  const all = (await wrap(outbox.index("workoutId").getAll(workoutId))) as OutboxOp[];
  for (const o of all) if (o.entity === entity) outbox.delete(o.seq);
  const op: OutboxOp = { seq, opId: newOpId(), workoutId, entity, payload, status: "pending", attempts: 0, nextAttemptAt: 0 };
  outbox.put(op);
}

/* ---------- reads ---------- */

export async function getWorkout(id: string): Promise<LocalWorkout | undefined> {
  return withTx(["workouts"], "readonly", (tx) => wrap(tx.objectStore("workouts").get(id)) as Promise<LocalWorkout | undefined>);
}
export async function listSets(workoutId: string): Promise<LocalSet[]> {
  return withTx(["sets"], "readonly", (tx) => wrap(tx.objectStore("sets").index("workoutId").getAll(workoutId)) as Promise<LocalSet[]>);
}
export async function listDrafts(workoutId: string): Promise<Draft[]> {
  return withTx(["drafts"], "readonly", (tx) => wrap(tx.objectStore("drafts").index("workoutId").getAll(workoutId)) as Promise<Draft[]>);
}
export async function listOpenWorkouts(): Promise<LocalWorkout[]> {
  const all = await withTx(["workouts"], "readonly", (tx) => wrap(tx.objectStore("workouts").getAll()) as Promise<LocalWorkout[]>);
  return all.filter((w) => !w.workout.finished_at);
}

/* ---------- writes ---------- */

/**
 * Stores what the server sent. The first time, everything is saved. If this device already
 * holds the workout, local edits stay authoritative and only the reference data
 * (exercise library and history) is refreshed.
 */
export async function hydrate(bundle: WorkoutBundle): Promise<void> {
  await withTx(["workouts", "sets"], "readwrite", async (tx) => {
    const store = tx.objectStore("workouts");
    const existing = (await wrap(store.get(bundle.workout.id))) as LocalWorkout | undefined;
    if (existing) {
      store.put({ ...existing, library: bundle.library, history: bundle.history });
      return;
    }
    store.put({ id: bundle.workout.id, workout: bundle.workout, exercises: bundle.exercises, library: bundle.library, history: bundle.history } satisfies LocalWorkout);
    const sets = tx.objectStore("sets");
    for (const s of bundle.sets) {
      sets.put({
        id: s.id, workoutId: bundle.workout.id, weId: s.workout_exercise_id, exerciseId: s.exercise_id, setNumber: s.set_number,
        side: s.side, reps: s.reps, durationSeconds: s.duration_seconds, weightKg: s.weight_kg, rir: s.rir,
      } satisfies LocalSet);
    }
  });
  notify();
}

/** Logs or edits a set: local write and queued sync op commit together. */
export async function saveSet(set: Omit<LocalSet, "id"> & { id?: string }): Promise<LocalSet> {
  const full: LocalSet = { ...set, id: set.id ?? slotKey(set.weId, set.setNumber, set.side) };
  await withTx(["sets", "drafts", "outbox", "meta"], "readwrite", async (tx) => {
    tx.objectStore("sets").put(full);
    tx.objectStore("drafts").delete(slotKey(full.weId, full.setNumber, full.side));
    await enqueue(tx, full.workoutId, {
      type: "upsert_set", setId: full.id, weId: full.weId, exerciseId: full.exerciseId, setNumber: full.setNumber,
      side: full.side, reps: full.reps, durationSeconds: full.durationSeconds, weightKg: full.weightKg, rir: full.rir,
    });
  });
  notify();
  return full;
}

export async function deleteSet(set: LocalSet): Promise<void> {
  await withTx(["sets", "outbox", "meta"], "readwrite", async (tx) => {
    tx.objectStore("sets").delete(set.id);
    await enqueue(tx, set.workoutId, { type: "delete_set", setId: set.id });
  });
  notify();
}

export async function saveDraft(draft: Draft): Promise<void> {
  await withTx(["drafts"], "readwrite", async (tx) => void tx.objectStore("drafts").put(draft));
  notify();
}

export async function swapExercise(workoutId: string, weId: string, ex: LibraryExercise): Promise<void> {
  await withTx(["workouts", "outbox", "meta"], "readwrite", async (tx) => {
    const store = tx.objectStore("workouts");
    const w = (await wrap(store.get(workoutId))) as LocalWorkout;
    w.exercises = w.exercises.map((e) => {
      if (e.id !== weId) return e;
      const original = e.replaces_exercise_id ?? e.exercise_id;
      return {
        ...e, exercise_id: ex.id, replaces_exercise_id: ex.id === original ? null : original, name: ex.name,
        measurement_type: ex.measurement_type, per_side: ex.per_side, target_min: ex.default_min, target_max: ex.default_max, increment_kg: ex.increment_kg,
      };
    });
    store.put(w);
    await enqueue(tx, workoutId, { type: "swap_exercise", weId, exerciseId: ex.id });
  });
  notify();
}

export async function setNotes(workoutId: string, notes: string): Promise<void> {
  await withTx(["workouts", "outbox", "meta"], "readwrite", async (tx) => {
    const store = tx.objectStore("workouts");
    const w = (await wrap(store.get(workoutId))) as LocalWorkout;
    store.put({ ...w, workout: { ...w.workout, notes } });
    await enqueue(tx, workoutId, { type: "set_notes", notes });
  });
  notify();
}

export async function setFinished(workoutId: string, finishedAt: string | null): Promise<void> {
  await withTx(["workouts", "outbox", "meta"], "readwrite", async (tx) => {
    const store = tx.objectStore("workouts");
    const w = (await wrap(store.get(workoutId))) as LocalWorkout;
    store.put({ ...w, workout: { ...w.workout, finished_at: finishedAt } });
    await enqueue(tx, workoutId, { type: "set_finished", finishedAt });
  });
  notify();
}

/* ---------- outbox management (used by sync and the "needs attention" UI) ---------- */

export async function listOutbox(): Promise<OutboxOp[]> {
  const all = await withTx(["outbox"], "readonly", (tx) => wrap(tx.objectStore("outbox").getAll()) as Promise<OutboxOp[]>);
  return all.sort((a, b) => a.seq - b.seq);
}

export async function updateOp(seq: number, patch: Partial<OutboxOp>): Promise<void> {
  await withTx(["outbox"], "readwrite", async (tx) => {
    const s = tx.objectStore("outbox");
    const cur = (await wrap(s.get(seq))) as OutboxOp | undefined;
    if (cur) s.put({ ...cur, ...patch }); // already replaced by a newer edit: nothing to update
  });
  notify();
}

export async function removeOp(seq: number): Promise<void> {
  await withTx(["outbox"], "readwrite", async (tx) => void tx.objectStore("outbox").delete(seq));
  notify();
}

/** Puts a rejected op back in the queue. */
export const retryOp = (seq: number) => updateOp(seq, { status: "pending", attempts: 0, nextAttemptAt: 0, error: undefined });

/** Gives up on a rejected op and undoes its local effect where that makes sense (a set that never reached the server). */
export async function discardOp(op: OutboxOp): Promise<void> {
  await withTx(["outbox", "sets"], "readwrite", async (tx) => {
    tx.objectStore("outbox").delete(op.seq);
    if (op.payload.type === "upsert_set") tx.objectStore("sets").delete(op.payload.setId);
  });
  notify();
}

export type SyncSummary = { pending: number; rejected: OutboxOp[] };
export async function summary(workoutId?: string): Promise<SyncSummary> {
  const ops = (await listOutbox()).filter((o) => !workoutId || o.workoutId === workoutId);
  return { pending: ops.filter((o) => o.status === "pending").length, rejected: ops.filter((o) => o.status === "rejected") };
}
