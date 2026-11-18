import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "./idb";
import * as store from "./store";
import { flush } from "./sync";
import type { WorkoutBundle } from "../workouts";

const W = "11111111-1111-4111-8111-111111111111";
const bundle: WorkoutBundle = {
  workout: { id: W, date: "2026-11-23", session_type: "strength_a", notes: "", started_at: "2026-11-23T08:00:00Z", finished_at: null },
  exercises: [{ id: "we1", position: 1, exercise_id: "ex1", replaces_exercise_id: null, name: "Squat", measurement_type: "reps", per_side: 0, sets: 3, target_min: 8, target_max: 10, increment_kg: 2 }],
  sets: [],
  library: [
    { id: "ex1", name: "Squat", muscle_group: "", measurement_type: "reps", per_side: 0, default_sets: 3, default_min: 8, default_max: 10, increment_kg: 2 },
    { id: "ex2", name: "Hip thrust", muscle_group: "", measurement_type: "reps", per_side: 0, default_sets: 3, default_min: 10, default_max: 12, increment_kg: 2 },
  ],
  history: {},
};
const mk = (n: number, reps: number) => ({ workoutId: W, weId: "we1", exerciseId: "ex1", setNumber: n, side: null, reps, durationSeconds: null, weightKg: 20, rir: 2 });

type Handler = (ops: { opId: string; seq: number; type: string }[]) => Response | Promise<Response>;
const okAll: Handler = (ops) => Response.json({ results: ops.map((o) => ({ opId: o.opId, status: "ok" })) });
const mockFetch = (h: Handler) => vi.fn(async (_u: unknown, init?: RequestInit) => h(JSON.parse(String(init!.body)).ops)) as unknown as typeof fetch;

beforeEach(async () => {
  await closeDb();
  await new Promise<void>((res) => {
    const r = indexedDB.deleteDatabase("training-offline");
    r.onsuccess = r.onerror = () => res();
  });
  await store.hydrate(bundle);
});

describe("local store", () => {
  it("a set is saved on device with a stable id and queued in one step", async () => {
    const s = await store.saveSet(mk(1, 8));
    expect(s.id).toBe("we1:1:-");
    expect(await store.listSets(W)).toHaveLength(1);
    expect((await store.listOutbox()).map((o) => o.entity)).toEqual(["set:we1:1:-"]);
  });
  it("editing the same set replaces the queued op instead of stacking", async () => {
    await store.saveSet(mk(1, 8));
    await store.saveSet(mk(1, 9));
    const q = await store.listOutbox();
    expect(q).toHaveLength(1);
    expect(q[0].payload).toMatchObject({ reps: 9 });
  });
  it("sequence numbers always increase, even if the clock goes backwards", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await store.saveSet(mk(1, 8));
    vi.spyOn(Date, "now").mockReturnValue(500);
    await store.saveSet(mk(2, 8));
    vi.restoreAllMocks();
    const [a, b] = await store.listOutbox();
    expect(b.seq).toBeGreaterThan(a.seq);
  });
  it("hydrating again keeps local edits but refreshes reference data", async () => {
    await store.saveSet(mk(1, 8));
    await store.setNotes(W, "felt good");
    await store.hydrate({ ...bundle, history: { ex1: { date: "2026-11-16", sets: [] } } });
    expect((await store.getWorkout(W))!.workout.notes).toBe("felt good");
    expect((await store.getWorkout(W))!.history.ex1.date).toBe("2026-11-16");
    expect(await store.listSets(W)).toHaveLength(1);
  });
  it("logging a set clears its draft; drafts survive otherwise", async () => {
    await store.saveDraft({ key: "we1:1:-", workoutId: W, reps: 9, weightKg: 22 });
    expect(await store.listDrafts(W)).toHaveLength(1);
    await store.saveSet(mk(1, 9));
    expect(await store.listDrafts(W)).toHaveLength(0);
  });
  it("swap updates the local snapshot and queues an op", async () => {
    await store.swapExercise(W, "we1", bundle.library[1]);
    const w = (await store.getWorkout(W))!;
    expect(w.exercises[0]).toMatchObject({ name: "Hip thrust", exercise_id: "ex2", replaces_exercise_id: "ex1", target_max: 12 });
    expect((await store.listOutbox())[0].payload.type).toBe("swap_exercise");
  });
  it("lists only unfinished workouts for the resume list", async () => {
    expect(await store.listOpenWorkouts()).toHaveLength(1);
    await store.setFinished(W, "2026-11-23T09:00:00.000Z");
    expect(await store.listOpenWorkouts()).toHaveLength(0);
  });
});

