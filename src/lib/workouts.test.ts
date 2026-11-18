import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, runSeed } from "./db";
import { applyOps, createWorkout, findOpenWorkout, getBundle, type SyncOp } from "./workouts";

const W = "11111111-1111-4111-8111-111111111111";
let db: DatabaseSync;
let seq = 0;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  runSeed(db);
  seq = 0;
});

const start = () => createWorkout(db, { id: W, date: "2026-11-23", session_type: "strength_a" });
const bundle = () => getBundle(db, W)!;
const op = (o: Record<string, unknown>) => ({ opId: `o${++seq}`, seq: (o.seq as number) ?? seq, workoutId: W, ...o }) as unknown as SyncOp;
const setOp = (we: { id: string; exercise_id: string }, n: number, extra: Record<string, unknown> = {}) =>
  op({ type: "upsert_set", setId: `${we.id}:${n}:-`, weId: we.id, exerciseId: we.exercise_id, setNumber: n, side: null, reps: 8, durationSeconds: null, weightKg: 20, rir: 2, ...extra });

describe("createWorkout", () => {
  it("snapshots the template in order and is idempotent", () => {
    start();
    start();
    const b = bundle();
    expect(b.exercises.map((e) => e.name)).toEqual(["Goblet box squat", "Romanian deadlift (RDL)", "Hip thrust", "Step-up", "Calf raise", "Side plank"]);
    expect(b.exercises[3]).toMatchObject({ per_side: 1, sets: 3, target_min: 8, target_max: 8 });
    expect((db.prepare("SELECT COUNT(*) n FROM workouts").get() as { n: number }).n).toBe(1);
  });
  it("later template edits leave the started workout alone", () => {
    start();
    db.prepare("UPDATE session_templates SET sets = 5, target_max = 15 WHERE session_type='strength_a' AND position=1").run();
    db.prepare("UPDATE exercises SET name='Renamed' WHERE name='Goblet box squat'").run();
    expect(bundle().exercises[0]).toMatchObject({ name: "Goblet box squat", sets: 3, target_max: 10 });
  });
  it("refuses sessions without a template and finds an open workout to resume", () => {
    expect(() => createWorkout(db, { id: W, date: "2026-11-24", session_type: "easy_run" })).toThrow();
    start();
    expect(findOpenWorkout(db, "2026-11-23", "strength_a")).toBe(W);
    applyOps(db, [op({ type: "set_finished", finishedAt: "2026-11-23T09:00:00.000Z" })]);
    expect(findOpenWorkout(db, "2026-11-23", "strength_a")).toBeNull();
  });
});

