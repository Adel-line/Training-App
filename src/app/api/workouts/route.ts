import { getDb } from "@/lib/db";
import { json, requireJson } from "@/lib/api";
import { createWorkout, getBundle, startSchema } from "@/lib/workouts";

export const dynamic = "force-dynamic";

/** Start (or re-open) a workout. Idempotent on the client-generated id. */
export async function POST(request: Request) {
  const bad = requireJson(request);
  if (bad) return bad;
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const db = getDb();
  try {
    createWorkout(db, parsed.data);
  } catch (e) {
    return json({ error: (e as Error).message }, 422);
  }
  return json(getBundle(db, parsed.data.id));
}
