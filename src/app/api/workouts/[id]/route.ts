import { z } from "zod";
import { getDb } from "@/lib/db";
import { json } from "@/lib/api";
import { getBundle } from "@/lib/workouts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/workouts/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return json({ error: "Invalid id" }, 400);
  const bundle = getBundle(getDb(), id);
  return bundle ? json(bundle) : json({ error: "Not found" }, 404);
}
