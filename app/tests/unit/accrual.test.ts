import { describe, expect, it } from "vitest";
import { monthsRemaining, addMonths, yearsBetween } from "../../src/lib/accrual/dates";
import { statutoryMinimumDays } from "../../src/lib/accrual/rules";
import type { JurisdictionRule } from "../../src/lib/accrual/rules";
import { computeDueRows, futureCredits, roundAmount, type LedgerRow, type Person, type PlanConfig } from "../../src/lib/accrual/schedule";

const rule = (jurisdiction: string, ruleKind: JurisdictionRule["ruleKind"], minYears = 0, amount: number | null = null): JurisdictionRule => ({
  jurisdiction, category: "vacation", ruleKind, minYears, amount, amountUnit: amount === null ? null : "weeks",
  effectiveFrom: "2026-01-01", verified: false, source: null, notes: null,
});
const RULES = [
  rule("CA-ON", "min_entitlement", 1, 2), rule("CA-ON", "min_entitlement", 5, 3), rule("CA-ON", "no_forfeit"),
  rule("US-CA", "no_forfeit"), rule("US-IL", "forfeit_conditional"),
];

const plan = (over: Partial<PlanConfig> = {}): PlanConfig => ({
  id: "plan", name: "Vacation", category: "vacation", unit: "days", accrualMethod: "lump_sum", lumpSumTiming: "plan_year_start",
  frequency: null, creditTiming: "start", hoursWorkedRatio: null, planYearStartMonth: 1, planYearStartDay: 1,
  firstYearProration: true, rounding: "nearest", carryover: "capped", carryoverCap: 5, carryoverExpiryMonth: null,
  carryoverExpiryDay: null, maxBalance: null, tenureEnabled: false, ...over,
});
const person = (over: Partial<Person> = {}): Person => ({ id: "p", hireDate: "2026-06-10", jurisdiction: "US-TX", hoursPerDay: 8, workDays: [1, 2, 3, 4, 5], ...over });
const levels = [{ id: "std", annualAmount: 15, tenureTiers: [{ years: 5, amount: 20 }] }];
const run = (p: PlanConfig, who: Person, asOf: string, existing: LedgerRow[] = []) =>
  computeDueRows({ plan: p, levels, assignments: [{ levelId: "std", from: who.hireDate, to: null }], person: who, rules: RULES, existing, asOf });
const brief = (rows: LedgerRow[]) => rows.map((r) => `${r.effectiveDate} ${r.kind} ${r.amount}`);

describe("dates", () => {
  it("counts months remaining with the half-month rule", () => {
    expect(monthsRemaining("2026-06-10", "2027-01-01")).toBe(7);
    expect(monthsRemaining("2026-06-20", "2027-01-01")).toBe(6);
    expect(monthsRemaining("2026-01-01", "2027-01-01")).toBe(12);
  });
  it("clamps month ends and counts completed years", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(yearsBetween("2020-03-15", "2026-03-14")).toBe(5);
    expect(yearsBetween("2020-03-15", "2026-03-15")).toBe(6);
  });
  it("rounds to half days and quarter hours", () => {
    expect(roundAmount(8.75, "days", "nearest")).toBe(9);
    expect(roundAmount(8.6, "days", "down")).toBe(8.5);
    expect(roundAmount(8.1, "days", "up")).toBe(8.5);
    expect(roundAmount(7.1, "hours", "nearest")).toBe(7);
  });
});

describe("statutory minimums", () => {
  it("converts weeks to days using the person's work week", () => {
    expect(statutoryMinimumDays(RULES, "CA-ON", "2020-01-15", "2026-12-31", 5)?.days).toBe(15);
    expect(statutoryMinimumDays(RULES, "CA-ON", "2025-01-15", "2026-12-31", 3)?.days).toBe(6);
    expect(statutoryMinimumDays(RULES, "CA-ON", "2026-06-10", "2026-12-31", 5)).toBeNull();
  });
});

describe("lump sum", () => {
  it("prorates the first year by months remaining and rounds to a half day", () => {
    expect(brief(run(plan(), person(), "2026-12-31").rows)).toEqual(["2026-06-10 proration 9"]);
  });
  it("grants the full amount each plan year and applies the carryover cap at year end", () => {
    expect(brief(run(plan(), person(), "2027-01-01").rows)).toEqual([
      "2026-06-10 proration 9", "2026-12-31 forfeit -4", "2027-01-01 grant 15",
    ]);
  });
  it("is idempotent: posting again adds nothing", () => {
    const first = run(plan(), person(), "2027-06-01").rows;
    expect(run(plan(), person(), "2027-06-01", first).rows).toEqual([]);
  });
  it("adds the prorated difference when a tenure tier starts mid-year", () => {
    const rows = run(plan({ tenureEnabled: true }), person({ hireDate: "2021-07-01" }), "2026-12-31").rows.filter((r) => r.planYear === "2026-01-01");
    expect(brief(rows)).toEqual(["2026-01-01 grant 15", "2026-07-01 proration 2.5"]);
  });
  it("grants on each work anniversary for anniversary plans", () => {
    const rows = run(plan({ lumpSumTiming: "anniversary", carryover: "none" }), person({ hireDate: "2025-03-15" }), "2026-04-01").rows;
    expect(brief(rows)).toEqual(["2025-03-15 grant 15", "2026-03-14 forfeit -15", "2026-03-15 grant 15"]);
  });
});

