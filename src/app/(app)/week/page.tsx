import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components";
import { addDays, localDate } from "@/lib/dates";
import { isTestWeek, isValidDate, resolveDay, SESSION_LABELS, weekDates } from "@/lib/plan";
import { finishedWorkouts, getOverrides, getPlanDays } from "@/lib/queries";

export const metadata: Metadata = { title: "Week" };
export const dynamic = "force-dynamic";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function WeekPage({ searchParams }: PageProps<"/week">) {
  const sp = await searchParams;
  const requested = typeof sp.d === "string" && isValidDate(sp.d) ? sp.d : localDate();
  const dates = weekDates(requested);
  const today = localDate();
  const planDays = getPlanDays();
  const overrides = getOverrides(dates[0], dates[6]);
  const done = finishedWorkouts(dates[0], dates[6]);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Week</h1>
        <div className="flex gap-1">
          <Link href={`/week?d=${addDays(dates[0], -7)}`} aria-label="Previous week" className="tap flex items-center justify-center rounded-xl border border-line px-3">
            ‹
          </Link>
          <Link href="/week" className="tap flex items-center justify-center rounded-xl border border-line px-3 text-sm">
            This week
          </Link>
          <Link href={`/week?d=${addDays(dates[0], 7)}`} aria-label="Next week" className="tap flex items-center justify-center rounded-xl border border-line px-3">
            ›
          </Link>
        </div>
      </header>
      {isTestWeek(dates[0]) && <p className="text-warn">Test week: find your starting weights.</p>}

      <ul className="flex flex-col gap-2">
        {dates.map((date, i) => {
          const day = resolveDay(date, planDays, overrides);
          const finished = done.filter((w) => w.date === date);
          return (
            <li key={date}>
              <Link href={`/week/${date}`}>
                <Card className={`flex items-center gap-3 ${date === today ? "border-accent" : ""}`}>
                  <div className="w-12 text-center">
                    <p className="text-xs text-muted">{DOW[i]}</p>
                    <p className="text-lg font-semibold">{Number(date.slice(8))}</p>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">
                      {day.sessionType ? SESSION_LABELS[day.sessionType] : "Nothing planned"}
                      {day.source === "override" && <span className="ml-2 text-xs text-warn">changed</span>}
                    </p>
                    {day.notes && <p className="text-sm text-muted">{day.notes}</p>}
                    {finished.length > 0 && (
                      <p className="mt-1 text-sm text-ok">✓ Completed: {finished.map((w) => SESSION_LABELS[w.session_type as keyof typeof SESSION_LABELS]).join(", ")}</p>
                    )}
                  </div>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
