import { getDb } from "./db";
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
