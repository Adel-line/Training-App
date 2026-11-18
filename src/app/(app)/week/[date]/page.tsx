import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, inputCls, primaryBtn, secondaryBtn } from "@/components";
import { formatLongDate } from "@/lib/dates";
import { isTestWeek, isValidDate, phaseStatus, resolveDay, SESSION_LABELS, SESSION_TYPES } from "@/lib/plan";
import { getOverrides, getPhases, getPlanDays } from "@/lib/queries";
import { removeOverride, saveOverride } from "../actions";

export const metadata: Metadata = { title: "Day" };
export const dynamic = "force-dynamic";

export default async function DayPage({ params }: PageProps<"/week/[date]">) {
  const { date } = await params;
  if (!isValidDate(date)) notFound();
  const day = resolveDay(date, getPlanDays(), getOverrides(date, date));
  const status = phaseStatus(date, getPhases());

  return (
    <section className="flex flex-col gap-4">
      <Link href={`/week?d=${date}`} className="text-accent">
        ‹ Week
      </Link>
      <header>
        <h1 className="text-2xl font-bold">{formatLongDate(date)}</h1>
        <p className="text-muted">
          {status.kind === "active" && `${status.phase.name} · ${status.phase.calorie_mode}`}
          {status.kind === "before_start" && `Plan starts ${formatLongDate(status.startDate)}`}
          {status.kind === "none" && "No phase active"}
          {isTestWeek(date) && " · Test week"}
        </p>
      </header>

      <Card>
        <p className="text-sm text-muted">{day.source === "override" ? "Changed for this date only" : "From your weekly plan"}</p>
        <p className="mt-1 text-xl font-semibold">{day.sessionType ? SESSION_LABELS[day.sessionType] : "Nothing planned"}</p>
        {day.notes && <p className="mt-1 text-muted">{day.notes}</p>}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Edit this day</h2>
        <form action={saveOverride} className="flex flex-col gap-3">
          <input type="hidden" name="date" value={date} />
          <label className="text-sm text-muted" htmlFor="session_type">Session</label>
          <select id="session_type" name="session_type" defaultValue={day.sessionType ?? "rest"} className={inputCls}>
            {SESSION_TYPES.map((t) => (
              <option key={t} value={t}>{SESSION_LABELS[t]}</option>
            ))}
          </select>
          <label className="text-sm text-muted" htmlFor="notes">Notes</label>
          <input id="notes" name="notes" defaultValue={day.notes} maxLength={500} className={inputCls} />
          <button type="submit" className={primaryBtn}>Save for this date</button>
        </form>
        {day.source === "override" && (
          <form action={removeOverride} className="mt-3">
            <input type="hidden" name="date" value={date} />
            <button type="submit" className={`${secondaryBtn} w-full`}>Restore weekly plan for this date</button>
          </form>
        )}
        <p className="mt-3 text-sm text-muted">
          This only changes {formatLongDate(date)}. To change every week, <Link href="/settings/plan" className="text-accent underline">edit the weekly plan</Link>.
        </p>
      </Card>
    </section>
  );
}
