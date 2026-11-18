import { addDays, isoWeekday, startOfWeek } from "./dates";

export const SESSION_TYPES = [
  "strength_a",
  "strength_b",
  "easy_run",
  "quality_run",
  "bouldering",
  "long_day",
  "rest",
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const SESSION_LABELS: Record<SessionType, string> = {
  strength_a: "Strength A",
  strength_b: "Strength B",
  easy_run: "Easy run",
  quality_run: "Quality run",
  bouldering: "Bouldering",
  long_day: "Long day",
  rest: "Rest",
};

export const isStrength = (t: SessionType) => t === "strength_a" || t === "strength_b";

export type PlanDay = { weekday: number; session_type: SessionType; notes: string };
export type Override = { date: string; session_type: SessionType; notes: string };
export type Phase = { id: string; name: string; start_date: string; end_date: string; focus: string; calorie_mode: string };

export type ResolvedDay = {
  date: string;
  sessionType: SessionType | null; // null when the weekday has no recurring entry
  notes: string;
  source: "override" | "weekly" | "none";
};

/** A date-specific override wins; otherwise the recurring weekday entry. */
export function resolveDay(date: string, planDays: PlanDay[], overrides: Override[]): ResolvedDay {
  const o = overrides.find((x) => x.date === date);
  if (o) return { date, sessionType: o.session_type, notes: o.notes, source: "override" };
  const p = planDays.find((x) => x.weekday === isoWeekday(date));
  if (p) return { date, sessionType: p.session_type, notes: p.notes, source: "weekly" };
  return { date, sessionType: null, notes: "", source: "none" };
}

export function activePhase(date: string, phases: Phase[]): Phase | null {
  return phases.find((p) => p.start_date <= date && date <= p.end_date) ?? null;
}

export type PhaseStatus =
  | { kind: "active"; phase: Phase }
  | { kind: "before_start"; startDate: string }
  | { kind: "none" }; // outside configured phase dates

export function phaseStatus(date: string, phases: Phase[]): PhaseStatus {
  const active = activePhase(date, phases);
  if (active) return { kind: "active", phase: active };
  const first = phases.map((p) => p.start_date).sort()[0];
  if (first && date < first) return { kind: "before_start", startDate: first };
  return { kind: "none" };
}

/** Week 1 (23–29 Nov 2026) is "Test week": pick starting weights, no progression suggestions. */
export const TEST_WEEK = { start: "2026-11-23", end: "2026-11-29" } as const;
export const isTestWeek = (date: string) => date >= TEST_WEEK.start && date <= TEST_WEEK.end;

export function weekDates(date: string): string[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The target in force on `date`: latest effective_from on or before it. */
export function effectiveTarget<T extends { effective_from: string }>(date: string, targets: T[]): T | null {
  return targets.filter((t) => t.effective_from <= date).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] ?? null;
}

/** True only for real calendar dates in YYYY-MM-DD form. */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
