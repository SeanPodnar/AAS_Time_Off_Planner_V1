import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb, resetDb } from "./helpers";
import { closeDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { withTenant } from "@/lib/tenancy";
import type { Actor } from "@/lib/people";
import {
  assignPlan, assignPlanToAll, getPlan, listAssignments, listPlans, NotAllowed, parseTiers, savePlan, starterTemplates,
} from "@/lib/plans";

describe.skipIf(!hasDb)("plans and assignments", () => {
  let A: string, B: string, admin: Actor, employee: Actor, p1: string, p2: string, p3: string, inactivePerson: string;
  const lump = {
    name: "Sick", category: "sick", unit: "days", accrualMethod: "lump_sum", lumpSumTiming: "plan_year_start", frequency: "", creditTiming: "start",
    hoursWorkedRatio: "", planYearStartMonth: "1", planYearStartDay: "1", firstYearProration: "true", rounding: "nearest", carryover: "none",
    carryoverCap: "", carryoverExpiryMonth: "", carryoverExpiryDay: "", maxBalance: "", payoutUnused: "false", approvalMode: "auto", secondApproval: "false",
    negativeLimit: "0", waitingPeriodDays: "0", visibility: "out_of_office", calendarStatus: "out_of_office", counts: "working_days", tenureEnabled: "false", active: "true",
    levels: [{ id: "", name: "Standard", annualAmount: "6", tenureTiers: "" }],
  };
  const errorsOf = (r: unknown) => (r as { errors: Record<string, string> }).errors;
  const idOf = (r: unknown) => (r as { id: string }).id;
  async function person(tenant: string, name: string, status = "active") {
    return withTenant(tenant, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, status)
      values (${tenant}, ${name}, ${name.toLowerCase().replace(/\W/g, "") + "@x.example"}, 'CA-ON', '2022-01-10', ${status}) returning id`)[0].id as string);
  }

  beforeAll(async () => {
    await resetDb();
    const t = { customDomain: "", brandColor: "#2b6cb0" };
    A = ((await createTenant({ ...t, legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", country: "CA" }, "t")) as { id: string }).id;
    B = ((await createTenant({ ...t, legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", country: "US" }, "t")) as { id: string }).id;
    const priya = await withTenant(A, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, role) values (${A}, 'Priya Shah', 'priya@nw.example', 'CA-ON', '2019-09-09', 'admin') returning id`)[0].id);
    admin = { personId: priya, role: "admin" };
    employee = { personId: priya, role: "employee" };
    p1 = await person(A, "Daniel Okafor");
    p2 = await person(A, "Maya Chen");
    p3 = await person(A, "Liam Tremblay");
    inactivePerson = await person(A, "Gone Person", "inactive");
  });
  afterAll(closeDb);

  it("lets only HR admins use plans", async () => {
    await expect(listPlans(A, employee)).rejects.toBeInstanceOf(NotAllowed);
    await expect(savePlan(A, employee, lump)).rejects.toBeInstanceOf(NotAllowed);
    await expect(assignPlan(A, employee, { personId: p1, planId: p1, levelId: p1, effectiveFrom: "2026-01-01" })).rejects.toBeInstanceOf(NotAllowed);
    await expect(assignPlanToAll(A, employee, { planId: p1, levelId: p1, effectiveFrom: "2026-01-01" })).rejects.toBeInstanceOf(NotAllowed);
    await expect(getPlan(A, employee, p1)).rejects.toBeInstanceOf(NotAllowed);
  });

  it("validates each cross-field rule with a message on the field", async () => {
    expect(errorsOf(await savePlan(A, admin, { ...lump, lumpSumTiming: "" }))).toHaveProperty("lumpSumTiming");
    expect(errorsOf(await savePlan(A, admin, { ...lump, accrualMethod: "periodic", frequency: "" }))).toHaveProperty("frequency");
    const hw = { ...lump, accrualMethod: "hours_worked", unit: "hours", hoursWorkedRatio: "" };
    expect(errorsOf(await savePlan(A, admin, hw))).toHaveProperty("hoursWorkedRatio");
    expect(errorsOf(await savePlan(A, admin, { ...hw, hoursWorkedRatio: "30", unit: "days" }))).toHaveProperty("unit");
    expect(errorsOf(await savePlan(A, admin, { ...lump, carryover: "capped", carryoverCap: "" }))).toHaveProperty("carryoverCap");
    expect(errorsOf(await savePlan(A, admin, { ...lump, carryover: "max_balance", maxBalance: "" }))).toHaveProperty("maxBalance");
    expect(errorsOf(await savePlan(A, admin, { ...lump, carryover: "unlimited", carryoverExpiryMonth: "3" }))).toHaveProperty("carryoverExpiryDay");
    expect(errorsOf(await savePlan(A, admin, { ...lump, carryover: "unlimited", carryoverExpiryMonth: "2", carryoverExpiryDay: "31" }))).toHaveProperty("carryoverExpiryDay");
    const bad = errorsOf(await savePlan(A, admin, { ...lump, name: " ", category: "nope", planYearStartDay: "29", waitingPeriodDays: "-1" }));
    expect(Object.keys(bad).sort()).toEqual(["category", "name", "planYearStartDay", "waitingPeriodDays"]);
  });

  it("needs a level, and checks level amounts and tenure tiers", async () => {
    expect(errorsOf(await savePlan(A, admin, { ...lump, levels: [] }))).toHaveProperty("levels");
    expect(errorsOf(await savePlan(A, admin, { ...lump, levels: [{ name: "", annualAmount: "5" }, { name: "Ok", annualAmount: "x" }] }))).toMatchObject({
      "levels.0.name": expect.any(String), "levels.1.annualAmount": expect.any(String),
    });
    expect(errorsOf(await savePlan(A, admin, { ...lump, levels: [{ name: "Std", annualAmount: "5", tenureTiers: "five years" }] }))).toHaveProperty("levels.0.tenureTiers");
    expect(parseTiers("10:25, 5:20")).toEqual({ ok: true, tiers: [{ years: 5, amount: 20 }, { years: 10, amount: 25 }] });
    expect(parseTiers("5:20, 5:22").ok).toBe(false);
  });

  it("saves a plan with levels, and refuses duplicate plan and level names", async () => {
    const r = await savePlan(A, admin, {
      ...lump, name: "Vacation", category: "vacation", accrualMethod: "periodic", frequency: "monthly", carryover: "capped", carryoverCap: "5", tenureEnabled: "true",
      levels: [{ name: "Standard", annualAmount: "15", tenureTiers: "5:20" }, { name: "Senior", annualAmount: "20" }],
    });
    expect(r.ok).toBe(true);
    const plan = (await getPlan(A, admin, idOf(r)))!;
    expect(plan).toMatchObject({ name: "Vacation", frequency: "monthly", lumpSumTiming: null, carryoverCap: 5, tenureEnabled: true, approvalMode: "auto" });
    expect(plan.levels.map((l) => [l.name, l.annualAmount, l.tenureTiers])).toEqual([["Standard", 15, [{ years: 5, amount: 20 }]], ["Senior", 20, []]]);

    expect(await savePlan(A, admin, { ...lump, name: " vacation " })).toEqual({ ok: false, errors: { name: expect.stringMatching(/already has this name/) } });
    expect(errorsOf(await savePlan(A, admin, { ...lump, name: "Other", levels: [{ name: "Std", annualAmount: "1" }, { name: " std ", annualAmount: "2" }] }))).toHaveProperty("levels.1.name");
    expect((await listPlans(A, admin)).map((p) => p.name)).toEqual(["Vacation"]);
  });

  it("allows the same plan name in another company", async () => {
    expect((await savePlan(B, { personId: admin.personId, role: "admin" }, { ...lump, name: "Vacation", category: "vacation" })).ok).toBe(true);
  });

  it("edits plans and levels: update by id, add, remove, and audit what changed", async () => {
    const vac = (await listPlans(A, admin)).find((p) => p.name === "Vacation")!;
    const [std, senior] = vac.levels;
    const r = await savePlan(A, admin, {
      ...lump, name: "Vacation", category: "vacation", accrualMethod: "periodic", frequency: "quarterly", carryover: "capped", carryoverCap: "7",
      levels: [{ id: std.id, name: "Standard", annualAmount: "16" }, { id: senior.id, name: "Senior", annualAmount: "20" }, { name: "Executive", annualAmount: "25" }],
    }, vac.id);
    expect(r).toEqual({ ok: true, id: vac.id });
    const after = (await getPlan(A, admin, vac.id))!;
    expect(after.frequency).toBe("quarterly");
    expect(after.levels.map((l) => [l.name, l.annualAmount])).toEqual([["Standard", 16], ["Senior", 20], ["Executive", 25]]);
    expect(after.levels[0].id).toBe(std.id);
    const [entry] = await withTenant(A, (tx) => tx`select detail from audit_log where action = 'plan.updated' order by at desc limit 1`);
    expect(entry.detail.changed).toMatchObject({ frequency: { from: "monthly", to: "quarterly" }, carryoverCap: { from: 5, to: 7 }, levels: { added: ["Executive"] } });

    const drop = await savePlan(A, admin, { ...lump, name: "Vacation", category: "vacation", accrualMethod: "periodic", frequency: "quarterly",
      levels: [{ id: std.id, name: "Standard", annualAmount: "16" }, { id: senior.id, name: "Senior", annualAmount: "20" }] }, vac.id);
    expect(drop.ok).toBe(true);
    expect((await getPlan(A, admin, vac.id))!.levels.map((l) => l.name)).toEqual(["Standard", "Senior"]);
    expect(await savePlan(A, admin, { ...lump, levels: [{ id: "00000000-0000-4000-8000-000000000000", name: "X", annualAmount: "1" }] }, vac.id)).toMatchObject({ ok: false });
    expect(await savePlan(A, admin, lump, "00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, errors: { form: "That plan no longer exists." } });
  });

  it("gives 'none' plans a single zero level", async () => {
    const r = await savePlan(A, admin, { ...lump, name: "Unpaid", category: "unpaid", accrualMethod: "none", lumpSumTiming: "", approvalMode: "admin", levels: [] });
    expect(r.ok).toBe(true);
    const plan = (await getPlan(A, admin, idOf(r)))!;
    expect(plan.levels.map((l) => [l.name, l.annualAmount])).toEqual([["Standard", 0]]);
    expect(plan).toMatchObject({ lumpSumTiming: null, carryover: "none" });
  });

  it("saves every starter template as is", async () => {
    for (const t of starterTemplates) {
      const r = await savePlan(B, admin, { ...t.plan, name: `T ${t.plan.name}` });
      expect(r.ok, t.key).toBe(true);
    }
    expect(starterTemplates.map((t) => t.key)).toEqual(["vacation", "wellbeing", "sick", "personal", "unpaid"]);
  });

  it("assigns a person to a plan and closes the previous assignment", async () => {
    const vac = (await listPlans(A, admin)).find((p) => p.name === "Vacation")!;
    const [std, senior] = vac.levels;
    expect(await assignPlan(A, admin, { personId: p1, planId: vac.id, levelId: std.id, effectiveFrom: "2025-01-01" })).toEqual({ ok: true });
    expect(await assignPlan(A, admin, { personId: p1, planId: vac.id, levelId: senior.id, effectiveFrom: "2026-03-01" })).toEqual({ ok: true });
    const rows = await listAssignments(A, admin, p1);
    expect(rows.map((r) => [r.levelName, r.effectiveFrom, r.effectiveTo, r.current])).toEqual([["Senior", "2026-03-01", null, true], ["Standard", "2025-01-01", "2026-03-01", false]]);
    expect(rows[0].planName).toBe("Vacation");
    expect((await listPlans(A, admin)).find((p) => p.id === vac.id)!.assignedCount).toBe(1);
    const [entry] = await withTenant(A, (tx) => tx`select detail from audit_log where action = 'plan.assigned' order by at desc limit 1`);
    expect(entry.detail).toMatchObject({ personId: p1, levelId: senior.id, effectiveFrom: "2026-03-01" });
  });

  it("rejects bad assignments", async () => {
    const vac = (await listPlans(A, admin)).find((p) => p.name === "Vacation")!;
    const unpaid = (await listPlans(A, admin)).find((p) => p.name === "Unpaid")!;
    const [std] = vac.levels;
    expect(await assignPlan(A, admin, { personId: p1, planId: vac.id, levelId: std.id, effectiveFrom: "2026-02-01" })).toMatchObject({ ok: false, errors: { effectiveFrom: expect.stringMatching(/2026-03-01/) } });
    expect(await assignPlan(A, admin, { personId: p1, planId: vac.id, levelId: unpaid.levels[0].id, effectiveFrom: "2026-04-01" })).toMatchObject({ ok: false, errors: { levelId: expect.any(String) } });
    expect(await assignPlan(A, admin, { personId: p1, planId: vac.id, levelId: std.id, effectiveFrom: "not a date" })).toMatchObject({ ok: false, errors: { effectiveFrom: expect.any(String) } });
    // A person from another company is not found.
    const other = await person(B, "Emily Park");
    expect(await assignPlan(A, admin, { personId: other, planId: vac.id, levelId: std.id, effectiveFrom: "2026-04-01" })).toMatchObject({ ok: false, errors: { personId: expect.any(String) } });
    // Inactive plans cannot be assigned.
    const sick = (await savePlan(A, admin, { ...lump, name: "Retired", active: "false" })) as { id: string };
    const lvl = (await getPlan(A, admin, sick.id))!.levels[0];
    expect(await assignPlan(A, admin, { personId: p1, planId: sick.id, levelId: lvl.id, effectiveFrom: "2026-04-01" })).toMatchObject({ ok: false, errors: { planId: expect.stringMatching(/inactive/) } });
    expect(await assignPlanToAll(A, admin, { planId: sick.id, levelId: lvl.id, effectiveFrom: "2026-04-01" })).toMatchObject({ ok: false });
  });

  it("refuses to remove a level that has assignments", async () => {
    const vac = (await listPlans(A, admin)).find((p) => p.name === "Vacation")!;
    const [std, senior] = vac.levels;
    const r = await savePlan(A, admin, { ...lump, name: "Vacation", category: "vacation", accrualMethod: "periodic", frequency: "quarterly",
      levels: [{ id: std.id, name: "Standard", annualAmount: "16" }] }, vac.id);
    expect(r).toEqual({ ok: false, errors: { levels: expect.stringContaining("Senior") } });
    expect((await getPlan(A, admin, vac.id))!.levels).toHaveLength(2);
    // The Standard level was used before and is now closed history, but still blocks removal.
    const r2 = await savePlan(A, admin, { ...lump, name: "Vacation", category: "vacation", accrualMethod: "periodic", frequency: "quarterly",
      levels: [{ id: senior.id, name: "Senior", annualAmount: "20" }] }, vac.id);
    expect(r2).toMatchObject({ ok: false, errors: { levels: expect.stringContaining("Standard") } });
  });

  it("assigns everyone without the plan, once, and returns the count", async () => {
    const vac = (await listPlans(A, admin)).find((p) => p.name === "Vacation")!;
    const std = vac.levels[0];
    // Priya, Maya, Liam need the plan. Daniel already has it. The inactive person is skipped.
    expect(await assignPlanToAll(A, admin, { planId: vac.id, levelId: std.id, effectiveFrom: "2026-05-01" })).toEqual({ ok: true, count: 3 });
    expect(await assignPlanToAll(A, admin, { planId: vac.id, levelId: std.id, effectiveFrom: "2026-05-01" })).toEqual({ ok: true, count: 0 });
    expect((await listAssignments(A, admin, inactivePerson))).toEqual([]);
    expect((await listAssignments(A, admin, p1))[0].levelName).toBe("Senior");
    expect((await listPlans(A, admin)).find((p) => p.id === vac.id)!.assignedCount).toBe(4);
    const audits = await withTenant(A, (tx) => tx`select detail from audit_log where action = 'plan.assigned_all'`);
    expect(audits).toHaveLength(2);
    expect(audits[0].detail.count).toBe(3);
    expect(p2 && p3).toBeTruthy();
  });

  it("keeps companies apart", async () => {
    const a = await listPlans(A, admin);
    const b = await listPlans(B, admin);
    expect(a.map((p) => p.name)).toEqual(["Retired", "Unpaid", "Vacation"]);
    expect(b.map((p) => p.name)).toContain("Vacation");
    expect(b.some((p) => p.id === a[0].id)).toBe(false);
    expect(await getPlan(B, admin, a[2].id)).toBeNull();
    expect(await savePlan(B, admin, lump, a[2].id)).toEqual({ ok: false, errors: { form: "That plan no longer exists." } });
    expect(await listAssignments(B, admin, p1)).toEqual([]);
  });
});
