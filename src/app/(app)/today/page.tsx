import type { Metadata } from "next";
import Link from "next/link";
import { Card, primaryBtn, secondaryBtn } from "@/components/ui";
import { formatLongDate, localDate } from "@/lib/dates";
import { effectiveTarget, isStrength, isTestWeek, phaseStatus, resolveDay, SESSION_LABELS } from "@/lib/plan";
import { getOverrides, getPhases, getPlanDays, getTargets, proteinOn, workoutLink } from "@/lib/queries";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default function TodayPage() {
  const today = localDate();
  const day = resolveDay(today, getPlanDays(), getOverrides(today, today));
  const status = phaseStatus(today, getPhases());
  const targets = getTargets();
  const target = effectiveTarget(today, targets);
  const upcoming = target ? null : targets.find((t) => t.effective_from > today) ?? null;
  const protein = Math.round(proteinOn(today));
  const pct = target ? Math.min(100, Math.round((protein / target.protein_g_max) * 100)) : 0;

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">Today</h1>
        <p className="mt-1 text-muted">{formatLongDate(today)}</p>
      </header>

      <Card>
        <p className="text-sm text-muted">
          Planned{day.source === "override" ? " (changed for today)" : ""}
        </p>
        <p className="mt-1 text-xl font-semibold">{day.sessionType ? SESSION_LABELS[day.sessionType] : "Nothing planned"}</p>
        {day.notes && <p className="mt-1 text-muted">{day.notes}</p>}
        <Link href={`/week/${today}`} className="mt-3 inline-block text-accent underline">
          Details / edit this day
        </Link>
      </Card>

      <Card>
        {status.kind === "active" && (
          <>
            <p className="font-semibold">
              {status.phase.name} <span className="font-normal text-muted">· {status.phase.calorie_mode}</span>
            </p>
            <p className="text-muted">{status.phase.focus}</p>
            {isTestWeek(today) && (
              <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-warn">
                Test week: choose starting weights that leave about 2 reps in reserve. No progression suggestions this week.
              </p>
            )}
          </>
        )}
        {status.kind === "before_start" && (
          <p>
            Plan starts <span className="font-semibold">{formatLongDate(status.startDate)}</span>. You can still log workouts, meals and
            weight before then.
          </p>
        )}
        {status.kind === "none" && <p className="text-muted">No phase is active today. Your weekly plan still applies.</p>}
      </Card>

      <Card>
        <div className="flex items-baseline justify-between">
          <p className="font-semibold">Protein</p>
          <p className="text-muted">
            {protein} g{target ? ` / ${target.protein_g_min}–${target.protein_g_max} g` : ""}
          </p>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        {upcoming && (
          <p className="mt-2 text-sm text-muted">
            Target {upcoming.protein_g_min}–{upcoming.protein_g_max} g starts {formatLongDate(upcoming.effective_from)}.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-3">
        {day.sessionType && isStrength(day.sessionType) && (
          <Link href={workoutLink(today, day.sessionType).href} prefetch={false} className={primaryBtn}>
            {workoutLink(today, day.sessionType).resume ? "Resume workout" : "Start workout"}
          </Link>
        )}
        <Link href="/food" className={secondaryBtn}>
          Log a meal
        </Link>
        <Link href="/food" className={secondaryBtn}>
          Log weight
        </Link>
      </div>
    </section>
  );
}
