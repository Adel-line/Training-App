import type { DatabaseSync } from "node:sqlite";
import { stravaBase, stravaCredentials } from "./config.ts";
import { NotConnectedError, StravaAuthError, TransientError } from "./errors.ts";

export type TokenRow = {
  athlete_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  connected_at: string;
  refresh_lease_until: number;
};

export const getTokenRow = (db: DatabaseSync) => db.prepare("SELECT * FROM strava_tokens WHERE id = 1").get() as TokenRow | undefined;

const REFRESH_MARGIN_S = 5 * 60;
const LEASE_S = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Clock = () => number; // epoch ms

/**
 * Returns a valid access token, refreshing first when it's within five minutes of expiry.
 *
 * Strava rotates the refresh token on every refresh and invalidates the old one, so two concurrent
 * refreshes could lose the new token. A short database lease means only one caller (across tabs and
 * processes) refreshes; everyone else waits and then reads the result. Both tokens are saved in a
 * single UPDATE, and only if the refresh token is still the one we refreshed from.
 */
export async function getAccessToken(db: DatabaseSync, fetchImpl: typeof fetch = fetch, now: Clock = Date.now): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const row = getTokenRow(db);
    if (!row) throw new NotConnectedError();
    const nowS = Math.floor(now() / 1000);
    if (row.expires_at - nowS > REFRESH_MARGIN_S) return row.access_token;

    const lease = db
      .prepare("UPDATE strava_tokens SET refresh_lease_until = ? WHERE id = 1 AND refresh_lease_until < ? AND refresh_token = ?")
      .run(nowS + LEASE_S, nowS, row.refresh_token);
    if (Number(lease.changes) !== 1) {
      await sleep(200); // someone else is refreshing, or the token just changed: look again
      continue;
    }
    try {
      const { clientId, clientSecret } = stravaCredentials();
      let res: Response;
      try {
        res = await fetchImpl(`${stravaBase()}/api/v3/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: row.refresh_token }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new TransientError("Could not reach Strava to refresh the token");
      }
      if (res.status === 400 || res.status === 401) throw new StravaAuthError("Strava refused to refresh the token. Reconnect Strava in Settings.");
      if (!res.ok) throw new TransientError(`Token refresh failed (${res.status})`);
      const t = (await res.json()) as { access_token?: string; refresh_token?: string; expires_at?: number };
      if (!t.access_token || !t.refresh_token || !t.expires_at) throw new TransientError("Unexpected token response");
      const saved = db
        .prepare(
          `UPDATE strava_tokens SET access_token = ?, refresh_token = ?, expires_at = ?, refresh_lease_until = 0,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1 AND refresh_token = ?`,
        )
        .run(t.access_token, t.refresh_token, t.expires_at, row.refresh_token);
      if (Number(saved.changes) !== 1) continue; // disconnected or reconnected meanwhile: start over
      return t.access_token;
    } catch (e) {
      db.prepare("UPDATE strava_tokens SET refresh_lease_until = 0 WHERE id = 1 AND refresh_token = ?").run(row.refresh_token);
      throw e;
    }
  }
  throw new TransientError("Timed out waiting for a token refresh");
}
