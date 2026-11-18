import { getDb } from "./db";
import { findOpenWorkout } from "./workouts";
import type { DayActivity } from "./strava/match";
import type { Override, Phase, PlanDay } from "./plan";

export const getPlanDays = () => getDb().prepare("SELECT weekday, session_type, notes FROM plan_days ORDER BY weekday").all() as PlanDay[];

export const getOverrides = (from: string, to: string) =>
  getDb().prepare("SELECT date, session_type, notes FROM plan_day_overrides WHERE date BETWEEN ? AND ? ORDER BY date").all(from, to) as Override[];

export const getPhases = () => getDb().prepare("SELECT id, name, start_date, end_date, focus, calorie_mode FROM phases ORDER BY start_date").all() as Phase[];

export type Target = { protein_g_min: number; protein_g_max: number; kcal_target: number | null; effective_from: string };
export const getTargets = () =>
  getDb().prepare("SELECT protein_g_min, protein_g_max, kcal_target, effective_from FROM targets ORDER BY effective_from").all() as Target[];

export const proteinOn = (date: string) =>
  (getDb().prepare("SELECT COALESCE(SUM(protein_g), 0) AS g FROM meals WHERE date = ?").get(date) as { g: number }).g;

/** Finished workouts in a date range (strength completion shows on the Week screen). */
export const finishedWorkouts = (from: string, to: string) =>
  getDb()
    .prepare("SELECT id, date, session_type FROM workouts WHERE date BETWEEN ? AND ? AND finished_at IS NOT NULL ORDER BY date")
    .all(from, to) as { id: string; date: string; session_type: string }[];

/** Link that starts a workout for this date and session, or resumes one already open (never duplicates it). */
export function workoutLink(date: string, sessionType: string): { href: string; resume: boolean } {
  const open = findOpenWorkout(getDb(), date, sessionType);
  const id = open ?? crypto.randomUUID();
  return { href: `/workout?id=${id}&date=${date}&type=${sessionType}`, resume: Boolean(open) };
}

export const workoutsOn = (date: string) =>
  getDb()
    .prepare("SELECT id, session_type, finished_at FROM workouts WHERE date = ? ORDER BY started_at")
    .all(date) as { id: string; session_type: string; finished_at: string | null }[];

/** Strava activities that may fall on dates in [from, to] (padded for the Copenhagen/UTC offset; callers group by local date). */
export const activitiesBetween = (from: string, to: string) =>
  getDb()
    .prepare(
      `SELECT strava_activity_id, start_date, name, distance_m, moving_time_s, activity_type FROM strava_activities
       WHERE start_date >= datetime(?, '-1 day') AND start_date < datetime(?, '+2 day') ORDER BY start_date`,
    )
    .all(from, to) as unknown as DayActivity[];
