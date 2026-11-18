"use client";

import { useEffect, useState } from "react";
import { formatLongDate } from "@/lib/dates";
import { listOpenWorkouts, type LocalWorkout } from "@/lib/offline/store";
import { SESSION_LABELS, type SessionType } from "@/lib/plan";

/** Workouts saved on this phone that aren't finished: reachable even with no connection. */
export function ResumeWorkouts() {
  const [open, setOpen] = useState<LocalWorkout[]>([]);
  useEffect(() => {
    let alive = true;
    listOpenWorkouts().then((w) => alive && setOpen(w)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (open.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-semibold">Saved on this phone</h2>
      {open.map((w) => (
        // Plain link on purpose: a full navigation lets the service worker serve the workout page offline.
        <a key={w.id} href={`/workout?id=${w.id}`} className="tap flex items-center rounded-xl bg-accent px-4 font-semibold text-accent-fg">
          Resume {SESSION_LABELS[w.workout.session_type as SessionType] ?? w.workout.session_type} · {formatLongDate(w.workout.date)}
        </a>
      ))}
    </div>
  );
}
