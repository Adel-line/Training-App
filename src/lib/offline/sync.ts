import { listOutbox, notify, removeOp, updateOp, type OutboxOp } from "./store";

const BATCH = 50;
const MAX_SERVER_ATTEMPTS = 10;
export const backoffMs = (attempts: number) => Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));

type WireResult = { opId: string; status: "ok" | "stale" | "rejected" | "retry"; error?: string };

function toWire(op: OutboxOp) {
  return { opId: op.opId, seq: op.seq, workoutId: op.workoutId, ...op.payload };
}

let running: Promise<FlushOutcome> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export type FlushOutcome = "idle" | "network" | "server" | "partial";

/** Sends everything that is due. Single-flight: concurrent callers share the run in progress. */
export function flush(fetchImpl: typeof fetch = fetch): Promise<FlushOutcome> {
  if (!running) running = run(fetchImpl).finally(() => (running = null));
  return running;
}

async function run(fetchImpl: typeof fetch): Promise<FlushOutcome> {
  let outcome: FlushOutcome = "idle";
  for (;;) {
    const now = Date.now();
    const due = (await listOutbox()).filter((o) => o.status === "pending" && o.nextAttemptAt <= now).slice(0, BATCH);
    if (due.length === 0) break;

    let resp: Response;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15_000);
      resp = await fetchImpl("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops: due.map(toWire) }),
        signal: ctl.signal,
        cache: "no-store",
      });
      clearTimeout(t);
    } catch {
      // Offline or server unreachable: keep everything queued; not an error and not counted.
      scheduleRetry(2000);
      return "network";
    }

    if (!resp.ok) {
      if (resp.status >= 500 || resp.status === 429 || resp.status === 408) {
        await Promise.all(due.map((o) => bump(o, `Server error (${resp.status})`)));
        outcome = "server";
        break;
      }
      await Promise.all(due.map((o) => updateOp(o.seq, { status: "rejected", error: `The server refused the change (${resp.status}).` })));
      outcome = "partial";
      continue;
    }

    const { results } = (await resp.json()) as { results: WireResult[] };
    for (let i = 0; i < due.length; i++) {
      const op = due[i];
      const r = results[i];
      if (!r || r.opId !== op.opId) {
        outcome = "server";
        await bump(op, "Unexpected server response");
      } else if (r.status === "ok" || r.status === "stale") {
        await removeOp(op.seq);
      } else if (r.status === "rejected") {
        outcome = outcome === "server" ? outcome : "partial";
        await updateOp(op.seq, { status: "rejected", error: r.error ?? "Rejected by the server." });
      } else {
        outcome = "server";
        await bump(op, r.error ?? "Temporary server problem");
      }
    }
    if (outcome === "server") break;
  }
  const left = (await listOutbox()).filter((o) => o.status === "pending");
  if (left.length > 0) {
    const next = Math.min(...left.map((o) => o.nextAttemptAt));
    scheduleRetry(Math.max(1000, next - Date.now()));
  }
  notify();
  return outcome;
}

async function bump(op: OutboxOp, error: string) {
  const attempts = op.attempts + 1;
  if (attempts >= MAX_SERVER_ATTEMPTS) return updateOp(op.seq, { status: "rejected", attempts, error: `${error}. Gave up after ${attempts} tries.` });
  return updateOp(op.seq, { attempts, nextAttemptAt: Date.now() + backoffMs(attempts), error });
}

function scheduleRetry(ms: number) {
  if (typeof window === "undefined") return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), ms);
}

/** Debounced trigger after a local edit. */
let debounce: ReturnType<typeof setTimeout> | null = null;
export function requestSync(delay = 300) {
  if (typeof window === "undefined") return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void flush(), delay);
}

/** Retry when the app opens, comes back to the foreground, or connectivity returns. Returns a cleanup function. */
export function startSyncTriggers(): () => void {
  const go = () => void flush();
  const vis = () => document.visibilityState === "visible" && go();
  window.addEventListener("online", go);
  window.addEventListener("focus", go);
  document.addEventListener("visibilitychange", vis);
  go();
  return () => {
    window.removeEventListener("online", go);
    window.removeEventListener("focus", go);
    document.removeEventListener("visibilitychange", vis);
  };
}
