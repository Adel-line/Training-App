"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatLongDate } from "@/lib/dates";
import {
  deleteSet, getWorkout, hydrate, listDrafts, listSets, saveDraft, saveSet, setFinished, setNotes, slotKey, subscribe, swapExercise,
  type Draft, type LocalSet, type LocalWorkout,
} from "@/lib/offline/store";
import { requestSync } from "@/lib/offline/sync";
import { isTestWeek, SESSION_LABELS, type SessionType } from "@/lib/plan";
import type { HistoryEntry, Side, WorkoutExerciseRow } from "@/lib/workouts";
import { SyncBadge } from "./sync-badge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JSON_HEADERS = { "Content-Type": "application/json" };

type Slot = { n: number; side: Side | null };
type Values = { reps: number | null; durationSeconds: number | null; weightKg: number | null; rir: number | null };

const fmtKg = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const slotsFor = (we: WorkoutExerciseRow): Slot[] =>
  Array.from({ length: we.sets }, (_, i) => (we.per_side ? (["left", "right"] as const).map((side) => ({ n: i + 1, side })) : [{ n: i + 1, side: null }])).flat();
const sideLabel = (s: Side | null) => (s === "left" ? "Left" : s === "right" ? "Right" : "");

function summarize(v: Values, timed: boolean) {
  if (timed) return `${v.durationSeconds ?? "—"} s`;
  return `${v.reps ?? "—"} reps${v.weightKg != null ? ` × ${fmtKg(v.weightKg)} kg` : ""}${v.rir != null ? ` · RIR ${v.rir}` : ""}`;
}

function useWorkoutData(id: string | null) {
  const [data, setData] = useState<{ w: LocalWorkout; sets: LocalSet[]; drafts: Draft[] } | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = async () => {
      const w = await getWorkout(id);
      if (!w) return;
      const next = { w, sets: await listSets(id), drafts: await listDrafts(id) };
      if (alive) setData(next);
    };
    void load();
    const unsub = subscribe(() => void load());
    return () => {
      alive = false;
      unsub();
    };
  }, [id]);
  return data;
}

