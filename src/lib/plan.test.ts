import { describe, expect, it } from "vitest";
import { activePhase, effectiveTarget, isTestWeek, isValidDate, phaseStatus, resolveDay, weekDates, type Phase, type PlanDay } from "./plan";

const weekly: PlanDay[] = [
  { weekday: 1, session_type: "strength_a", notes: "a" },
  { weekday: 2, session_type: "easy_run", notes: "" },
  { weekday: 7, session_type: "rest", notes: "" },
];
const phases: Phase[] = [
  { id: "1", name: "Phase 1", start_date: "2026-11-23", end_date: "2026-12-06", focus: "", calorie_mode: "baseline" },
  { id: "2", name: "Phase 1", start_date: "2026-12-07", end_date: "2026-12-20", focus: "", calorie_mode: "deficit" },
];

describe("resolveDay", () => {
  it("uses the recurring weekday", () => {
    expect(resolveDay("2026-11-23", weekly, [])).toMatchObject({ sessionType: "strength_a", source: "weekly" });
  });
  it("lets an override win for that date only", () => {
    const o = [{ date: "2026-11-30", session_type: "rest" as const, notes: "sick" }];
    expect(resolveDay("2026-11-30", weekly, o)).toMatchObject({ sessionType: "rest", source: "override", notes: "sick" });
    expect(resolveDay("2026-11-23", weekly, o).sessionType).toBe("strength_a");
    expect(resolveDay("2026-12-07", weekly, o).sessionType).toBe("strength_a");
  });
  it("changing the weekly plan does not affect an override", () => {
    const o = [{ date: "2026-12-07", session_type: "rest" as const, notes: "" }];
    const changed: PlanDay[] = [{ weekday: 1, session_type: "bouldering", notes: "" }];
    expect(resolveDay("2026-12-07", changed, o).sessionType).toBe("rest");
    expect(resolveDay("2026-12-14", changed, o).sessionType).toBe("bouldering");
  });
  it("reports a weekday with no entry", () => {
    expect(resolveDay("2026-11-25", weekly, [])).toMatchObject({ sessionType: null, source: "none" });
  });
});

describe("phases", () => {
  it("finds the phase on boundary dates", () => {
    expect(activePhase("2026-12-06", phases)?.calorie_mode).toBe("baseline");
    expect(activePhase("2026-12-07", phases)?.calorie_mode).toBe("deficit");
  });
  it("distinguishes before start from outside phases", () => {
    expect(phaseStatus("2026-11-18", phases)).toEqual({ kind: "before_start", startDate: "2026-11-23" });
    expect(phaseStatus("2027-03-01", phases)).toEqual({ kind: "none" });
    expect(phaseStatus("2026-11-30", phases).kind).toBe("active");
  });
});

describe("misc", () => {
  it("test week is 23–29 Nov 2026", () => {
    expect(isTestWeek("2026-11-23")).toBe(true);
    expect(isTestWeek("2026-11-29")).toBe(true);
    expect(isTestWeek("2026-11-30")).toBe(false);
    expect(isTestWeek("2026-11-22")).toBe(false);
  });
  it("week runs Monday to Sunday", () => {
    const w = weekDates("2026-11-26");
    expect(w[0]).toBe("2026-11-23");
    expect(w[6]).toBe("2026-11-29");
  });
  it("picks the latest effective target on or before the date", () => {
    const t = [{ effective_from: "2026-11-23", v: 1 }, { effective_from: "2026-12-07", v: 2 }];
    expect(effectiveTarget("2026-12-06", t)?.v).toBe(1);
    expect(effectiveTarget("2026-12-07", t)?.v).toBe(2);
    expect(effectiveTarget("2026-11-01", t)).toBeNull();
  });
  it("validates calendar dates", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("26-1-1")).toBe(false);
  });
});
