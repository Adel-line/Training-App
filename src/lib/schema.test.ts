import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, runSeed, seedOnce } from "./db";

let db: DatabaseSync;
const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
});

describe("seed", () => {
  it("runs twice without duplicating rows", () => {
    runSeed(db);
    const before = ["plan_days", "phases", "targets", "exercises", "session_templates"].map(count);
    runSeed(db);
    expect(["plan_days", "phases", "targets", "exercises", "session_templates"].map(count)).toEqual(before);
    expect(before).toEqual([7, 4, 1, 12, 12]);
  });
  it("does not overwrite user edits on rerun", () => {
    runSeed(db);
    db.prepare("UPDATE plan_days SET session_type='rest', notes='mine' WHERE weekday=1").run();
    db.prepare("UPDATE exercises SET increment_kg=2.5 WHERE name='Hip thrust'").run();
    runSeed(db);
    expect(db.prepare("SELECT session_type, notes FROM plan_days WHERE weekday=1").get()).toMatchObject({ session_type: "rest", notes: "mine" });
    expect(db.prepare("SELECT increment_kg FROM exercises WHERE name='Hip thrust'").get()).toMatchObject({ increment_kg: 2.5 });
  });
  it("seedOnce respects later deletions", () => {
    seedOnce(db);
    db.prepare("DELETE FROM plan_days WHERE weekday=7").run();
    seedOnce(db);
    expect(count("plan_days")).toBe(6);
  });
  it("seeds the specified plan", () => {
    runSeed(db);
    expect(db.prepare("SELECT protein_g_min a, protein_g_max b, kcal_target k FROM targets").get()).toMatchObject({ a: 110, b: 130, k: null });
    expect(db.prepare("SELECT session_type s FROM plan_days WHERE weekday=6").get()).toMatchObject({ s: "long_day" });
    const timed = db.prepare("SELECT measurement_type m, per_side p, increment_kg i FROM exercises WHERE name='Side plank'").get();
    expect(timed).toMatchObject({ m: "seconds", p: 1, i: null });
  });
});

describe("constraints", () => {
  it("rejects overlapping phases, allows adjacent ones", () => {
    db.prepare("INSERT INTO phases (name,start_date,end_date,calorie_mode) VALUES ('a','2026-01-01','2026-01-14','baseline')").run();
    expect(() => db.prepare("INSERT INTO phases (name,start_date,end_date,calorie_mode) VALUES ('b','2026-01-14','2026-01-20','deficit')").run()).toThrow(/overlap/);
    db.prepare("INSERT INTO phases (name,start_date,end_date,calorie_mode) VALUES ('b','2026-01-15','2026-01-20','deficit')").run();
    expect(() => db.prepare("UPDATE phases SET start_date='2026-01-10' WHERE name='b'").run()).toThrow(/overlap/);
  });
  it("allows one override per date and rejects invalid dates", () => {
    db.prepare("INSERT INTO plan_day_overrides (date,session_type) VALUES ('2026-12-01','rest')").run();
    expect(() => db.prepare("INSERT INTO plan_day_overrides (date,session_type) VALUES ('2026-12-01','easy_run')").run()).toThrow();
    expect(() => db.prepare("INSERT INTO plan_day_overrides (date,session_type) VALUES ('2026-13-01','rest')").run()).toThrow();
  });
  it("one weigh-in per date; one weekday entry per weekday", () => {
    db.prepare("INSERT INTO weigh_ins (date,weight_kg) VALUES ('2026-11-23',60)").run();
    expect(() => db.prepare("INSERT INTO weigh_ins (date,weight_kg) VALUES ('2026-11-23',61)").run()).toThrow();
    db.prepare("INSERT INTO plan_days (weekday,session_type) VALUES (1,'rest')").run();
    expect(() => db.prepare("INSERT INTO plan_days (weekday,session_type) VALUES (1,'rest')").run()).toThrow();
  });
});

describe("workout sets", () => {
  function setup(type: "reps" | "seconds", perSide: 0 | 1) {
    runSeed(db);
    const ex = db.prepare("SELECT id FROM exercises LIMIT 1").get() as { id: string };
    db.prepare("INSERT INTO workouts (id,date,session_type,started_at) VALUES ('w','2026-11-23','strength_a','2026-11-23T08:00:00Z')").run();
    db.prepare("INSERT INTO workout_exercises (id,workout_id,position,exercise_id,name,measurement_type,per_side,sets,target_min,target_max) VALUES ('we','w',1,?,'x',?,?,3,8,10)").run(ex.id, type, perSide);
    return ex.id;
  }
  const ins = (exId: string, f: Record<string, unknown>) =>
    db.prepare("INSERT INTO workout_sets (id,workout_id,workout_exercise_id,exercise_id,set_number,side,reps,duration_seconds,weight_kg,rir) VALUES (?, 'w','we',?,?,?,?,?,?,?)")
      .run(f.id as string, exId, (f.n as number) ?? 1, (f.side as string) ?? null, (f.reps as number) ?? null, (f.dur as number) ?? null, (f.kg as number) ?? null, (f.rir as number) ?? null);
  let exId = "";

  it("accepts valid reps sets with or without weight, enforces RIR 0–4", () => {
    exId = setup("reps", 0);
    ins(exId, { id: "s1", n: 1, reps: 8, kg: 20, rir: 2 });
    ins(exId, { id: "s2", n: 2, reps: 8 });
    expect(() => ins(exId, { id: "s3", n: 3, reps: 8, rir: 5 })).toThrow();
  });
  it("rejects duplicates of the same logical set but allows the other side", () => {
    exId = setup("reps", 1);
    ins(exId, { id: "a", side: "left", reps: 8 });
    expect(() => ins(exId, { id: "b", side: "left", reps: 9 })).toThrow();
    ins(exId, { id: "c", side: "right", reps: 8 });
  });
  it("requires a side iff the exercise is per-side", () => {
    exId = setup("reps", 1);
    expect(() => ins(exId, { id: "a", reps: 8 })).toThrow(/does not match/);
    exId = "";
  });
  it("timed sets need a duration and no weight; reps sets need no duration", () => {
    exId = setup("seconds", 0);
    expect(() => ins(exId, { id: "a", reps: 30 })).toThrow();
    expect(() => ins(exId, { id: "b", dur: 30, kg: 5 })).toThrow();
    ins(exId, { id: "c", dur: 30 });
  });
  it("template edits leave a started workout's snapshot intact", () => {
    exId = setup("reps", 0);
    db.prepare("UPDATE exercises SET name='Renamed', default_max=20 WHERE id=?").run(exId);
    expect(db.prepare("SELECT name, target_max FROM workout_exercises WHERE id='we'").get()).toMatchObject({ name: "x", target_max: 10 });
  });
});
