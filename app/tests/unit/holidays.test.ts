import { describe, expect, it } from "vitest";
import { CANADA, easter, holidaysFor } from "../../src/lib/holidays/rules";

const dates = (j: string, y: number) => holidaysFor(j, y).map((h) => `${h.date} ${h.name}`);

describe("holiday rules", () => {
  it("computes Easter", () => {
    expect([2025, 2026, 2027, 2028].map(easter)).toEqual(["2025-04-20", "2026-04-05", "2027-03-28", "2028-04-16"]);
  });

  it("lists Ontario 2026, with Boxing Day on a Saturday observed Monday", () => {
    expect(dates("CA-ON", 2026)).toEqual([
      "2026-01-01 New Year's Day", "2026-02-16 Family Day", "2026-04-03 Good Friday", "2026-05-18 Victoria Day",
      "2026-07-01 Canada Day", "2026-09-07 Labour Day", "2026-10-12 Thanksgiving", "2026-12-25 Christmas Day",
      "2026-12-26 Boxing Day", "2026-12-28 Boxing Day (observed)",
    ]);
  });

  it("moves Christmas and Boxing Day on a weekend to Monday and Tuesday", () => {
    const d = holidaysFor("CA-ON", 2027).filter((h) => h.date >= "2027-12-24").map((h) => h.date);
    expect(d).toEqual(["2027-12-25", "2027-12-26", "2027-12-27", "2027-12-28"]);
  });

  it("observes Canada Day on a Sunday on July 2", () => {
    expect(holidaysFor("CA-AB", 2029).filter((h) => h.date.startsWith("2029-07")).map((h) => h.date)).toEqual(["2029-07-01", "2029-07-02"]);
  });

  it("puts Victoria Day and National Patriots' Day on the Monday before May 25", () => {
    expect(holidaysFor("CA-QC", 2025).find((h) => h.key === "patriots_day")?.date).toBe("2025-05-19");
    expect(holidaysFor("CA-BC", 2027).find((h) => h.key === "victoria_day")?.date).toBe("2027-05-24");
  });

  it("starts Truth and Reconciliation Day in the year each law took effect", () => {
    expect(holidaysFor("CA-MB", 2023).some((h) => h.key === "truth_reconciliation")).toBe(false);
    expect(holidaysFor("CA-MB", 2024).some((h) => h.key === "truth_reconciliation")).toBe(true);
    expect(holidaysFor("CA-ON", 2026).some((h) => h.key === "truth_reconciliation")).toBe(false);
  });

  it("uses the US federal list, moving Saturday to Friday", () => {
    const us = holidaysFor("US-CA", 2026);
    expect(us.filter((h) => !h.observedFor)).toHaveLength(11);
    expect(us.find((h) => h.name === "Independence Day (observed)")?.date).toBe("2026-07-03");
    expect(us.find((h) => h.key === "us_thanksgiving")?.date).toBe("2026-11-26");
    expect(us.find((h) => h.key === "memorial_day")?.date).toBe("2026-05-25");
    expect(us.every((h) => !h.statutory)).toBe(true);
  });

  it("covers every province and territory, with the counts the sources give", () => {
    const counts = Object.fromEntries(Object.keys(CANADA).map((j) => [j, holidaysFor(j, 2026).filter((h) => !h.observedFor).length]));
    expect(counts).toEqual({
      "CA-AB": 9, "CA-BC": 11, "CA-MB": 9, "CA-NB": 8, "CA-NL": 6, "CA-NS": 6, "CA-NT": 11,
      "CA-NU": 11, "CA-ON": 9, "CA-PE": 8, "CA-QC": 8, "CA-SK": 10, "CA-YT": 11,
    });
  });
});
