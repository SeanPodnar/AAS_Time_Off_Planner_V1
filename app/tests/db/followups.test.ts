import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDb, quietMonday, resetDb } from "./helpers";
import { closeDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { withTenant } from "@/lib/tenancy";
import { outbox } from "@/lib/mailer";
import { addDays, todayIn } from "@/lib/accrual/dates";
import { approvalCount, decideRequest, listApprovals, NotAllowed, submitRequest, type Company } from "@/lib/requests/service";
import { businessDaysBetween, listBackups, removeBackup, sendFollowUps, setBackup } from "@/lib/requests/followups";

const today = todayIn("America/Toronto");
let M = "";
const day = (n: number) => addDays(M, n);
const later = (calendarDays: number) => new Date(Date.now() + calendarDays * 86_400_000);

describe("business days", () => {
  it("counts Monday to Friday after the start date", () => {
    expect(businessDaysBetween("2026-11-06", "2026-11-10")).toBe(2); // Fri -> Tue
    expect(businessDaysBetween("2026-11-02", "2026-11-09")).toBe(5);
    expect(businessDaysBetween("2026-11-02", "2026-11-02")).toBe(0);
  });
});

describe.skipIf(!hasDb)("reminders, escalation and backups", () => {
  let A: Company, priya: string, omar: string, daniel: string, maya: string, liam: string, vacation: string;
  const as = (personId: string, role: "employee" | "admin" = "employee") => ({ personId, role });

  beforeAll(async () => {
    M = await quietMonday();
    await resetDb();
    const a = (await createTenant({ customDomain: "", brandColor: "#2b6cb0", legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", country: "CA" }, "t")) as { id: string };
    A = { tenantId: a.id, label: "Northwind", timeZone: "America/Toronto", baseUrl: "http://northwind.localhost:3100" };
    const add = (name: string, role: string, manager: string | null) =>
      withTenant(A.tenantId, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, role, manager_id)
        values (${A.tenantId}, ${name}, ${name.toLowerCase() + "@x.example"}, 'CA-ON', '2022-01-10', ${role}, ${manager}) returning id`)[0].id as string);
    priya = await add("Priya", "admin", null);
    omar = await add("Omar", "employee", null);
    daniel = await add("Daniel", "employee", omar);
    maya = await add("Maya", "employee", daniel);
    liam = await add("Liam", "employee", daniel);
    vacation = await withTenant(A.tenantId, async (tx) => {
      const [p] = await tx`insert into plans (tenant_id, name, category, accrual_method, lump_sum_timing) values (${A.tenantId}, 'Vacation', 'vacation', 'lump_sum', 'plan_year_start') returning id`;
      const [l] = await tx`insert into plan_levels (tenant_id, plan_id, name, annual_amount) values (${A.tenantId}, ${p.id}, 'Standard', 15) returning id`;
      for (const w of [priya, omar, daniel, maya, liam]) await tx`insert into plan_assignments (tenant_id, person_id, plan_id, level_id, effective_from) values (${A.tenantId}, ${w}, ${p.id}, ${l.id}, '2026-01-01')`;
      return p.id as string;
    });
  });
  beforeEach(() => { outbox.length = 0; });
  afterAll(closeDb);

  it("reminds the approver once, then tells HR once", async () => {
    const r = await submitRequest(A, as(maya), { planId: vacation, startDate: day(0), endDate: day(1) });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    outbox.length = 0;
    expect(await sendFollowUps(A)).toEqual({ reminded: 0, escalated: 0 });
    expect(await sendFollowUps(A, later(4))).toEqual({ reminded: 1, escalated: 0 });
    expect(outbox.map((e) => [e.to, e.subject])).toEqual([["daniel@x.example", "Northwind: reminder, time off request from Maya"]]);
    expect(outbox[0].text).toContain("http://northwind.localhost:3100/approvals");
    expect(await sendFollowUps(A, later(4))).toEqual({ reminded: 0, escalated: 0 });
    outbox.length = 0;
    expect(await sendFollowUps(A, later(9))).toEqual({ reminded: 0, escalated: 1 });
    expect(outbox.map((e) => e.to)).toEqual(["priya@x.example"]);
    expect(await sendFollowUps(A, later(20))).toEqual({ reminded: 0, escalated: 0 });
    await decideRequest(A, as(daniel), r.id, "approve");
  });

  it("lets a backup decide the approver's requests while they are away", async () => {
    await expect(setBackup(A, as(maya), { approverId: daniel, backupId: liam, startDate: today, endDate: addDays(today, 7) })).rejects.toBeInstanceOf(NotAllowed);
    expect((await setBackup(A, as(daniel), { approverId: daniel, backupId: daniel, startDate: today, endDate: today })).ok).toBe(false);
    const set = await setBackup(A, as(daniel), { approverId: daniel, backupId: liam, startDate: today, endDate: addDays(today, 7) });
    expect(set.ok).toBe(true);
    expect((await setBackup(A, as(priya, "admin"), { approverId: daniel, backupId: omar, startDate: addDays(today, 3), endDate: addDays(today, 9) })).ok).toBe(false); // overlaps

    const r = await submitRequest(A, as(maya), { planId: vacation, startDate: day(7), endDate: day(7) });
    if (!r.ok) throw new Error();
    expect(outbox.map((e) => e.to).sort()).toEqual(["daniel@x.example", "liam@x.example"]);
    expect(await approvalCount(A, as(liam))).toBe(1);
    const [item] = await listApprovals(A, as(liam));
    expect(item).toMatchObject({ id: r.id, mine: true, coveringFor: daniel });
    expect(await decideRequest(A, as(liam), r.id, "approve")).toMatchObject({ ok: true, status: "approved" });
    const [st] = await withTenant(A.tenantId, (tx) => tx`select decided_by, override from approval_steps where request_id = ${r.id}`);
    expect(st).toEqual({ decided_by: liam, override: false });
  });

  it("never lets a backup approve their own time off", async () => {
    const own = await submitRequest(A, as(liam), { planId: vacation, startDate: day(14), endDate: day(14) });
    if (!own.ok) throw new Error();
    expect(outbox.map((e) => e.to)).toEqual(["daniel@x.example"]); // the backup is not asked about their own request
    expect(await listApprovals(A, as(liam))).toEqual([]);
    await expect(decideRequest(A, as(liam), own.id, "approve")).rejects.toBeInstanceOf(NotAllowed);
  });

  it("lists and removes backups for the approver or HR only", async () => {
    const [b] = await listBackups(A, as(liam));
    expect(b).toMatchObject({ approverName: "Daniel", backupName: "Liam" });
    expect(await listBackups(A, as(maya))).toEqual([]);
    await expect(removeBackup(A, as(liam), b.id)).rejects.toBeInstanceOf(NotAllowed);
    expect((await removeBackup(A, as(priya, "admin"), b.id)).ok).toBe(true);
    expect(await approvalCount(A, as(liam))).toBe(0);
  });
});
