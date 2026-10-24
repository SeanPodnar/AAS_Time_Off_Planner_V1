import { describe, expect, it } from "vitest";
import { canFilterByPlan, feedLabelFor, labelFor } from "../../src/lib/calendar/visibility";
import { buildIcs, fold } from "../../src/lib/calendar/ics";

describe("who sees what", () => {
  it("shows plan names to the person, HR and managers, pending included", () => {
    for (const rel of ["self", "hr", "manager"] as const) {
      expect(labelFor(rel, "Sick", "hidden", "pending")).toBe("Sick");
    }
  });
  it("shows coworkers approved time only, as the plan allows", () => {
    expect(labelFor("coworker", "Vacation", "name", "approved")).toBe("Vacation");
    expect(labelFor("coworker", "Sick", "out_of_office", "approved")).toBe("Out of office");
    expect(labelFor("coworker", "Personal", "hidden", "approved")).toBeNull();
    expect(labelFor("coworker", "Vacation", "name", "pending")).toBeNull();
  });
  it("never shows a private plan's name in a feed, even the person's own", () => {
    expect(feedLabelFor(true, "Sick", "out_of_office", "approved")).toBe("Out of office");
    expect(feedLabelFor(true, "Personal", "hidden", "pending")).toBe("Out of office");
    expect(feedLabelFor(true, "Vacation", "name", "pending")).toBe("Vacation");
    expect(feedLabelFor(false, "Personal", "hidden", "approved")).toBeNull();
  });
  it("only lets coworkers filter by plans whose names they can see", () => {
    expect(canFilterByPlan("coworker", "out_of_office")).toBe(false);
    expect(canFilterByPlan("coworker", "name")).toBe(true);
    expect(canFilterByPlan("manager", "hidden")).toBe(true);
  });
});

describe("ics", () => {
  it("writes all-day events with an exclusive end date and escapes text", () => {
    const ics = buildIcs("Northwind: team", [{ uid: "r1@x", start: "2026-11-02", endInclusive: "2026-11-06", summary: "Maya Chen: Vacation, Paris; week", busy: "out_of_office" }], new Date("2026-10-01T12:00:00Z"));
    expect(ics).toContain("DTSTART;VALUE=DATE:20261102\r\nDTEND;VALUE=DATE:20261107\r\n");
    expect(ics).toContain("SUMMARY:Maya Chen: Vacation\\, Paris\\; week");
    expect(ics).toContain("X-MICROSOFT-CDO-BUSYSTATUS:OOF");
    expect(ics).toContain("DTSTAMP:20261001T120000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("folds long lines at 75 octets without splitting characters", () => {
    const line = "SUMMARY:" + "é".repeat(60);
    const folded = fold(line);
    for (const part of folded.split("\r\n")) expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n ").join("")).toBe(line);
  });
});
