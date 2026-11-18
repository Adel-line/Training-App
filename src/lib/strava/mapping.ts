import { z } from "zod";

/** Strava sport types we keep. (sport_type is Strava's current field; `type` is deprecated.) */
export const SUPPORTED_TYPES = ["Run", "TrailRun", "Hike", "Snowboard"] as const;
export type SupportedType = (typeof SUPPORTED_TYPES)[number];
export const RUN_TYPES: readonly SupportedType[] = ["Run", "TrailRun"];

export type ActivityRow = {
  strava_activity_id: number;
  start_date: string; // UTC instant
  name: string;
  distance_m: number;
  moving_time_s: number;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  avg_speed_mps: number | null;
  activity_type: SupportedType;
};

const activity = z.looseObject({
  id: z.number().int().positive(),
  name: z.string().optional(),
  sport_type: z.string().optional(),
  type: z.string().optional(),
  start_date: z.iso.datetime(),
  distance: z.number().nonnegative().optional(),
  moving_time: z.number().nonnegative().optional(),
  total_elevation_gain: z.number().nullable().optional(),
  average_heartrate: z.number().nullable().optional(),
  average_speed: z.number().nullable().optional(),
});

export const isSupported = (t: string | undefined): t is SupportedType => (SUPPORTED_TYPES as readonly string[]).includes(t ?? "");

/** Converts a Strava activity to a stored row; null for unsupported types or unusable payloads. */
export function toActivityRow(raw: unknown): ActivityRow | null {
  const p = activity.safeParse(raw);
  if (!p.success) return null;
  const a = p.data;
  const type = a.sport_type ?? a.type;
  if (!isSupported(type)) return null;
  return {
    strava_activity_id: a.id,
    start_date: a.start_date,
    name: a.name ?? "",
    distance_m: a.distance ?? 0,
    moving_time_s: Math.round(a.moving_time ?? 0),
    elevation_gain_m: a.total_elevation_gain ?? null,
    avg_hr: a.average_heartrate ?? null,
    avg_speed_mps: a.average_speed ?? null,
    activity_type: type,
  };
}
