import { timingSafeEqual } from "node:crypto";

/** Base URL for Strava. Only overridden in tests (a local fake server). */
export const stravaBase = () => (process.env.STRAVA_BASE_URL || "https://www.strava.com").replace(/\/$/, "");

export function stravaCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are not set");
  return { clientId, clientSecret };
}

export const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const verifyToken = () => process.env.STRAVA_VERIFY_TOKEN || "";
export const webhookPort = () => Number(process.env.WEBHOOK_PORT || 3001);

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
