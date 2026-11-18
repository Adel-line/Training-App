"use client";

import { useEffect, useState } from "react";
import { discardOp, retryOp, subscribe, summary, type OutboxOp, type SyncSummary } from "@/lib/offline/store";
import { requestSync } from "@/lib/offline/sync";

function describe(op: OutboxOp): string {
  const p = op.payload;
  switch (p.type) {
    case "upsert_set":
      return `Set ${p.setNumber}${p.side ? ` (${p.side})` : ""}: ${p.durationSeconds ? `${p.durationSeconds} s` : `${p.reps} reps${p.weightKg != null ? ` @ ${p.weightKg} kg` : ""}`}`;
    case "delete_set":
      return "Removed a set";
    case "swap_exercise":
      return "Exercise swap";
    case "set_notes":
      return "Workout notes";
    case "set_finished":
      return p.finishedAt ? "Finish workout" : "Reopen workout";
  }
}

export function SyncBadge({ workoutId }: { workoutId: string }) {
  const [s, setS] = useState<SyncSummary>({ pending: 0, rejected: [] });
  const [online, setOnline] = useState(() => navigator.onLine);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const next = await summary(workoutId);
      if (alive) setS(next);
    };
    void load();
    const unsub = subscribe(() => void load());
    return () => {
      alive = false;
      unsub();
    };
  }, [workoutId]);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);

  const attention = s.rejected.length > 0;
  const label = attention ? `Needs attention (${s.rejected.length})` : s.pending > 0 ? "Saved on device" : "Synced";
  const tone = attention ? "border-danger text-danger" : s.pending > 0 ? "border-warn text-warn" : "border-ok text-ok";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => attention && setOpen((o) => !o)}
        aria-live="polite"
        data-testid="sync-state"
        className={`tap flex items-center gap-2 rounded-full border px-3 text-sm font-medium ${tone}`}
      >
        <span aria-hidden>{attention ? "!" : s.pending > 0 ? "●" : "✓"}</span>
        {label}
        {!online && <span className="text-muted">· offline</span>}
        {s.pending > 0 && online && !attention && <span className="text-muted">· syncing</span>}
      </button>
      {open && attention && (
        <div className="absolute right-0 z-20 mt-2 w-80 max-w-[90vw] rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-lg">
          <p className="mb-2 text-sm text-muted">The server refused these changes. They are still on your phone.</p>
          <ul className="flex flex-col gap-3">
            {s.rejected.map((op) => (
              <li key={op.seq} className="rounded-lg bg-surface-2 p-3">
                <p className="font-medium">{describe(op)}</p>
                <p className="text-sm text-danger">{op.error}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="tap flex-1 rounded-lg bg-accent px-3 font-semibold text-accent-fg" onClick={async () => { await retryOp(op.seq); requestSync(0); }}>
                    Retry
                  </button>
                  <button type="button" className="tap flex-1 rounded-lg border border-line px-3 font-semibold" onClick={() => discardOp(op)}>
                    Discard
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
