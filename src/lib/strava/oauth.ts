import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { appUrl, safeEqual, stravaBase, stravaCredentials } from "./config.ts";
import { StravaAuthError, TransientError } from "./errors.ts";

export const SCOPES = "read,activity:read_all";
export const STATE_COOKIE = "strava_oauth_state";
const STATE_TTL_S = 10 * 60;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** New single-use state, valid ten minutes. The raw value goes in a cookie; only its hash is stored. */
export function createState(db: DatabaseSync, now = new Date()): string {
  const nowS = Math.floor(now.getTime() / 1000);
  db.prepare("DELETE FROM strava_oauth_states WHERE expires_at < ?").run(nowS);
  const state = randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO strava_oauth_states (state_hash, expires_at) VALUES (?, ?)").run(sha(state), nowS + STATE_TTL_S);
  return state;
}

/** True once per state: must match the browser's cookie, be unexpired and unused. */
export function consumeState(db: DatabaseSync, state: string | null, cookie: string | undefined, now = new Date()): boolean {
  if (!state || !cookie || !safeEqual(state, cookie)) return false;
  const nowS = Math.floor(now.getTime() / 1000);
  const r = db
    .prepare("UPDATE strava_oauth_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL AND expires_at >= ?")
    .run(nowS, sha(state), nowS);
  return Number(r.changes) === 1;
}

export function authorizeUrl(state: string): string {
  const { clientId } = stravaCredentials();
  const u = new URL(`${stravaBase()}/oauth/authorize`);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", `${appUrl()}/api/strava/callback`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("approval_prompt", "auto");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", state);
  return u.toString();
}

/** Scopes come back comma- or space-separated; the athlete may have unchecked some. */
export const parseScopes = (s: string | null | undefined) => (s ?? "").split(/[,\s]+/).filter(Boolean);
export const hasActivityAccess = (scopes: string[]) => scopes.includes("activity:read_all") || scopes.includes("activity:read");

export async function exchangeCode(code: string, fetchImpl: typeof fetch = fetch) {
  const { clientId, clientSecret } = stravaCredentials();
  let res: Response;
  try {
    res = await fetchImpl(`${stravaBase()}/api/v3/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TransientError("Could not reach Strava");
  }
  if (res.status === 400 || res.status === 401) throw new StravaAuthError("Strava rejected the authorization code");
  if (!res.ok) throw new TransientError(`Strava token exchange failed (${res.status})`);
  const t = (await res.json()) as { access_token?: string; refresh_token?: string; expires_at?: number; athlete?: { id?: number }; scope?: string };
  if (!t.access_token || !t.refresh_token || !t.expires_at || !t.athlete?.id) throw new TransientError("Unexpected token response");
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at, athleteId: t.athlete.id, scope: t.scope };
}

/** Explicit disconnect: Strava's documented revoke endpoint (HTTP Basic with the app credentials). Returns whether Strava confirmed. */
export async function revokeAtStrava(refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const { clientId, clientSecret } = stravaCredentials();
    const res = await fetchImpl(`${stravaBase()}/oauth/revoke`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token" }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
