import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb, resetDb } from "./helpers";
import { closeDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { withTenant } from "@/lib/tenancy";
import { addDays, addYears, todayIn } from "@/lib/accrual/dates";
import { NotAllowed } from "@/lib/people";
import { exportReport, runReport, type RunAs } from "@/lib/reports";

const today = todayIn("America/Toronto");
const yearEnd = `${today.slice(0, 4)}-12-31`;

describe.skipIf(!hasDb)("balance reports", () => {
  let A: string, B: string, priya: string, tx1: string, ca1: string, on1: string, on2: string, vacation: string, thin: string;
  const admin = () => ({ personId: priya, role: "admin" as const });
  const as = (): RunAs => ({ tenantId: A, timeZone: "America/Toronto", runByName: "Priya Shah" });
  const run = async (key: string, f = {}) => (await runReport(admin(), as(), key, f))!;
  const byPerson = (rows: Record<string, unknown>[], name: string) => rows.filter((r) => r.person === name);

  beforeAll(async () => {
    await resetDb();
    const t = { customDomain: "", brandColor: "#2b6cb0" };
    A = ((await createTenant({ ...t, legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", country: "CA" }, "t")) as { id: string }).id;
    B = ((await createTenant({ ...t, legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", country: "US" }, "t")) as { id: string }).id;
    const add = (tenant: string, name: string, j: string, hire: string, hpd = 8, role = "employee") =>
      withTenant(tenant, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, hours_per_day, role)
        values (${tenant}, ${name}, ${name.toLowerCase().replace(/\W/g, "") + "@x.example"}, ${j}, ${hire}, ${hpd}, ${role}) returning id`)[0].id as string);
    priya = await add(A, "Priya Shah", "CA-ON", "2019-01-07", 8, "admin");
    tx1 = await add(A, "Tex Rivera", "US-TX", "2022-01-10", 8);
    ca1 = await add(A, "Cali Ng", "US-CA", "2022-01-10", 7.5);
    on1 = await add(A, "Omar Long", "CA-ON", "2015-01-12");
    on2 = await add(A, "Nina Soon", "CA-ON", addDays(addYears(today, -5), 30)); // 5-year anniversary in 30 days
    const other = await add(B, "Other Person", "US-NY", "2022-01-10");
    const plan = async (tenant: string, name: string, amount: number, who: string[]) => withTenant(tenant, async (tx) => {
      const [p] = await tx`insert into plans (tenant_id, name, category, accrual_method, lump_sum_timing, first_year_proration) values (${tenant}, ${name}, 'vacation', 'lump_sum', 'plan_year_start', false) returning id`;
      const [l] = await tx`insert into plan_levels (tenant_id, plan_id, name, annual_amount) values (${tenant}, ${p.id}, 'Standard', ${amount}) returning id`;
      for (const w of who) await tx`insert into plan_assignments (tenant_id, person_id, plan_id, level_id, effective_from) values (${tenant}, ${w}, ${p.id}, ${l.id}, ${`${today.slice(0, 4)}-01-01`})`;
      return p.id as string;
    });
    vacation = await plan(A, "Vacation", 15, [tx1, ca1, on1]);
    thin = await plan(A, "Thin vacation", 10, [on2]);
    await plan(B, "Vacation", 20, [other]);
  });
  afterAll(closeDb);

  it("is for HR admins only, and labels the company and the run", async () => {
    await expect(runReport({ personId: tx1, role: "employee" }, as(), "balances", {})).rejects.toBeInstanceOf(NotAllowed);
    const r = await run("balances", { planId: vacation });
    expect(r.companyName).toBe("Northwind Analytics Inc.");
    expect(r.runLabel).toMatch(/^Run on .* by Priya Shah$/);
    expect(r.filters).toEqual([expect.stringMatching(/^Balances on /), "Plan: Vacation"]);
  });

  it("summarises balances with totals, and only this company's people", async () => {
    const r = await run("balances", { planId: vacation });
    expect(r.rows.map((x) => x.person)).toEqual(["Cali Ng", "Omar Long", "Tex Rivera"]);
    expect(byPerson(r.rows, "Tex Rivera")[0]).toMatchObject({ entitlement: 15, available: 15, booked: 0, projected: 15, yearEnd });
    expect(r.totals).toMatchObject({ person: "Total", available: 45 });
  });

  it("converts unused vacation to hours at each person's hours per day", async () => {
    const r = await run("liability", { planId: vacation });
    expect(byPerson(r.rows, "Cali Ng")[0]).toMatchObject({ balance: 15, hoursPerDay: 7.5, hours: 112.5 });
    expect(byPerson(r.rows, "Tex Rivera")[0]).toMatchObject({ hours: 120 });
    expect(r.totals?.hours).toBe(352.5);
  });

  it("previews year end with the law applied", async () => {
    const r = await run("year-end", { planId: vacation, to: yearEnd });
    expect(byPerson(r.rows, "Tex Rivera")[0]).toMatchObject({ yearEnd, balance: 15, forfeit: 15, kept: 0, lost: 15 });
    expect(byPerson(r.rows, "Cali Ng")[0]).toMatchObject({ forfeit: 15, kept: 15, lost: 0 });
    // Ontario after 11 years: 3 weeks (15 days) protected, so nothing is lost.
    expect(byPerson(r.rows, "Omar Long")[0]).toMatchObject({ forfeit: 15, kept: 15, lost: 0 });
  });

  it("flags plans below a statutory minimum now and before an anniversary", async () => {
    const r = await run("compliance");
    const nina = byPerson(r.rows, "Nina Soon");
    expect(nina).toEqual([expect.objectContaining({ issue: "Below the minimum after 5 years of service", minimum: 15, gives: 10 })]);
    expect(byPerson(r.rows, "Omar Long")).toEqual([]); // 15 days meets the 3-week minimum
    expect(r.notes).toContain("Statutory figures come from published sources and are pending legal review.");
  });

  it("records every export with its filters", async () => {
    const file = await exportReport(admin(), as(), "liability", { planId: vacation }, "csv");
    expect(file?.name).toMatch(/^untaken-leave-liability-\d{4}-\d{2}-\d{2}\.csv$/);
    const [log] = await withTenant(A, (tx) => tx`select actor, detail from audit_log where action = 'report.exported'`);
    expect(log.actor).toBe(`person:${priya}`);
    expect(log.detail).toMatchObject({ report: "liability", format: "csv", filters: [expect.any(String), "Plan: Vacation"], rows: 3 });
  });
});
