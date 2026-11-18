import { getDb } from "../db.ts";
import { recoverStale } from "./jobs.ts";
import { defaultCtx, drain } from "./worker.ts";

/**
 * Runs the Strava job queue inside the server process. Work starts immediately when something is
 * queued (kick), and a timer is set for the earliest retry (rate-limit reset, backoff). Nothing polls
 * Strava: the only wake-ups are new work arriving, a scheduled retry, and startup recovery.
 */
type State = { running: boolean; again: boolean; timer: ReturnType<typeof setTimeout> | null };
const g = globalThis as unknown as { __stravaScheduler?: State };
const state: State = (g.__stravaScheduler ??= { running: false, again: false, timer: null });
const MAX_TIMER_MS = 60 * 60_000;

export function kick(): void {
  if (state.running) {
    state.again = true;
    return;
  }
  void run();
}

async function run(): Promise<void> {
  state.running = true;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  let wake: Date | null = null;
  try {
    do {
      state.again = false;
      wake = await drain(defaultCtx(getDb()));
    } while (state.again);
  } catch (e) {
    console.error("strava worker error:", (e as Error).message);
    wake = new Date(Date.now() + 60_000); // unexpected: try again in a minute
  } finally {
    state.running = false;
  }
  if (wake) {
    const ms = Math.min(MAX_TIMER_MS, Math.max(1000, wake.getTime() - Date.now()));
    state.timer = setTimeout(() => kick(), ms);
    state.timer.unref?.();
  }
}

/** Called once at server start: puts interrupted jobs back in the queue and resumes work. */
export function startScheduler(): void {
  recoverStale(getDb(), 0); // nothing can legitimately be running at startup
  kick();
}
