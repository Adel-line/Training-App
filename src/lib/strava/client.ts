import type { DatabaseSync } from "node:sqlite";
import { stravaBase } from "./config.ts";
import { RateLimitedError, StravaAuthError, TransientError } from "./errors.ts";
import { parseRate, retryAfter429, type RateInfo } from "./rate.ts";
import { getAccessToken } from "./tokens.ts";

export type ApiResult = { status: number; json: unknown; rate: RateInfo | null };
export type Api = { get(path: string, query?: Record<string, string | number>): Promise<ApiResult> };

/**
 * Authenticated GET against the Strava API (token refreshed when needed).
 * 404/403 are returned to the caller (an activity that is gone or no longer visible);
 * 401, 429 and server errors are raised as typed errors.
 */
export function makeApi(db: DatabaseSync, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Api {
  return {
    async get(path, query = {}) {
      const token = await getAccessToken(db, fetchImpl, now);
      const url = new URL(`${stravaBase()}/api/v3${path}`);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
      let res: Response;
      try {
        res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
      } catch {
        throw new TransientError("Could not reach Strava");
      }
      if (res.status === 429) throw new RateLimitedError(retryAfter429(res.headers, new Date(now())));
      if (res.status === 401) throw new StravaAuthError("Strava rejected the access token. Reconnect Strava in Settings.");
      if (res.status >= 500) throw new TransientError(`Strava error (${res.status})`);
      const rate = parseRate(res.headers);
      if (res.status === 404 || res.status === 403) return { status: res.status, json: null, rate };
      if (!res.ok) throw new TransientError(`Unexpected Strava response (${res.status})`);
      return { status: res.status, json: await res.json().catch(() => null), rate };
    },
  };
}
