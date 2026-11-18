import { describe, expect, it } from "vitest";
import { duration, groupByLocalDate, km, matchDay, pace, type DayActivity } from "./match";

const a = (id: number, t: DayActivity["activity_type"], start = "2026-11-24T06:30:00Z"): DayActivity => ({ strava_activity_id: id, start_date: start, name: "", distance_m: 5000, moving_time_s: 1800, activity_type: t });

describe("matchDay", () => {
  it("runs and trail runs match easy and quality runs; hikes and snowboarding don't", () => {
    for (const planned of ["easy_run", "quality_run"] as const) {
      const r = matchDay(planned, [a(1, "Run"), a(2, "TrailRun"), a(3, "Hike"), a(4, "Snowboard")]);
      expect(r.matched.map((x) => x.strava_activity_id)).toEqual([1, 2]);
      expect(r.other.map((x) => x.strava_activity_id)).toEqual([3, 4]);
    }
  });
  it("run, trail run, hike and snowboard all match a long day", () => {
    const r = matchDay("long_day", [a(1, "Run"), a(2, "TrailRun"), a(3, "Hike"), a(4, "Snowboard")]);
    expect(r.matched).toHaveLength(4);
    expect(r.other).toHaveLength(0);
  });
  it("activities on days with no matching plan are listed separately", () => {
    for (const planned of ["strength_a", "strength_b", "bouldering", "rest", null] as const) {
      const r = matchDay(planned, [a(1, "Run")]);
      expect(r.matched).toHaveLength(0);
      expect(r.other).toHaveLength(1);
    }
  });
});

describe("dates and formatting", () => {
  it("assigns activities to the Copenhagen calendar date, not the UTC date", () => {
    const g = groupByLocalDate([a(1, "Run", "2026-11-24T23:30:00Z"), a(2, "Run", "2026-11-24T22:30:00Z")]);
    expect([...g.keys()].sort()).toEqual(["2026-11-24", "2026-11-25"]);
    expect(g.get("2026-11-25")![0].strava_activity_id).toBe(1);
  });
  it("pace is moving time over distance", () => {
    expect(pace(5000, 1800)).toBe("6:00/km");
    expect(pace(6200, 2480)).toBe("6:40/km");
    expect(pace(0, 100)).toBeNull();
    expect(km(5200)).toBe("5.20 km");
    expect(duration(1900)).toBe("31:40");
    expect(duration(3725)).toBe("1:02:05");
  });
});