describe("flush", () => {
  it("sends queued edits in order and empties the queue on success", async () => {
    await store.saveSet(mk(1, 8));
    await store.saveSet(mk(2, 8));
    await store.setFinished(W, "2026-11-23T09:00:00.000Z");
    const f = mockFetch(okAll);
    expect(await flush(f)).toBe("idle");
    const sent = JSON.parse(String((f as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0][1].body)).ops;
    expect(sent.map((o: { type: string }) => o.type)).toEqual(["upsert_set", "upsert_set", "set_finished"]);
    expect(await store.listOutbox()).toHaveLength(0);
  });
  it("keeps everything when offline and delivers once back online, without duplicates", async () => {
    await store.saveSet(mk(1, 8));
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await flush(offline)).toBe("network");
    expect(await store.listOutbox()).toHaveLength(1);
    await store.saveSet(mk(1, 9)); // edited while offline: still one op
    expect(await store.listOutbox()).toHaveLength(1);
    const f = mockFetch(okAll);
    await flush(f);
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
    expect(await store.listOutbox()).toHaveLength(0);
  });
  it("marks rejected ops as needing attention and lets the user retry or discard them", async () => {
    await store.saveSet(mk(1, 8));
    await store.saveSet(mk(2, 8));
    const reject: Handler = (ops) => Response.json({ results: ops.map((o, i) => (i === 0 ? { opId: o.opId, status: "rejected", error: "nope" } : { opId: o.opId, status: "ok" })) });
    await flush(mockFetch(reject));
    const s = await store.summary();
    expect(s.pending).toBe(0);
    expect(s.rejected).toHaveLength(1);
    expect(s.rejected[0].error).toBe("nope");

    await store.retryOp(s.rejected[0].seq);
    expect((await store.summary()).pending).toBe(1);
    await flush(mockFetch(reject));
    const again = (await store.summary()).rejected[0];
    await store.discardOp(again);
    expect(await store.listOutbox()).toHaveLength(0);
    expect((await store.listSets(W)).map((x) => x.setNumber)).toEqual([2]); // discarded set removed locally
  });
  it("backs off on server errors and gives up after repeated failures", async () => {
    await store.saveSet(mk(1, 8));
    expect(await flush(mockFetch(() => new Response("x", { status: 503 })))).toBe("server");
    const [op] = await store.listOutbox();
    expect(op.attempts).toBe(1);
    expect(op.status).toBe("pending");
    expect(op.nextAttemptAt).toBeGreaterThan(Date.now());
    await store.updateOp(op.seq, { attempts: 9, nextAttemptAt: 0 });
    await flush(mockFetch(() => new Response("x", { status: 503 })));
    expect((await store.listOutbox())[0].status).toBe("rejected");
  });
  it("an edit made while a send is in flight is not lost", async () => {
    await store.saveSet(mk(1, 8));
    let edited = false;
    const slow: Handler = async (ops) => {
      if (!edited) {
        edited = true;
        await store.saveSet(mk(1, 10)); // newer edit lands mid-flight
      }
      return okAll(ops);
    };
    const f = mockFetch(slow);
    await flush(f);
    // the flush loop picks the newer edit up and delivers it too
    const calls = (f as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls;
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1][1].body)).ops[0]).toMatchObject({ type: "upsert_set", reps: 10 });
    expect(await store.listOutbox()).toHaveLength(0);
  });
  it("concurrent flush calls share one run", async () => {
    await store.saveSet(mk(1, 8));
    const f = mockFetch(okAll);
    await Promise.all([flush(f), flush(f), flush(f)]);
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});
