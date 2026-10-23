import { describe, expect, it } from "vitest";
import { partsClash, requestDays, runLength, totalDays, type Schedule } from "../../src/lib/requests/days";

const weekdays: Schedule = { workDays: [1, 2, 3, 4, 5], holidays: new Set() };
const days = (s: Schedule, a: string, b: string) => requestDays(s, a, b, "full", "full", "working_days").map((x) => x.day);

describe("request days", () => {
  it("skips weekends and counts half days on the first and last day", () => {
    // Thu 2026-11-05 afternoon to Tue 2026-11-10 morning: Thu 0.5, Fri, Mon, Tue 0.5 = 3
    const d = requestDays(weekdays, "2026-11-05", "2026-11-10", "pm", "am", "working_days");
    expect(d.map((x) => `${x.day}:${x.part}`)).toEqual(["2026-11-05:pm", "2026-11-06:full", "2026-11-09:full", "2026-11-10:am"]);
    expect(totalDays(d)).toBe(3);
  });
  it("counts every date for calendar-day plans", () => {
    expect(requestDays(weekdays, "2026-11-06", "2026-11-09", "full", "full", "calendar_days")).toHaveLength(4);
  });
  it("uses the person's own work days and skips holidays", () => {
    const partTime: Schedule = { workDays: [1, 3, 5], holidays: new Set(["2026-11-11"]) };
    expect(days(partTime, "2026-11-09", "2026-11-15")).toEqual(["2026-11-09", "2026-11-13"]);
  });
  it("lets a morning and an afternoon share a date, nothing else", () => {
    expect(partsClash("am", "pm")).toBe(false);
    expect(partsClash("am", "am")).toBe(true);
    expect(partsClash("full", "pm")).toBe(true);
  });
});

describe("run of joined-up time off", () => {
  it("joins a Friday wellbeing day to two weeks of vacation: 11 days", () => {
    const vacation = days(weekdays, "2026-11-09", "2026-11-20");
    expect(runLength(weekdays, vacation, ["2026-11-06"])).toBe(11);
    expect(runLength(weekdays, ["2026-11-06"], vacation)).toBe(11);
  });
  it("is broken by a free working day", () => {
    const vacation = days(weekdays, "2026-11-10", "2026-11-20");
    expect(runLength(weekdays, vacation, ["2026-11-06"])).toBe(9);
  });
  it("is not broken by a holiday", () => {
    const withHoliday: Schedule = { workDays: [1, 2, 3, 4, 5], holidays: new Set(["2026-11-11"]) };
    const before = days(withHoliday, "2026-11-02", "2026-11-10");
    const after = days(withHoliday, "2026-11-12", "2026-11-13");
    expect(runLength(withHoliday, after, before)).toBe(9);
  });
  it("counts only the request when nothing joins it", () => {
    expect(runLength(weekdays, days(weekdays, "2026-11-02", "2026-11-04"), ["2026-12-01"])).toBe(3);
  });
});
