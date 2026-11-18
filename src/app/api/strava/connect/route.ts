import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appUrl } from "@/lib/strava/config";
import { authorizeUrl, createState, STATE_COOKIE } from "@/lib/strava/oauth";

export const dynamic = "force-dynamic";

/** Starts Strava OAuth with an expiring single-use state that's also bound to this browser by a cookie. */
export async function GET() {
  if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/settings?strava=not_configured", appUrl()));
  }
  const state = createState(getDb());
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: appUrl().startsWith("https://"), path: "/api/strava", maxAge: 600 });
  return res;
}
