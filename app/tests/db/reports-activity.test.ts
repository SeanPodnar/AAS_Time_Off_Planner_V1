import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb, quietMonday, resetDb } from "./helpers";
import { closeDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { withTenant, writeAudit } from "@/lib/tenancy";
import { addDays, todayIn } from "@/lib/accrual/dates";
import { decideRequest, submitRequest, type Company } from "@/lib/requests/service";
import { absenceRate, approvalMetrics, auditReport, whosOut } from "@/lib/reports/activity";
import { formatDate, type RunContext } from "@/lib/reports/types";

describe.skipIf(!hasDb)("activity reports", () => {
  let A: Company, B: Company, M: string;
  let priya: string, omar: string, maya: string, liam: string, zed: string;
  let sales: string, ops: string, vacation: string, sick: string;
  const as = (personId: string, role: "employee" | "admin" = "employee") => ({ personId, role });
  const day = (n: number) => addDays(M, n);
  const ctx = (c: Company): RunContext => ({ tenantId: c.tenantId, companyName: c === A ? "Northwind Analytics Inc." : "Harbor & Pine Company LLC", timeZone: c.timeZone, runBy: "Priya" });
  const week = () => ({ from: day(0), to: day(6) });
  const must = async (p: ReturnType<typeof submitRequest>) => { const r = await p; if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.id; };

  beforeAll(async () => {
    M = await quietMonday();
    await resetDb();
    const t = { customDomain: "", brandColor: "#2b6cb0" };
    const a = (await createTenant({ ...t, legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", country: "CA" }, "t")) as { id: string };
    const b = (await createTenant({ ...t, legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", country: "US" }, "t")) as { id: string };
    A = { tenantId: a.id, label: "Northwind", timeZone: "America/Toronto" };
    B = { tenantId: b.id, label: "Harbor & Pine", timeZone: "America/New_York" };
    const add = (c: Company, name: string, role: string, manager: string | null, team: string | null, status = "active") =>
      withTenant(c.tenantId, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, role, manager_id, team_id, status)
        values (${c.tenantId}, ${name}, ${name.toLowerCase() + "@x.example"}, ${c === A ? "CA-ON" : "US-NY"}, '2022-01-10', ${role}, ${manager}, ${team}, ${status}) returning id`)[0].id as string);
    await withTenant(A.tenantId, async (tx) => {
      sales = (await tx`insert into teams (tenant_id, name) values (${A.tenantId}, 'Sales') returning id`)[0].id;
      ops = (await tx`insert into teams (tenant_id, name) values (${A.tenantId}, 'Ops') returning id`)[0].id;
    });
    priya = await add(A, "Priya", "admin", null, null);
    omar = await add(A, "Omar", "employee", null, null);
    maya = await add(A, "Maya", "employee", omar, sales);
    liam = await add(A, "Liam", "employee", omar, ops);
    await add(A, "Gone", "employee", omar, sales, "inactive");
    zed = await add(B, "Zed", "employee", null, null);
    const plan = async (c: Company, name: string, mode: string, people: string[]) =>
      withTenant(c.tenantId, async (tx) => {
        const [p] = await tx`insert into plans (tenant_id, name, category, accrual_method, lump_sum_timing, approval_mode, visibility)
          values (${c.tenantId}, ${name}, 'other', 'lump_sum', 'plan_year_start', ${mode}, 'name') returning id`;
        const [l] = await tx`insert into plan_levels (tenant_id, plan_id, name, annual_amount) values (${c.tenantId}, ${p.id}, 'Standard', 20) returning id`;
        for (const w of people) await tx`insert into plan_assignments (tenant_id, person_id, plan_id, level_id, effective_from) values (${c.tenantId}, ${w}, ${p.id}, ${l.id}, '2026-01-01')`;
        return p.id as string;
      });
    vacation = await plan(A, "Vacation", "manager", [priya, omar, maya, liam]);
    sick = await plan(A, "Sick", "auto", [priya, omar, maya, liam]);
    const bAuto = await plan(B, "Secret B plan", "auto", [zed]);

    // Maya: two days approved, one day pending, one declined later. Liam: a morning off, and a stay approved by HR.
    const v1 = await must(submitRequest(A, as(maya), { planId: vacation, startDate: day(0), endDate: day(1) }));
    await decideRequest(A, as(omar), v1, "approve");
    await must(submitRequest(A, as(maya), { planId: vacation, startDate: day(3), endDate: day(3) })); // stays pending
    await must(submitRequest(A, as(liam), { planId: sick, startDate: day(2), endDate: day(2), startPart: "am" }));
    const v2 = await must(submitRequest(A, as(maya), { planId: vacation, startDate: day(9), endDate: day(9) }));
    await decideRequest(A, as(omar), v2, "decline", "Busy week");
    const v3 = await must(submitRequest(A, as(liam), { planId: vacation, startDate: day(8), endDate: day(8) }));
    await decideRequest(A, as(priya, "admin"), v3, "approve");
    await must(submitRequest(B, as(zed), { planId: bAuto, startDate: day(0), endDate: day(1) }));
    await withTenant(B.tenantId, (tx) => writeAudit(tx, "system:nightly", "b.secret", { zed: "hidden" }));
  });
  afterAll(closeDb);

  it("who's out lists live requests with days in range and totals", async () => {
    const r = await whosOut(ctx(A), week());
    expect(r.filters).toEqual([`From ${formatDate(day(0))} to ${formatDate(day(6))}`]);
    expect(r.columns.map((c) => c.label)).toEqual(["Person", "Team", "Plan", "First day", "Last day", "Days in range", "Status"]);
    expect(r.rows.map((x) => [x.person, x.team, x.plan, x.first, x.last, x.days, x.status])).toEqual([
      ["Maya", "Sales", "Vacation", day(0), day(1), 2, "Approved"],
      ["Liam", "Ops", "Sick", day(2), day(2), 0.5, "Approved"],
      ["Maya", "Sales", "Vacation", day(3), day(3), 1, "Waiting for approval"],
    ]);
    expect(r.totals?.days).toBe(3.5);
    // Declined and out-of-range requests never show.
    expect(JSON.stringify(r.rows)).not.toContain(day(9));
  });

  it("who's out counts only days inside the range and applies filters", async () => {
    const part = await whosOut(ctx(A), { from: day(1), to: day(2) });
    expect(part.rows.map((x) => [x.person, x.days])).toEqual([["Maya", 1], ["Liam", 0.5]]);
    const team = await whosOut(ctx(A), { ...week(), teamId: sales });
    expect(team.filters).toContain("Team: Sales");
    expect(team.rows.map((x) => x.person)).toEqual(["Maya", "Maya"]);
    expect(team.totals?.days).toBe(3);
    const plan = await whosOut(ctx(A), { ...week(), planId: sick, managerId: omar });
    expect(plan.filters).toEqual([`From ${formatDate(day(0))} to ${formatDate(day(6))}`, "Manager: Omar", "Plan: Sick"]);
    expect(plan.rows.map((x) => x.person)).toEqual(["Liam"]);
  });

  it("defaults the range and caps it at 366 days", async () => {
    const now = new Date();
    const today = todayIn(A.timeZone, now);
    const d = await whosOut({ ...ctx(A), now }, {});
    expect(d.filters[0]).toBe(`From ${formatDate(today)} to ${formatDate(addDays(today, 6))}`);
    const bad = await absenceRate({ ...ctx(A), now }, { from: "nonsense", to: "2026-99-99" });
    expect(bad.filters[0]).toBe(`From ${formatDate(addDays(today, -29))} to ${formatDate(today)}`);
    const long = await auditReport({ ...ctx(A), now }, { from: "2020-01-01", to: "2026-12-31" });
    expect(long.filters[0]).toBe(`From ${formatDate("2020-01-01")} to ${formatDate("2020-12-31")}`);
  });

  it("absence rate uses working days and approved time only", async () => {
    const r = await absenceRate(ctx(A), week());
    expect(r.rows.map((x) => [x.person, x.team, x.working, x.off, x.rate])).toEqual([
      ["Liam", "Ops", 5, 0.5, 0.1], ["Maya", "Sales", 5, 2, 0.4], ["Omar", null, 5, 0, 0], ["Priya", null, 5, 0, 0],
    ]);
    expect(r.totals).toMatchObject({ person: "Total", working: 20, off: 2.5, rate: 0.125 });
    const sickOnly = await absenceRate(ctx(A), { ...week(), planId: sick });
    expect(sickOnly.rows.map((x) => x.off)).toEqual([0.5, 0, 0, 0]);
    const opsOnly = await absenceRate(ctx(A), { ...week(), teamId: ops });
    expect(opsOnly.rows.map((x) => x.person)).toEqual(["Liam"]);
  });

  it("absence rate leaves out company holidays, and gives no rate without working days", async () => {
    await withTenant(A.tenantId, (tx) => tx`insert into company_holidays (tenant_id, day, action, name, created_by) values (${A.tenantId}, ${day(4)}, 'add', 'Founders day', ${priya})`);
    const r = await absenceRate(ctx(A), week());
    expect(r.rows.map((x) => [x.person, x.working, x.rate])).toEqual([["Liam", 4, 0.125], ["Maya", 4, 0.5], ["Omar", 4, 0], ["Priya", 4, 0]]);
    const weekend = await absenceRate(ctx(A), { from: day(5), to: day(6) });
    expect(weekend.rows.every((x) => x.working === 0 && x.rate === null)).toBe(true);
    expect(weekend.totals?.rate).toBeNull();
  });

  it("approval metrics count decisions, overrides and what is still waiting", async () => {
    const r = await approvalMetrics(ctx(A), {});
    expect(r.rows.map((x) => [x.approver, x.decided, x.approved, x.declined, x.rate, x.overrides])).toEqual([
      ["Omar", 2, 1, 1, 0.5, 0], ["Priya", 1, 1, 0, 0, 1],
    ]);
    for (const x of r.rows) { expect(x.hours).toBeGreaterThanOrEqual(0); expect(x.hours).toBeLessThan(1); }
    expect(r.totals).toMatchObject({ approver: "Total", decided: 3, approved: 2, declined: 1, overrides: 1, rate: 0.3333 });
    expect(r.notes).toEqual([`Still waiting now: 1 request, oldest waiting since ${formatDate(todayIn(A.timeZone))}`]);
    const past = await approvalMetrics(ctx(A), { from: "2020-01-01", to: "2020-01-31" });
    expect(past.rows).toEqual([]);
    expect(past.totals).toBeNull();
  });

  it("audit report shows names, compact details, search and newest first", async () => {
    await withTenant(A.tenantId, (tx) => writeAudit(tx, "system:nightly", "accrual.posted", { rows: 3, note: "x".repeat(300) }));
    const r = await auditReport(ctx(A), {});
    expect(r.totals).toBeNull();
    expect(r.columns.map((c) => c.label)).toEqual(["When", "Who", "Action", "Details"]);
    expect(r.rows[0]).toMatchObject({ who: "system:nightly", action: "accrual.posted", details: `note: ${"x".repeat(200)}...; rows: 3` });
    expect(r.rows[0].when).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    const times = r.rows.map((x) => String(x.when));
    expect([...times].sort().reverse()).toEqual(times);
    expect(r.rows.some((x) => x.who === "Maya" && x.action === "request.submitted")).toBe(true);
    expect(r.rows.some((x) => String(x.who).startsWith("person:"))).toBe(false);
    const q = await auditReport(ctx(A), { q: "NIGHTLY" });
    expect(q.filters[1]).toBe("Search: NIGHTLY");
    expect(q.rows.length).toBeGreaterThan(0);
    expect(q.rows.every((x) => x.who === "system:nightly")).toBe(true);
    const byName = await auditReport(ctx(A), { q: "maya" });
    expect(byName.rows.length).toBeGreaterThan(0);
    expect(byName.rows.every((x) => x.who === "Maya")).toBe(true);
    const byAction = await auditReport(ctx(A), { q: "request.declined" });
    expect(byAction.rows.map((x) => [x.who, x.action])).toEqual([["Omar", "request.declined"]]);
  });

  it("never shows another company's data", async () => {
    const all = [
      await whosOut(ctx(A), week()), await absenceRate(ctx(A), week()), await approvalMetrics(ctx(A), {}),
      await auditReport(ctx(A), {}), await auditReport(ctx(A), { q: "secret" }),
    ];
    expect(JSON.stringify(all)).not.toMatch(/Zed|Secret B plan|b\.secret|Harbor/);
    const b = await whosOut(ctx(B), week());
    expect(b.rows.map((x) => x.person)).toEqual(["Zed"]);
    expect(JSON.stringify(b)).not.toMatch(/Maya|Liam|Vacation/);
    expect((await absenceRate(ctx(B), week())).rows.map((x) => x.person)).toEqual(["Zed"]);
    expect((await auditReport(ctx(B), {})).rows.map((x) => x.action)).toContain("b.secret");
  });

  it("caps the audit report at 5000 rows and says so", async () => {
    await withTenant(A.tenantId, (tx) => tx`insert into audit_log (tenant_id, actor, action) select ${A.tenantId}, 'system:bulk', 'bulk.' || g from generate_series(1, 5001) g`);
    const r = await auditReport(ctx(A), {});
    expect(r.rows).toHaveLength(5000);
    expect(r.notes[0]).toMatch(/newest 5000/);
  });
});
