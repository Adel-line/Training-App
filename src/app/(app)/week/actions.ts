"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { isValidDate, SESSION_TYPES } from "@/lib/plan";

const date = z.string().refine(isValidDate, "Invalid date");
const overrideSchema = z.object({
  date,
  session_type: z.enum(SESSION_TYPES),
  notes: z.string().trim().max(500),
});

export async function saveOverride(formData: FormData) {
  const parsed = overrideSchema.parse({
    date: formData.get("date"),
    session_type: formData.get("session_type"),
    notes: formData.get("notes") ?? "",
  });
  getDb()
    .prepare(
      `INSERT INTO plan_day_overrides (date, session_type, notes) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET session_type = excluded.session_type, notes = excluded.notes`,
    )
    .run(parsed.date, parsed.session_type, parsed.notes);
  revalidatePath("/", "layout");
  redirect(`/week/${parsed.date}`);
}

export async function removeOverride(formData: FormData) {
  const d = date.parse(formData.get("date"));
  getDb().prepare("DELETE FROM plan_day_overrides WHERE date = ?").run(d);
  revalidatePath("/", "layout");
  redirect(`/week/${d}`);
}
