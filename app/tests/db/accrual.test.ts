import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, hasDb, resetDb } from "./helpers";
import { closeDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { withTenant } from "@/lib/tenancy";
import { assignPlan, getPlan, savePlan } from "@/lib/plans";
import { balancesFor, postAccruals } from "@/lib/accrual/post";

describe.skipIf(!hasDb)("accrual posting", () => {
  let A: string, B: string, adminId: string, ana: string, ben: string, vacation: string, level: string;
  const plan = {
    name: "Vacation", category: "vacation", unit: "days", accrualMethod: "lump_sum", lumpSumTiming: "plan_year_start",
    carryover: "capped", carryoverCap: "5", approvalMode: "manager", levels: [{ name: "Standard", annualAmount: "15", tenureTiers: "" }],
  };
  const person = (t: string, name: string, jurisdiction: string, hire: string) =>
    withTenant(t, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date)
      values (${t}, ${name}, ${name.toLowerCase() + "@x.example"}, ${jurisdiction}, ${hire}) returning id`)[0].id as string);
  const ledger = (t: string, p: string) =>
    withTenant(t, (tx) => tx`select effective_date::text as d, kind, amount::float as amount from accrual_ledger where person_id = ${p} order by effective_date, kind`);

  beforeAll(async () => {
    await resetDb();
    const t = { customDomain: "", brandColor: "#2b6cb0" };
    A = ((await createTenant({ ...t, legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", country: "CA" }, "t")) as { id: string }).id;
    B = ((await createTenant({ ...t, legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", country: "US" }, "t")) as { id: string }).id;
    const admin = await person(A, "Priya", "CA-ON", "2019-09-09");
    await withTenant(A, (tx) => tx`update people set role = 'admin' where id = ${admin}`);
    adminId = admin;
    ana = await person(A, "Ana", "US-CA", "2026-06-10");
    ben = await person(B, "Ben", "US-TX", "2026-06-10");
    const saved = await savePlan(A, { personId: admin, role: "admin" }, plan);
    if (!saved.ok) throw new Error(JSON.stringify(saved.errors));
    vacation = saved.id;
    level = await withTenant(A, async (tx) => (await tx`select id from plan_levels where plan_id = ${vacation}`)[0].id);
    const r = await assignPlan(A, { personId: admin, role: "admin" }, { personId: ana, planId: vacation, levelId: level, effectiveFrom: "2026-06-10" });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
  });
  afterAll(closeDb);

  it("posts the prorated first-year grant, year end with the no-forfeit override, and the next grant", async () => {
    const res = await postAccruals(A, { asOf: "2027-01-01", actor: "test" });
    expect(res.posted).toBe(4);
    expect(await ledger(A, ana)).toEqual([
      { d: "2026-06-10", kind: "proration", amount: 9 },
      { d: "2026-12-31", kind: "forfeit", amount: -4 },
      { d: "2026-12-31", kind: "override", amount: 4 },
      { d: "2027-01-01", kind: "grant", amount: 15 },
    ]);
  });

  it("is idempotent", async () => {
    expect((await postAccruals(A, { asOf: "2027-01-01", actor: "test" })).posted).toBe(0);
    expect(await ledger(A, ana)).toHaveLength(4);
  });

  it("reports balances and the projection", async () => {
    const [b] = await balancesFor(A, ana, "2027-01-01");
    expect(b).toMatchObject({ planName: "Vacation", balance: 24, scheduled: 0, projectedYearEnd: 24, planYearStart: "2027-01-01", planYearEnd: "2027-12-31", annualEntitlement: 15 });
    expect(b.compliance).toContainEqual({ level: "info", text: "Statutory figures are pending legal review." });
  });

  it("never touches another company", async () => {
    await postAccruals(B, { asOf: "2027-01-01", actor: "test" });
    expect(await ledger(B, ben)).toEqual([]);
    expect(await withTenant(B, (tx) => tx`select 1 from accrual_ledger`)).toHaveLength(0);
  });

  it("keeps the ledger append-only for the app role", async () => {
    const app = connect("DATABASE_URL_APP");
    try {
      await expect(app.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${A}, true)`;
        await tx`update accrual_ledger set amount = 100`;
      })).rejects.toThrow(/permission denied/);
      await expect(app.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${A}, true)`;
        await tx`delete from accrual_ledger`;
      })).rejects.toThrow(/permission denied/);
    } finally { await app.end(); }
  });

  it("flags a vacation plan below the statutory minimum", async () => {
    const admin = await withTenant(A, async (tx) => (await tx`select id from people where role = 'admin'`)[0].id);
    const low = await savePlan(A, { personId: admin, role: "admin" }, { ...plan, name: "Thin vacation", levels: [{ name: "Low", annualAmount: "5", tenureTiers: "" }] });
    if (!low.ok) throw new Error(JSON.stringify(low.errors));
    const lowLevel = await withTenant(A, async (tx) => (await tx`select id from plan_levels where plan_id = ${low.id}`)[0].id);
    const on = await person(A, "Omar", "CA-ON", "2020-01-15");
    await assignPlan(A, { personId: admin, role: "admin" }, { personId: on, planId: low.id, levelId: lowLevel, effectiveFrom: "2026-01-01" });
    const [b] = await balancesFor(A, on, "2026-06-01");
    expect(b.compliance[0]).toMatchObject({ level: "warn", text: expect.stringMatching(/CA-ON requires at least 15 days/) });
  });

  it("refuses changes to unit, method or plan year once balances exist", async () => {
    const actor = { personId: adminId, role: "admin" as const };
    const current = (await getPlan(A, actor, vacation))!;
    const base = { ...current, levels: current.levels.map((l) => ({ ...l, tenureTiers: "" })) };
    const r = await savePlan(A, actor, { ...base, unit: "hours", planYearStartMonth: 4 }, vacation);
    expect(r.ok).toBe(false);
    expect(Object.keys((r as { errors: object }).errors).sort()).toEqual(["planYearStartMonth", "unit"]);
    expect((await savePlan(A, actor, { ...base, name: "Vacation (renamed)" }, vacation)).ok).toBe(true);
  });
});
