/** All plan, meal, weigh-in and activity-matching dates use this zone. */
export const APP_TIME_ZONE = "Europe/Copenhagen";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Copenhagen calendar date (YYYY-MM-DD) of an instant. */
export function localDate(instant: Date | string | number = new Date()): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) throw new RangeError("Invalid date");
  return dateFmt.format(d);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a YYYY-MM-DD calendar date. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Monday of the week containing the date. */
export function startOfWeek(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function formatLongDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
