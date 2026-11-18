import type { Metadata } from "next";
import Link from "next/link";
import { Card, inputCls, primaryBtn } from "@/components";
import { SESSION_LABELS, SESSION_TYPES } from "@/lib/plan";
import { getPlanDays } from "@/lib/queries";
import { saveWeeklyPlan } from "./actions";

export const metadata: Metadata = { title: "Weekly plan" };
export const dynamic = "force-dynamic";

const NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default async function WeeklyPlanPage({ searchParams }: PageProps<"/settings/plan">) {
  const sp = await searchParams;
  const plan = getPlanDays();
  return (
    <section className="flex flex-col gap-4">
      <Link href="/settings" className="text-accent">‹ Settings</Link>
      <h1 className="text-2xl font-bold">Weekly plan</h1>
      <p className="text-muted">Repeats every week. Dates you changed individually keep their own session.</p>
      {sp.saved && <p role="status" className="text-ok">Saved.</p>}
      <form action={saveWeeklyPlan} className="flex flex-col gap-3">
        {NAMES.map((name, i) => {
          const row = plan.find((p) => p.weekday === i + 1);
          return (
            <Card key={name} className="flex flex-col gap-2">
              <label htmlFor={`session_${i + 1}`} className="font-semibold">{name}</label>
              <select id={`session_${i + 1}`} name={`session_${i + 1}`} defaultValue={row?.session_type ?? "rest"} className={inputCls}>
                {SESSION_TYPES.map((t) => (
                  <option key={t} value={t}>{SESSION_LABELS[t]}</option>
                ))}
              </select>
              <input name={`notes_${i + 1}`} defaultValue={row?.notes ?? ""} maxLength={500} aria-label={`${name} notes`} className={inputCls} />
            </Card>
          );
        })}
        <button type="submit" className={primaryBtn}>Save weekly plan</button>
      </form>
    </section>
  );
}
