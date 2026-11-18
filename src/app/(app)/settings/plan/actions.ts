"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { SESSION_TYPES } from "@/lib/plan";

const row = z.object({ session_type: z.enum(SESSION_TYPES), notes: z.string().trim().max(500) });

/** Rewrites the recurring weekly plan. Date overrides and past workouts are untouched. */
export async function saveWeeklyPlan(formData: FormData) {
  const rows = Array.from({ length: 7 }, (_, i) =>
    row.parse({ session_type: formData.get(`session_${i + 1}`), notes: formData.get(`notes_${i + 1}`) ?? "" }),
  );
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO plan_days (weekday, session_type, notes) VALUES (?, ?, ?)
     ON CONFLICT(weekday) DO UPDATE SET session_type = excluded.session_type, notes = excluded.notes`,
  );
  db.exec("BEGIN");
  try {
    rows.forEach((r, i) => stmt.run(i + 1, r.session_type, r.notes));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  revalidatePath("/", "layout");
  redirect("/settings/plan?saved=1");
}
