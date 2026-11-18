import { NextResponse } from "next/server";

export const noStore = { "Cache-Control": "no-store" } as const;

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * There is no login (access is limited by the private network), so state-changing
 * endpoints require a JSON content type. Browsers can't send that cross-site without
 * a CORS preflight, which these routes never approve, so other websites can't POST here.
 */
export function requireJson(request: Request): NextResponse | null {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) return json({ error: "Expected application/json" }, 415);
  return null;
}
