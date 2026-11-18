import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/strava/config";
import { saveConnection } from "@/lib/strava/connection";
import { consumeState, exchangeCode, hasActivityAccess, parseScopes, STATE_COOKIE } from "@/lib/strava/oauth";
import { kick } from "@/lib/strava/scheduler";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const back = (code: string) => {
    const res = NextResponse.redirect(new URL(`/settings?strava=${code}`, appUrl()));
    res.cookies.set(STATE_COOKIE, "", { path: "/api/strava", maxAge: 0 });
    return res;
  };
  const q = request.nextUrl.searchParams;
  const db = getDb();
  const cookieState = (await cookies()).get(STATE_COOKIE)?.value;

  // The state must be valid before anything else is trusted (including an "access_denied" answer).
  if (!consumeState(db, q.get("state"), cookieState)) return back("bad_state");
  if (q.get("error")) return back("denied");
  const code = q.get("code");
  const scopes = parseScopes(q.get("scope"));
  if (!code) return back("error");
  if (!hasActivityAccess(scopes)) return back("scope"); // the athlete unchecked activity access

  try {
    const t = await exchangeCode(code);
    saveConnection(db, { athleteId: t.athleteId, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, scope: t.scope ?? scopes.join(",") });
  } catch (e) {
    console.error("strava connect failed:", (e as Error).message);
    return back("error");
  }
  kick(); // the 90-day backfill starts now
  return back("connected");
}
