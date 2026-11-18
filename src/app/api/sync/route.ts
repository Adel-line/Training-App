import { getDb } from "@/lib/db";
import { json, requireJson } from "@/lib/api";
import { applyOps, syncBodySchema } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** Applies a batch of queued client edits. Always 200 with per-operation results unless the batch itself is unusable. */
export async function POST(request: Request) {
  const bad = requireJson(request);
  if (bad) return bad;
  const body = syncBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "Invalid request" }, 400);
  try {
    return json({ results: applyOps(getDb(), body.data.ops) });
  } catch (e) {
    console.error("sync failed", (e as Error).message);
    return json({ error: "Server error" }, 500);
  }
}
