import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb, resetDb } from "./helpers";
import { closeDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { withTenant } from "@/lib/tenancy";
import { NotAllowed } from "@/lib/people";
import { previewRequest, type Company } from "@/lib/requests/service";
import { addCompanyHoliday, holidayCalendar, holidayDates, removeHolidayChange, skipHoliday } from "@/lib/holidays";

describe.skipIf(!hasDb)("holidays in day counts", () => {
  let A: Company, B: Company, priya: string, maya: string, jordan: string, vacation: string;
  const admin = () => ({ personId: priya, role: "admin" as const });
  const days = async (personId: string, startDate: string, endDate: string) => {
    const r = await previewRequest(A, { personId, role: "employee" }, { planId: vacation, startDate, endDate });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.summary.days;
  };

  beforeAll(async () => {
    await resetDb();
    const t = { customDomain: "", brandColor: "#2b6cb0" };
    const a = (await createTenant({ ...t, legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", country: "CA" }, "t")) as { id: string };
    const b = (await createTenant({ ...t, legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", country: "US" }, "t")) as { id: string };
    A = { tenantId: a.id, label: "Northwind", timeZone: "America/Toronto" };
    B = { tenantId: b.id, label: "Harbor & Pine", timeZone: "America/New_York" };
    const add = (name: string, jurisdiction: string, role = "employee") =>
      withTenant(A.tenantId, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, role)
        values (${A.tenantId}, ${name}, ${name.toLowerCase() + "@x.example"}, ${jurisdiction}, '2022-01-10', ${role}) returning id`)[0].id as string);
    priya = await add("Priya", "CA-ON", "admin");
    maya = await add("Maya", "CA-ON");
    jordan = await add("Jordan", "US-CA");
    vacation = await withTenant(A.tenantId, async (tx) => {
      const [p] = await tx`insert into plans (tenant_id, name, category, accrual_method, lump_sum_timing, negative_limit) values (${A.tenantId}, 'Vacation', 'vacation', 'lump_sum', 'plan_year_start', 20) returning id`;
      const [l] = await tx`insert into plan_levels (tenant_id, plan_id, name, annual_amount) values (${A.tenantId}, ${p.id}, 'Standard', 15) returning id`;
      for (const w of [priya, maya, jordan]) await tx`insert into plan_assignments (tenant_id, person_id, plan_id, level_id, effective_from) values (${A.tenantId}, ${w}, ${p.id}, ${l.id}, '2026-01-01')`;
      return p.id as string;
    });
  });
  afterAll(closeDb);

  it("leaves Ontario holidays out of a request over Christmas", async () => {
    // Dec 21 2026 to Jan 1 2027: Christmas (Fri), Boxing Day observed (Mon 28) and New Year's Day are holidays.
    expect(await days(maya, "2026-12-21", "2027-01-01")).toBe(7);
  });

  it("uses each person's own jurisdiction", async () => {
    // US federal: July 4 2026 is a Saturday, observed Friday July 3. Ontario has no holiday that week.
    expect(await days(jordan, "2026-06-29", "2026-07-03")).toBe(4);
    expect(await days(maya, "2026-07-06", "2026-07-10")).toBe(5);
  });

  it("applies company days off and skipped defaults", async () => {
    expect((await addCompanyHoliday(A.tenantId, admin(), { day: "2026-12-24", name: "Christmas Eve" })).ok).toBe(true);
    expect(await days(maya, "2026-12-21", "2027-01-01")).toBe(6);
    expect((await addCompanyHoliday(A.tenantId, admin(), { day: "2026-12-24", name: "Again" })).ok).toBe(false);

    const noReason = await skipHoliday(A.tenantId, admin(), { day: "2026-12-28", name: "Boxing Day (observed)", jurisdiction: "CA-ON" });
    expect(noReason).toMatchObject({ ok: false, errors: { reason: expect.stringMatching(/statutory/) } });
    expect((await skipHoliday(A.tenantId, admin(), { day: "2026-12-29", name: "Not a holiday", jurisdiction: "CA-ON" })).ok).toBe(false);
    const skip = await skipHoliday(A.tenantId, admin(), { day: "2026-12-28", name: "Boxing Day (observed)", jurisdiction: "CA-ON", reason: "Substitute day Dec 24" });
    expect(skip.ok).toBe(true);
    expect(await days(maya, "2026-12-21", "2027-01-01")).toBe(7);

    const cal = await holidayCalendar(A.tenantId, admin(), "CA-ON", 2026);
    expect(cal.find((h) => h.date === "2026-12-28")).toMatchObject({ skipped: true, source: "statutory" });
    expect(cal.find((h) => h.date === "2026-12-24")).toMatchObject({ source: "company", name: "Christmas Eve" });

    if (!skip.ok) throw new Error();
    expect((await removeHolidayChange(A.tenantId, admin(), skip.id)).ok).toBe(true);
    expect(await days(maya, "2026-12-21", "2027-01-01")).toBe(6);
  });

  it("is HR only and stays inside the company", async () => {
    await expect(addCompanyHoliday(A.tenantId, { personId: maya, role: "employee" }, { day: "2026-08-14", name: "x" })).rejects.toBeInstanceOf(NotAllowed);
    await expect(holidayCalendar(A.tenantId, { personId: maya, role: "employee" }, "CA-ON", 2026)).rejects.toBeInstanceOf(NotAllowed);
    const inB = await withTenant(B.tenantId, (tx) => holidayDates(tx, "CA-ON", "2026-12-20", "2026-12-31"));
    expect(inB.has("2026-12-24")).toBe(false);
    expect(inB.has("2026-12-25")).toBe(true);
  });
});
