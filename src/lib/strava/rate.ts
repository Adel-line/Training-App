/**
 * Strava rate limits (docs: 15-minute window resets at :00/:15/:30/:45, daily window at midnight UTC;
 * exceeding either returns 429; usage is reported in X-ReadRateLimit-* / X-RateLimit-* headers as "15min,day").
 */
export type RateInfo = { limit15: number; limitDay: number; use15: number; useDay: number };

const pair = (v: string | null): [number, number] | null => {
  if (!v) return null;
  const [a, b] = v.split(",").map((x) => Number(x.trim()));
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
};

export function parseRate(h: Headers): RateInfo | null {
  // Reads are governed by the "read" limits when reported, otherwise the overall limits.
  const limit = pair(h.get("x-readratelimit-limit")) ?? pair(h.get("x-ratelimit-limit"));
  const usage = pair(h.get("x-readratelimit-usage")) ?? pair(h.get("x-ratelimit-usage"));
  if (!limit || !usage) return null;
  return { limit15: limit[0], limitDay: limit[1], use15: usage[0], useDay: usage[1] };
}

export function nextQuarterHour(now: Date): Date {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15 + 15);
  return d;
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

const SLACK_MS = 5_000; // small margin past the window boundary

/** When a request that got 429 may be retried: after the daily reset if the daily limit is spent, else the next 15-minute boundary. */
export function retryAfter429(h: Headers, now: Date): Date {
  const r = parseRate(h);
  const target = r && r.useDay >= r.limitDay ? nextUtcMidnight(now) : nextQuarterHour(now);
  return new Date(target.getTime() + SLACK_MS);
}

/** True when the short window is (almost) used up: wait for the next boundary instead of provoking a 429. */
export function shouldPause(r: RateInfo | null): boolean {
  return !!r && (r.use15 >= r.limit15 - 1 || r.useDay >= r.limitDay - 1);
}

export function pauseUntil(r: RateInfo, now: Date): Date {
  const target = r.useDay >= r.limitDay - 1 ? nextUtcMidnight(now) : nextQuarterHour(now);
  return new Date(target.getTime() + SLACK_MS);
}