export function WorkoutScreen() {
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const data = useWorkoutData(ready ? id : null);

  useEffect(() => {
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const wid = q.get("id");
      if (!wid || !UUID.test(wid)) return setError("No workout selected.");
      setId(wid);
      const local = await getWorkout(wid);
      try {
        if (!local) {
          const date = q.get("date"), type = q.get("type");
          const res =
            date && type
              ? await fetch("/api/workouts", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id: wid, date, session_type: type }) })
              : await fetch(`/api/workouts/${wid}`, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await hydrate(await res.json());
        } else {
          // Refresh exercise library and history in the background; local edits stay authoritative.
          fetch(`/api/workouts/${wid}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((b) => b && hydrate(b))
            .catch(() => {});
        }
      } catch {
        if (!local) return setError("This workout isn't saved on this phone yet. Open it once while online.");
      }
      setReady(true);
      requestSync(0);
    })();
  }, []);

  if (error)
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <p className="text-danger" role="alert">{error}</p>
        <Link href="/today" className="mt-4 inline-block text-accent underline">Back to Today</Link>
      </main>
    );
  if (!data) return <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 text-muted">Loading workout…</main>;
  return <Workout w={data.w} sets={data.sets} drafts={data.drafts} />;
}

function Workout({ w, sets, drafts }: { w: LocalWorkout; sets: LocalSet[]; drafts: Draft[] }) {
  const finished = Boolean(w.workout.finished_at);
  const act = async (p: Promise<unknown>) => {
    await p;
    requestSync();
  };
  const [notes, setNotesText] = useState(w.workout.notes);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="flex items-start justify-between gap-2">
        <div>
          <Link href="/today" className="text-accent">‹ Today</Link>
          <h1 className="text-2xl font-bold">{SESSION_LABELS[w.workout.session_type as SessionType] ?? w.workout.session_type}</h1>
          <p className="text-muted">{formatLongDate(w.workout.date)}</p>
        </div>
        <SyncBadge workoutId={w.id} />
      </header>

      {isTestWeek(w.workout.date) && (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-warn">
          Test week: pick starting weights that leave about 2 reps in reserve. No progression suggestions this week.
        </p>
      )}
      {finished && (
        <div className="flex items-center justify-between rounded-xl border border-ok px-3 py-2 text-ok">
          <span>Workout finished ✓</span>
          <button type="button" className="tap px-2 underline" onClick={() => act(setFinished(w.id, null))}>Reopen</button>
        </div>
      )}

      {w.exercises.map((we) => (
        <ExerciseCard key={we.id} w={w} we={we} sets={sets.filter((s) => s.weId === we.id)} drafts={drafts} act={act} />
      ))}

      <label className="flex flex-col gap-2">
        <span className="text-sm text-muted">Workout notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotesText(e.target.value)}
          onBlur={() => notes !== w.workout.notes && act(setNotes(w.id, notes))}
          maxLength={2000}
          rows={3}
          className="rounded-xl border border-line bg-surface p-3 text-base"
        />
      </label>

      {!finished && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => act(setFinished(w.id, new Date().toISOString()))}
            className="tap mx-auto flex w-full max-w-xl items-center justify-center rounded-xl bg-accent px-4 text-lg font-semibold text-accent-fg"
          >
            Finish workout
          </button>
        </div>
      )}
    </main>
  );
}

function ExerciseCard({ w, we, sets, drafts, act }: { w: LocalWorkout; we: WorkoutExerciseRow; sets: LocalSet[]; drafts: Draft[]; act: (p: Promise<unknown>) => Promise<void> }) {
  const timed = we.measurement_type === "seconds";
  const hist: HistoryEntry | undefined = w.history[we.exercise_id];
  const [swapOpen, setSwapOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const slots = useMemo(() => slotsFor(we), [we]);
  const setOf = (s: Slot) => sets.find((x) => x.setNumber === s.n && x.side === s.side);
  const firstOpen = slots.find((s) => !setOf(s));
  const original = we.replaces_exercise_id ? w.library.find((l) => l.id === we.replaces_exercise_id)?.name : null;

  function valuesFor(s: Slot): Values & { logged: boolean } {
    const logged = setOf(s);
    if (logged) return { reps: logged.reps, durationSeconds: logged.durationSeconds, weightKg: logged.weightKg, rir: logged.rir, logged: true };
    const d = drafts.find((x) => x.key === slotKey(we.id, s.n, s.side));
    const h = hist?.sets.find((x) => x.set_number === s.n && x.side === s.side) ?? hist?.sets.find((x) => x.side === s.side);
    // Carry forward from the same side's previous set; for the first set of a side, from the other side of this set.
    const prev =
      sets.filter((x) => x.side === s.side && x.setNumber < s.n).sort((a, b) => b.setNumber - a.setNumber)[0] ??
      (s.side ? sets.find((x) => x.setNumber === s.n && x.side !== s.side) : undefined);
    return {
      reps: d?.reps !== undefined ? d.reps : (h?.reps ?? prev?.reps ?? we.target_min),
      durationSeconds: d?.durationSeconds !== undefined ? d.durationSeconds : (h?.duration_seconds ?? prev?.durationSeconds ?? we.target_min),
      weightKg: d?.weightKg !== undefined ? d.weightKg : (prev?.weightKg ?? h?.weight_kg ?? null),
      rir: d?.rir !== undefined ? d.rir : null,
      logged: false,
    };
  }

  const toLocal = (s: Slot, v: Values): Omit<LocalSet, "id"> => ({
    workoutId: w.id, weId: we.id, exerciseId: we.exercise_id, setNumber: s.n, side: s.side,
    reps: timed ? null : (v.reps ?? 0), durationSeconds: timed ? (v.durationSeconds ?? we.target_min) : null,
    weightKg: timed ? null : v.weightKg, rir: timed ? null : v.rir,
  });

  function change(s: Slot, patch: Partial<Values>) {
    const cur = valuesFor(s);
    const next = { ...cur, ...patch };
    if (cur.logged) return act(saveSet(toLocal(s, next)));
    return act(saveDraft({ key: slotKey(we.id, s.n, s.side), workoutId: w.id, reps: next.reps, durationSeconds: next.durationSeconds, weightKg: next.weightKg, rir: next.rir }));
  }

  const histFor = (s: Slot) => hist?.sets.find((x) => x.set_number === s.n && x.side === s.side);
  const step = we.increment_kg ?? 1;

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4" aria-label={we.name}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{we.name}</h2>
          <p className="text-sm text-muted">
            {we.sets} × {timed ? `${we.target_min} s` : we.target_min === we.target_max ? we.target_min : `${we.target_min}–${we.target_max}`}
            {we.per_side ? " per side" : ""}
            {hist ? ` · last ${formatLongDate(hist.date)}` : " · no history yet"}
          </p>
          {original && <p className="text-sm text-warn">Swapped in for {original}</p>}
        </div>
        <button type="button" onClick={() => setSwapOpen(true)} className="tap rounded-xl border border-line px-3 text-sm font-medium">Swap</button>
      </header>

      <ul className="mt-3 flex flex-col gap-3">
        {slots.map((s) => {
          const key = slotKey(we.id, s.n, s.side);
          const v = valuesFor(s);
          const open = expanded[key] ?? (!v.logged && firstOpen === s);
          const h = histFor(s);
          const label = `Set ${s.n}${s.side ? ` · ${sideLabel(s.side)}` : ""}`;
          return (
            <li key={key} className={`rounded-xl border p-3 ${v.logged ? "border-ok/50" : "border-line"} bg-surface-2`} data-testid={`slot-${s.n}-${s.side ?? "x"}`}>
              <button type="button" className="tap flex w-full items-center justify-between gap-2 text-left" onClick={() => setExpanded((e) => ({ ...e, [key]: !open }))} aria-expanded={open}>
                <span className="font-semibold">{v.logged && <span className="text-ok">✓ </span>}{label}</span>
                <span className="text-sm text-muted">{v.logged ? summarize(v, timed) : h ? `Last: ${summarize({ reps: h.reps, durationSeconds: h.duration_seconds, weightKg: h.weight_kg, rir: h.rir }, timed)}` : "Not logged"}</span>
              </button>
              {open && (
                <div className="mt-3 flex flex-col gap-3">
                  {h && <p className="text-sm text-muted">Last time: {summarize({ reps: h.reps, durationSeconds: h.duration_seconds, weightKg: h.weight_kg, rir: h.rir }, timed)}</p>}
                  {timed ? (
                    <Stepper label="Time" display={`${v.durationSeconds ?? 0} s`} onDec={() => change(s, { durationSeconds: Math.max(5, (v.durationSeconds ?? we.target_min) - 5) })} onInc={() => change(s, { durationSeconds: (v.durationSeconds ?? we.target_min) + 5 })} />
                  ) : (
                    <>
                      <Stepper label="Reps" display={String(v.reps ?? 0)} onDec={() => change(s, { reps: Math.max(0, (v.reps ?? 0) - 1) })} onInc={() => change(s, { reps: (v.reps ?? 0) + 1 })} />
                      <Stepper
                        label="Weight"
                        display={v.weightKg == null ? "Bodyweight" : `${fmtKg(v.weightKg)} kg`}
                        onDec={() => change(s, { weightKg: v.weightKg == null || v.weightKg - step <= 0 ? null : Math.round((v.weightKg - step) * 100) / 100 })}
                        onInc={() => change(s, { weightKg: Math.round(((v.weightKg ?? 0) + step) * 100) / 100 })}
                      />
                      <div className="flex items-center gap-2" role="group" aria-label="Reps in reserve">
                        <span className="w-16 text-sm text-muted">RIR</span>
                        {[0, 1, 2, 3, 4].map((r) => (
                          <button key={r} type="button" aria-pressed={v.rir === r} onClick={() => change(s, { rir: v.rir === r ? null : r })}
                            className={`tap flex-1 rounded-xl border text-lg font-semibold ${v.rir === r ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface"}`}>
                            {r}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {v.logged ? (
                    <button type="button" className="tap rounded-xl border border-line px-4 font-semibold" onClick={() => act(deleteSet(setOf(s)!))}>Clear this set</button>
                  ) : (
                    <button type="button" className="tap rounded-xl bg-accent px-4 text-lg font-semibold text-accent-fg" onClick={() => act(saveSet(toLocal(s, v)).then(() => setExpanded((e) => ({ ...e, [key]: false }))))}>
                      Log set
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {swapOpen && (
        <SwapSheet w={w} we={we} hasSets={sets.length > 0} onClose={() => setSwapOpen(false)} onPick={(ex) => { setSwapOpen(false); void act(swapExercise(w.id, we.id, ex)); }} />
      )}
    </section>
  );
}

function Stepper({ label, display, onDec, onInc }: { label: string; display: string; onDec: () => void; onInc: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-sm text-muted">{label}</span>
      <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} onClick={onDec} className="flex h-14 w-14 items-center justify-center rounded-xl border border-line bg-surface text-3xl">−</button>
      <output aria-label={label} className="flex-1 text-center text-xl font-semibold">{display}</output>
      <button type="button" aria-label={`Increase ${label.toLowerCase()}`} onClick={onInc} className="flex h-14 w-14 items-center justify-center rounded-xl border border-line bg-surface text-3xl">+</button>
    </div>
  );
}

function SwapSheet({ w, we, hasSets, onClose, onPick }: { w: LocalWorkout; we: WorkoutExerciseRow; hasSets: boolean; onClose: () => void; onPick: (ex: LocalWorkout["library"][number]) => void }) {
  const inUse = new Set(w.exercises.filter((e) => e.id !== we.id).map((e) => e.exercise_id));
  return (
    <div role="dialog" aria-label="Swap exercise" className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={onClose}>
      <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Swap {we.name}</h2>
          <button type="button" onClick={onClose} className="tap px-2 text-accent">Close</button>
        </div>
        <p className="mb-3 text-sm text-muted">Only changes this workout. Edit the template in Settings to change it for good.</p>
        {hasSets && <p className="mb-3 text-warn">Clear this exercise&apos;s logged sets first.</p>}
        <ul className="flex flex-col gap-2">
          {w.library.filter((l) => l.id !== we.exercise_id && !inUse.has(l.id)).map((l) => {
            const h = w.history[l.id];
            return (
              <li key={l.id}>
                <button type="button" disabled={hasSets} onClick={() => onPick(l)} className="tap flex w-full flex-col rounded-xl border border-line bg-surface-2 px-3 py-2 text-left disabled:opacity-50">
                  <span className="font-medium">{l.name}</span>
                  <span className="text-sm text-muted">
                    {l.per_side ? "per side · " : ""}{l.measurement_type === "seconds" ? "timed" : "reps"} · {h ? `last ${formatLongDate(h.date)}` : "no history"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
