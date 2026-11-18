import { NextResponse, type NextRequest } from "next/server";
import { handleWebhookRequest } from "@/lib/strava/webhookHttp";

export const dynamic = "force-dynamic";

async function respond(request: NextRequest) {
  const r = await handleWebhookRequest(request.method, request.nextUrl.searchParams, () => request.json().catch(() => null));
  return r.json !== undefined ? NextResponse.json(r.json, { status: r.status }) : new NextResponse(r.text ?? "", { status: r.status });
}

// Strava validates the subscription with GET and pushes events with POST. (The public path to this
// handler is the separate listener in src/lib/strava/listener.ts; this route serves the same logic.)
export const GET = respond;
export const POST = respond;
