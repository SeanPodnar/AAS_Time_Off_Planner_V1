import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb, quietMonday, resetDb } from "./helpers";
import { closeDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { withTenant } from "@/lib/tenancy";
import { addDays } from "@/lib/accrual/dates";
import { decideRequest, NotAllowed, submitRequest, type Company } from "@/lib/requests/service";
import { renderFeed, resetFeed, revokeFeed, teamCalendar } from "@/lib/calendar/service";

describe.skipIf(!hasDb)("team calendar and feeds", () => {
  let A: Company, B: Company, M: string;
  let priya: string, omar: string, daniel: string, maya: string, liam: string, sam: string;
  let vacation: string, sick: string, personal: string;
  const as = (personId: string, role: "employee" | "admin" = "employee") => ({ personId, role });
  const day = (n: number) => addDays(M, n);
  const view = async (viewer: string, role: "employee" | "admin" = "employee", planId?: string) =>
    (await teamCalendar(A, as(viewer, role), { from: day(0), to: day(13), planId })).entries.filter((e) => e.personId === maya).map((e) => `${e.day} ${e.label}${e.status === "pending" ? " ?" : ""}`);

  beforeAll(async () => {
    M = await quietMonday();
    await resetDb();
    const t = { customDomain: "", brandColor: "#2b6cb0" };
    const a = (await createTenant({ ...t, legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", country: "CA" }, "t")) as { id: string };
    const b = (await createTenant({ ...t, legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", country: "US" }, "t")) as { id: string };
    A = { tenantId: a.id, label: "Northwind", timeZone: "America/Toronto" };
    B = { tenantId: b.id, label: "Harbor & Pine", timeZone: "America/New_York" };
    const add = (name: string, role: string, manager: string | null) =>
      withTenant(A.tenantId, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, role, manager_id)
        values (${A.tenantId}, ${name}, ${name.toLowerCase() + "@x.example"}, 'CA-ON', '2022-01-10', ${role}, ${manager}) returning id`)[0].id as string);
    priya = await add("Priya", "admin", null);
    omar = await add("Omar", "employee", null);
    daniel = await add("Daniel", "employee", omar);
    maya = await add("Maya", "employee", daniel);
    liam = await add("Liam", "employee", daniel);
    sam = await add("Sam", "employee", null);
    await withTenant(A.tenantId, async (tx) => {
      await tx`insert into person_managers (tenant_id, person_id, manager_id) values (${A.tenantId}, ${maya}, ${sam})`;
      const mk = async (name: string, visibility: string, mode: string) => {
        const [p] = await tx`insert into plans (tenant_id, name, category, accrual_method, lump_sum_timing, approval_mode, visibility)
          values (${A.tenantId}, ${name}, 'other', 'lump_sum', 'plan_year_start', ${mode}, ${visibility}) returning id`;
        const [l] = await tx`insert into plan_levels (tenant_id, plan_id, name, annual_amount) values (${A.tenantId}, ${p.id}, 'Standard', 10) returning id`;
        for (const w of [priya, omar, daniel, maya, liam, sam]) await tx`insert into plan_assignments (tenant_id, person_id, plan_id, level_id, effective_from) values (${A.tenantId}, ${w}, ${p.id}, ${l.id}, '2026-01-01')`;
        return p.id as string;
      };
      vacation = await mk("Vacation", "name", "manager");
      sick = await mk("Sick", "out_of_office", "auto");
      personal = await mk("Personal", "hidden", "auto");
    });
    const v = await submitRequest(A, as(maya), { planId: vacation, startDate: day(0), endDate: day(0), comment: "Dentist, secret" });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    await decideRequest(A, as(daniel), v.id, "approve");
    await submitRequest(A, as(maya), { planId: sick, startDate: day(1), endDate: day(1), comment: "Migraine" });
    await submitRequest(A, as(maya), { planId: personal, startDate: day(2), endDate: day(2) });
    await submitRequest(A, as(maya), { planId: vacation, startDate: day(3), endDate: day(3) }); // stays pending
  });
  afterAll(closeDb);

  it("shows coworkers approved time as each plan allows", async () => {
    expect(await view(liam)).toEqual([`${day(0)} Vacation`, `${day(1)} Out of office`]);
  });

  it("shows plan names and pending time to managers at any level, secondary managers and HR", async () => {
    const full = [`${day(0)} Vacation`, `${day(1)} Sick`, `${day(2)} Personal`, `${day(3)} Vacation ?`];
    for (const [who, role] of [[daniel, "employee"], [omar, "employee"], [sam, "employee"], [priya, "admin"], [maya, "employee"]] as const) {
      expect(await view(who, role)).toEqual(full);
    }
  });

  it("doesn't let a plan filter reveal a private plan", async () => {
    expect(await view(liam, "employee", sick)).toEqual([]);
    expect(await view(daniel, "employee", sick)).toEqual([`${day(1)} Sick`]);
    const plans = (await teamCalendar(A, as(liam), { from: day(0), to: day(1) })).plans.map((p) => p.name);
    expect(plans).toEqual(["Vacation"]);
  });

  it("gives each feed only what a coworker could see, and never comments", async () => {
    const me = await resetFeed(A, as(maya), "me");
    const team = await resetFeed(A, as(liam), "team");
    const reports = await resetFeed(A, as(daniel), "reports");
    if (!me.ok || !team.ok || !reports.ok) throw new Error();
    const mine = (await renderFeed(A, me.token, "northwind.example"))!;
    expect(mine.match(/SUMMARY:.*/g)).toEqual(["SUMMARY:Vacation", "SUMMARY:Out of office", "SUMMARY:Out of office", "SUMMARY:Vacation (pending)"]);
    const theirs = (await renderFeed(A, team.token, "northwind.example"))!;
    expect(theirs.match(/SUMMARY:.*/g)).toEqual(["SUMMARY:Maya: Vacation", "SUMMARY:Maya: Out of office"]);
    const managed = (await renderFeed(A, reports.token, "northwind.example"))!;
    expect(managed.match(/SUMMARY:.*/g)).toEqual(["SUMMARY:Maya: Vacation", "SUMMARY:Maya: Out of office"]);
    for (const ics of [mine, theirs, managed]) {
      expect(ics).not.toMatch(/Dentist|secret|Migraine|Personal|Sick/);
    }
  });

  it("revokes old links, and refuses other companies, inactive owners and non-managers", async () => {
    const first = await resetFeed(A, as(maya), "me");
    const second = await resetFeed(A, as(maya), "me");
    if (!first.ok || !second.ok) throw new Error();
    expect(await renderFeed(A, first.token, "x")).toBeNull();
    expect(await renderFeed(A, second.token, "x")).not.toBeNull();
    expect(await renderFeed(B, second.token, "x")).toBeNull();
    expect(await renderFeed(A, "not-a-token", "x")).toBeNull();
    await expect(resetFeed(A, as(liam), "reports")).rejects.toBeInstanceOf(NotAllowed);
    await revokeFeed(A, as(maya), "me");
    expect(await renderFeed(A, second.token, "x")).toBeNull();
    const again = await resetFeed(A, as(maya), "me");
    if (!again.ok) throw new Error();
    await withTenant(A.tenantId, (tx) => tx`update people set status = 'inactive' where id = ${maya}`);
    expect(await renderFeed(A, again.token, "x")).toBeNull();
  });
});
