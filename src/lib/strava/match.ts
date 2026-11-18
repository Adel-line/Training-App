import { localDate } from "../dates";
import type { SessionType } from "../plan";
import { RUN_TYPES, type SupportedType } from "./mapping";

export type DayActivity = {
  strava_activity_id: number;
  start_date: string;
  name: string;
  distance_m: number;
  moving_time_s: number;
  activity_type: SupportedType;
};

const MATCHES: Partial<Record<SessionType, readonly SupportedType[]>> = {
  easy_run: RUN_TYPES,
  quality_run: RUN_TYPES,
  long_day: ["Run", "TrailRun", "Hike", "Snowboard"],
};

/**
 * Splits a day's activities into those that match the planned session and the rest.
 * This is date matching only: it says an activity of a suitable type happened that day. It does not
 * check distance, pace, intervals or intensity.
 */
export function matchDay(planned: SessionType | null, activities: DayActivity[]): { matched: DayActivity[]; other: DayActivity[] } {
  const ok = planned ? MATCHES[planned] : undefined;
  if (!ok) return { matched: [], other: activities };
  return { matched: activities.filter((a) => ok.includes(a.activity_type)), other: activities.filter((a) => !ok.includes(a.activity_type)) };
}

/** Groups by Europe/Copenhagen calendar date derived from the UTC start instant. */
export function groupByLocalDate(activities: DayActivity[]): Map<string, DayActivity[]> {
  const out = new Map<string, DayActivity[]>();
  for (const a of activities) {
    const d = localDate(a.start_date);
    out.set(d, [...(out.get(d) ?? []), a]);
  }
  return out;
}

export const km = (m: number) => `${(m / 1000).toFixed(m >= 10_000 ? 1 : 2)} km`;
export function duration(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
/** Pace = moving time / distance, as min:sec per km. */
export function pace(distanceM: number, movingS: number): string | null {
  if (distanceM <= 0 || movingS <= 0) return null;
  const secPerKm = Math.round(movingS / (distanceM / 1000));
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")}/km`;
}