describe("applyOps", () => {
  it("applies sets (with and without weight) and re-delivery does not duplicate", () => {
    start();
    const we = bundle().exercises[0];
    const a = setOp(we, 1);
    const b = setOp(we, 2, { weightKg: null });
    expect(applyOps(db, [a, b]).map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(applyOps(db, [a, b]).map((r) => r.status)).toEqual(["stale", "stale"]);
    expect(bundle().sets).toHaveLength(2);
    expect(bundle().sets[1].weight_kg).toBeNull();
  });
  it("an older queued write cannot overwrite a newer edit, regardless of arrival order", () => {
    start();
    const we = bundle().exercises[0];
    const older = setOp(we, 1, { reps: 8, seq: 100 });
    const newer = setOp(we, 1, { reps: 9, seq: 200 });
    expect(applyOps(db, [newer]).map((r) => r.status)).toEqual(["ok"]);
    expect(applyOps(db, [older]).map((r) => r.status)).toEqual(["stale"]);
    expect(bundle().sets[0].reps).toBe(9);
    // same batch, wrong order: processed by seq
    const [x, y] = [setOp(we, 2, { reps: 5, seq: 300 }), setOp(we, 2, { reps: 6, seq: 400 })];
    applyOps(db, [y, x]);
    expect(bundle().sets.find((s) => s.set_number === 2)!.reps).toBe(6);
  });
  it("a stale write cannot recreate a deleted set, but a newer one can", () => {
    start();
    const we = bundle().exercises[0];
    applyOps(db, [setOp(we, 1, { seq: 100 })]);
    applyOps(db, [op({ type: "delete_set", setId: `${we.id}:1:-`, seq: 200 })]);
    expect(bundle().sets).toHaveLength(0);
    expect(applyOps(db, [setOp(we, 1, { seq: 150 })])[0].status).toBe("stale");
    expect(bundle().sets).toHaveLength(0);
    expect(applyOps(db, [setOp(we, 1, { seq: 250 })])[0].status).toBe("ok");
    expect(bundle().sets).toHaveLength(1);
  });
  it("handles timed and per-side sets, and rejects invalid combinations without blocking others", () => {
    start();
    const ex = bundle().exercises;
    const plank = ex[5]; // seconds, per side
    const stepUp = ex[3]; // reps, per side
    const results = applyOps(db, [
      op({ type: "upsert_set", setId: "p1", weId: plank.id, exerciseId: plank.exercise_id, setNumber: 1, side: "left", reps: null, durationSeconds: 30, weightKg: null, rir: null }),
      op({ type: "upsert_set", setId: "p2", weId: plank.id, exerciseId: plank.exercise_id, setNumber: 1, side: "right", reps: null, durationSeconds: 28, weightKg: null, rir: null }),
      op({ type: "upsert_set", setId: "bad1", weId: plank.id, exerciseId: plank.exercise_id, setNumber: 2, side: "left", reps: null, durationSeconds: 30, weightKg: 5, rir: null }),
      op({ type: "upsert_set", setId: "bad2", weId: stepUp.id, exerciseId: stepUp.exercise_id, setNumber: 1, side: null, reps: 8, durationSeconds: null, weightKg: 8, rir: 2 }),
      op({ type: "upsert_set", setId: "s1", weId: stepUp.id, exerciseId: stepUp.exercise_id, setNumber: 1, side: "left", reps: 8, durationSeconds: null, weightKg: 8, rir: 2 }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["ok", "ok", "rejected", "rejected", "ok"]);
    expect(results[2].error).toBeTruthy();
    expect(bundle().sets.map((s) => s.id).sort()).toEqual(["p1", "p2", "s1"]);
  });
  it("rejects a different id claiming an occupied set position", () => {
    start();
    const we = bundle().exercises[0];
    applyOps(db, [setOp(we, 1)]);
    const r = applyOps(db, [op({ ...setOp(we, 1), setId: "other-id" })]);
    expect(r[0].status).toBe("rejected");
  });
  it("rejects malformed ops and unknown workouts individually", () => {
    start();
    const r = applyOps(db, [{ opId: "x", type: "nope" }, op({ type: "set_notes", notes: "ok" }), { ...op({ type: "set_notes", notes: "n" }), workoutId: "22222222-2222-4222-8222-222222222222" }]);
    expect(r.map((x) => x.status)).toEqual(["rejected", "ok", "rejected"]);
    expect(bundle().workout.notes).toBe("ok");
  });
  it("swaps an exercise for this workout only; history of the replacement is available", () => {
    start();
    const squat = bundle().exercises[0];
    const lib = bundle().library;
    const hip = lib.find((l) => l.name === "Hip thrust")!;
    // History for hip thrust from an earlier finished workout
    const W0 = "33333333-3333-4333-8333-333333333333";
    createWorkout(db, { id: W0, date: "2026-11-16", session_type: "strength_a" });
    const hipWe = getBundle(db, W0)!.exercises.find((e) => e.name === "Hip thrust")!;
    db.prepare("INSERT INTO workout_sets (id, workout_id, workout_exercise_id, exercise_id, set_number, reps, weight_kg, rir) VALUES ('h1', ?, ?, ?, 1, 10, 40, 2)").run(W0, hipWe.id, hip.id);
    db.prepare("UPDATE workouts SET finished_at='2026-11-16T09:00:00.000Z' WHERE id=?").run(W0);

    expect(applyOps(db, [op({ type: "swap_exercise", weId: squat.id, exerciseId: hip.id })])[0].status).toBe("ok");
    const b = bundle();
    expect(b.exercises[0]).toMatchObject({ name: "Hip thrust", exercise_id: hip.id, replaces_exercise_id: squat.exercise_id });
    expect(b.history[hip.id].sets[0]).toMatchObject({ reps: 10, weight_kg: 40 });
    // the earlier workout is untouched
    expect(getBundle(db, W0)!.exercises[0].name).toBe("Goblet box squat");
    // swapping back clears replaces
    applyOps(db, [op({ type: "swap_exercise", weId: squat.id, exerciseId: squat.exercise_id })]);
    expect(bundle().exercises[0].replaces_exercise_id).toBeNull();
  });
  it("refuses to swap a slot that already has logged sets", () => {
    start();
    const we = bundle().exercises[0];
    applyOps(db, [setOp(we, 1)]);
    const other = bundle().library.find((l) => l.name === "Hip thrust")!;
    expect(applyOps(db, [op({ type: "swap_exercise", weId: we.id, exerciseId: other.id })])[0].status).toBe("rejected");
  });
  it("history uses the latest completed workout and ignores unfinished ones", () => {
    start();
    const squat = bundle().exercises[0];
    const W1 = "44444444-4444-4444-8444-444444444444";
    createWorkout(db, { id: W1, date: "2026-11-09", session_type: "strength_a" });
    const we1 = getBundle(db, W1)!.exercises[0];
    db.prepare("INSERT INTO workout_sets (id, workout_id, workout_exercise_id, exercise_id, set_number, reps, weight_kg) VALUES ('a', ?, ?, ?, 1, 8, 16)").run(W1, we1.id, squat.exercise_id);
    expect(bundle().history[squat.exercise_id]).toBeUndefined(); // not finished yet
    db.prepare("UPDATE workouts SET finished_at='2026-11-09T09:00:00.000Z' WHERE id=?").run(W1);
    expect(bundle().history[squat.exercise_id]).toMatchObject({ date: "2026-11-09" });
  });
});
