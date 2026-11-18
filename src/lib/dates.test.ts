import { describe, expect, it } from "vitest";
import { addDays, isoWeekday, localDate, startOfWeek } from "./dates";

describe("localDate (Europe/Copenhagen)", () => {
  it("rolls over at Copenhagen midnight, not UTC midnight", () => {
    // 23:30 UTC on 22 Nov is 00:30 on 23 Nov in Copenhagen (UTC+1 in winter).
    expect(localDate("2026-11-22T23:30:00Z")).toBe("2026-11-23");
    expect(localDate("2026-11-22T22:59:00Z")).toBe("2026-11-22");
  });
  it("handles summer time (UTC+2)", () => {
    expect(localDate("2027-06-30T22:30:00Z")).toBe("2027-07-01");
  });
  it("rejects invalid input", () => {
    expect(() => localDate("nope")).toThrow();
  });
});

describe("week helpers", () => {
  it("returns ISO weekdays", () => {
    expect(isoWeekday("2026-11-23")).toBe(1); // Monday, plan start
    expect(isoWeekday("2026-11-29")).toBe(7);
  });
  it("finds the Monday of a week", () => {
    expect(startOfWeek("2026-11-29")).toBe("2026-11-23");
    expect(startOfWeek("2026-11-23")).toBe("2026-11-23");
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-11-30", -30)).toBe("2026-10-31");
  });
});