describe("periodic", () => {
  const monthly = plan({ accrualMethod: "periodic", lumpSumTiming: null, frequency: "monthly" });
  it("credits a full month when hired on or before the 15th", () => {
    const rows = run(monthly, person(), "2026-12-31").rows;
    expect(rows[0]).toMatchObject({ effectiveDate: "2026-06-10", kind: "accrual", amount: 1.25 });
    expect(rows.reduce((a, r) => a + r.amount, 0)).toBeCloseTo(8.75);
  });
  it("skips the hire month when hired after the 15th", () => {
    const rows = run(monthly, person({ hireDate: "2026-06-20" }), "2026-12-31").rows;
    expect(rows[0].effectiveDate).toBe("2026-07-01");
    expect(rows.reduce((a, r) => a + r.amount, 0)).toBeCloseTo(7.5);
  });
  it("credits at period end when configured", () => {
    const rows = run(plan({ ...monthly, creditTiming: "end" }), person({ hireDate: "2026-01-01" }), "2026-03-31").rows;
    expect(brief(rows)).toEqual(["2026-01-31 accrual 1.25", "2026-02-28 accrual 1.25", "2026-03-31 accrual 1.25"]);
  });
  it("stops crediting at the maximum balance", () => {
    const capped = plan({ ...monthly, carryover: "max_balance", carryoverCap: null, maxBalance: 5 });
    const rows = run(capped, person({ hireDate: "2026-01-01" }), "2026-06-30").rows;
    expect(rows.map((r) => r.amount)).toEqual([1.25, 1.25, 1.25, 1.25, 0, 0]);
    expect(rows[4].reason).toContain("maximum balance");
  });
  it("projects the credits still to come this plan year", () => {
    expect(futureCredits({ plan: monthly, levels, assignments: [{ levelId: "std", from: "2026-01-01", to: null }], person: person({ hireDate: "2026-01-01" }), rules: RULES, asOf: "2026-10-15" })).toBeCloseTo(2.5);
  });
});

describe("hours worked", () => {
  it("credits one hour per ratio of scheduled hours each month end", () => {
    const p = plan({ unit: "hours", accrualMethod: "hours_worked", lumpSumTiming: null, hoursWorkedRatio: 30, carryover: "unlimited", carryoverCap: null });
    const rows = run(p, person({ hireDate: "2026-01-01" }), "2026-01-31").rows;
    expect(brief(rows)).toEqual(["2026-01-31 accrual 5.867"]); // 22 workdays x 8 h / 30
  });
});

describe("year end and the law", () => {
  it("keeps everything that would be forfeited in a no-forfeit US state", () => {
    const rows = run(plan(), person({ jurisdiction: "US-CA" }), "2027-01-01").rows;
    expect(brief(rows)).toEqual(["2026-06-10 proration 9", "2026-12-31 forfeit -4", "2026-12-31 override 4", "2027-01-01 grant 15"]);
    expect(rows[2].ruleRef).toBe("US-CA:no_forfeit");
  });
  it("protects only the statutory minimum in Canada", () => {
    // 6 years of service in Ontario: 3 weeks (15 days) protected. 5 carried in from 2025 plus 20 unused = 25;
    // the plan carries 5, so 20 would be forfeited and 10 of them are kept to reach the 15-day minimum.
    const rows = run(plan(), person({ jurisdiction: "CA-ON", hireDate: "2020-01-15" }), "2027-01-01", [
      { effectiveDate: "2026-01-01", planYear: "2026-01-01", kind: "grant", amount: 20, sourceKey: "acc:p:plan:grant:2026-01-01", reason: null, ruleRef: null },
    ]).rows.filter((r) => r.planYear === "2026-01-01");
    expect(brief(rows)).toEqual(["2026-12-31 forfeit -20", "2026-12-31 override 10"]);
  });
  it("warns instead of blocking where forfeiting needs notice", () => {
    const out = run(plan(), person({ jurisdiction: "US-IL" }), "2027-01-01");
    expect(brief(out.rows)).toContain("2026-12-31 forfeit -4");
    expect(out.warnings[0].message).toMatch(/notice/);
  });
  it("expires carried days not used by the expiry date, after bookings", () => {
    const p = plan({ carryoverExpiryMonth: 3, carryoverExpiryDay: 31 });
    const booking: LedgerRow = { effectiveDate: "2027-02-10", planYear: "2027-01-01", kind: "booking", amount: -2, sourceKey: "bk:1", reason: null, ruleRef: null };
    const rows = run(p, person(), "2027-04-01", [booking]).rows;
    expect(brief(rows)).toContain("2027-03-31 expire -3");
  });
  it("does not expire carried days in a no-forfeit state", () => {
    const p = plan({ carryoverExpiryMonth: 3, carryoverExpiryDay: 31 });
    const out = run(p, person({ jurisdiction: "US-CA" }), "2027-04-01");
    expect(out.rows.some((r) => r.kind === "expire")).toBe(false);
    expect(out.warnings.some((w) => w.message.includes("not expired"))).toBe(true);
  });
});
