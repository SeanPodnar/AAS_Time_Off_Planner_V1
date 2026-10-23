import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDb, quietMonday, resetDb } from "./helpers";
import { closeDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { withTenant } from "@/lib/tenancy";
import { outbox } from "@/lib/mailer";
import { addDays, todayIn } from "@/lib/accrual/dates";
import {
  adjustBalance, adminAddTimeOff, amendRequest, approvalCount, cancelRequest, decideRequest, listApprovals, listMyRequests,
  NotAllowed, previewRequest, submitRequest, type Company,
} from "@/lib/requests/service";

// Dates are relative to today so the tests keep working: M is a Monday at least four weeks out.
const today = todayIn("America/Toronto");
let M = "";
const day = (n: number) => addDays(M, n); // day(-3) is the Friday before M

describe.skipIf(!hasDb)("requests and approvals", () => {
  let A: Company, B: Company;
  let priya: string, omar: string, daniel: string, maya: string, hannah: string;
  let vacation: string, wellbeing: string, sick: string;
  const as = (personId: string, role: "employee" | "admin" = "employee") => ({ personId, role });
  const ledger = (personId: string, planId: string) =>
    withTenant(A.tenantId, (tx) => tx`select kind, amount::float as amount from accrual_ledger where person_id = ${personId} and plan_id = ${planId} and kind like 'booking%' order by created_at, source_key`);
  const status = async (id: string) => (await withTenant(A.tenantId, (tx) => tx`select status from requests where id = ${id}`))[0].status;
  const vac = (from: string, to: string, extra = {}) => ({ planId: vacation, startDate: from, endDate: to, ...extra });

  beforeAll(async () => {
    M = await quietMonday();
    await resetDb();
    const t = { customDomain: "", brandColor: "#2b6cb0" };
    const a = (await createTenant({ ...t, legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", country: "CA" }, "t")) as { id: string };
    const b = (await createTenant({ ...t, legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", country: "US" }, "t")) as { id: string };
    A = { tenantId: a.id, label: "Northwind", timeZone: "America/Toronto" };
    B = { tenantId: b.id, label: "Harbor & Pine", timeZone: "America/New_York" };
    const add = (tenant: string, name: string, role: string, manager: string | null) =>
      withTenant(tenant, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, role, manager_id)
        values (${tenant}, ${name}, ${name.toLowerCase() + "@x.example"}, 'CA-ON', '2022-01-10', ${role}, ${manager}) returning id`)[0].id as string);
    priya = await add(A.tenantId, "Priya", "admin", null);
    omar = await add(A.tenantId, "Omar", "employee", null);
    daniel = await add(A.tenantId, "Daniel", "employee", omar);
    maya = await add(A.tenantId, "Maya", "employee", daniel);
    hannah = await add(B.tenantId, "Hannah", "admin", null);
    await withTenant(A.tenantId, async (tx) => {
      const mk = async (name: string, category: string, method: string, mode: string, amount: number) => {
        const [p] = await tx`insert into plans (tenant_id, name, category, accrual_method, lump_sum_timing, approval_mode)
          values (${A.tenantId}, ${name}, ${category}, ${method}, ${method === "lump_sum" ? "plan_year_start" : null}, ${mode}) returning id`;
        const [l] = await tx`insert into plan_levels (tenant_id, plan_id, name, annual_amount) values (${A.tenantId}, ${p.id}, 'Standard', ${amount}) returning id`;
        for (const who of [priya, omar, daniel, maya]) {
          await tx`insert into plan_assignments (tenant_id, person_id, plan_id, level_id, effective_from) values (${A.tenantId}, ${who}, ${p.id}, ${l.id}, '2026-01-01')`;
        }
        return p.id as string;
      };
      vacation = await mk("Vacation", "vacation", "lump_sum", "manager", 15);
      wellbeing = await mk("Wellbeing", "wellbeing", "lump_sum", "manager", 3);
      sick = await mk("Sick", "sick", "lump_sum", "auto", 6);
    });
  });
  beforeEach(() => { outbox.length = 0; });
  afterAll(closeDb);

  it("previews days, balance, approvers and the run", async () => {
    const r = await previewRequest(A, as(maya), vac(day(0), day(4), { endPart: "am" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toMatchObject({ days: 4.5, amount: 4.5, availableAfter: r.summary.availableBefore! - 4.5, run: 5, secondApproval: false, approvers: ["Daniel"] });
  });

  it("needs a second approval when joined-up time off runs past 10 working days", async () => {
    const well = await submitRequest(A, as(maya), { planId: wellbeing, startDate: day(-3), endDate: day(-3) });
    expect(well).toMatchObject({ ok: true, status: "pending" });
    expect(outbox.map((e) => e.to)).toEqual(["daniel@x.example"]);
    expect(outbox[0].subject).toBe("Northwind: Time off request from Maya");

    const two = await submitRequest(A, as(maya), vac(day(0), day(11)));
    if (!two.ok) throw new Error(JSON.stringify(two.errors));
    const steps = await withTenant(A.tenantId, (tx) => tx`select role, approver_id, status from approval_steps where request_id = ${two.id} order by step_no`);
    expect(steps).toEqual([{ role: "manager", approver_id: daniel, status: "pending" }, { role: "next_manager", approver_id: omar, status: "waiting" }]);

    await expect(decideRequest(A, as(maya), two.id, "approve")).rejects.toBeInstanceOf(NotAllowed);
    await expect(decideRequest(A, as(omar), two.id, "approve")).rejects.toBeInstanceOf(NotAllowed); // not his step yet
    outbox.length = 0;
    expect(await decideRequest(A, as(daniel), two.id, "approve")).toMatchObject({ ok: true, status: "pending" });
    expect(outbox[0]).toMatchObject({ to: "omar@x.example", subject: "Northwind: Second approval needed from Maya" });
    expect(await approvalCount(A, as(omar))).toBe(1);
    expect(await decideRequest(A, as(omar), two.id, "approve")).toMatchObject({ ok: true, status: "approved" });
    expect(await ledger(maya, vacation)).toEqual([{ kind: "booking", amount: -10 }]);
    expect(outbox.at(-1)).toMatchObject({ to: "maya@x.example", subject: "Northwind: your time off was approved" });
    await decideRequest(A, as(daniel), well.ok ? well.id : "", "approve");
  });

  it("blocks overbooking and double booking", async () => {
    // 16 working days is more than Maya can have, whichever plan year these dates fall in
    // (Ontario keeps her statutory minimum across a year end, so the balance depends on the year).
    const over = await submitRequest(A, as(maya), vac(day(21), day(42)));
    expect(over.ok).toBe(false);
    expect((over as { errors: Record<string, string> }).errors.form).toMatch(/Not enough Vacation for this request: [\d.]+ days available, 16 needed/);
    const clash = await submitRequest(A, as(maya), { planId: sick, startDate: day(2), endDate: day(2) });
    expect((clash as { errors: Record<string, string> }).errors.startDate).toMatch(/already have time off/);
  });

  it("requires a comment to decline", async () => {
    const r = await submitRequest(A, as(daniel), vac(day(35), day(35)));
    if (!r.ok) throw new Error();
    expect((await decideRequest(A, as(omar), r.id, "decline")).ok).toBe(false);
    expect(await decideRequest(A, as(omar), r.id, "decline", "Team offsite that day")).toMatchObject({ ok: true, status: "declined" });
    expect(outbox.at(-1)?.text).toContain("Team offsite that day");
  });

  it("approves automatic plans at once", async () => {
    const r = await submitRequest(A, as(daniel), { planId: sick, startDate: day(14), endDate: day(14), startPart: "am", endPart: "am" });
    expect(r).toMatchObject({ ok: true, status: "approved" });
    expect(await ledger(daniel, sick)).toEqual([{ kind: "booking", amount: -0.5 }]);
  });

  it("keeps approved dates booked until a change is approved", async () => {
    const [orig] = (await listMyRequests(A, as(maya))).filter((r) => r.planId === vacation && r.status === "approved");
    const change = await amendRequest(A, as(maya), orig.id, vac(day(0), day(9)));
    if (!change.ok) throw new Error(JSON.stringify(change.errors));
    expect(change.status).toBe("pending");
    expect(await status(orig.id)).toBe("approved");
    expect(await ledger(maya, vacation)).toEqual([{ kind: "booking", amount: -10 }]);
    // 8 working days plus the Friday wellbeing day: one approval only.
    expect(await decideRequest(A, as(daniel), change.id, "approve")).toMatchObject({ ok: true, status: "approved" });
    expect(await status(orig.id)).toBe("superseded");
    const rows = await ledger(maya, vacation);
    expect(rows.reduce((a, r) => a + r.amount, 0)).toBe(-8);
  });

  it("sends cancellation of approved future time for approval, and withdraws pending at once", async () => {
    const [live] = (await listMyRequests(A, as(maya))).filter((r) => r.planId === vacation && r.status === "approved");
    const c = await cancelRequest(A, as(maya), live.id);
    expect(c).toMatchObject({ ok: true, status: "pending_cancellation" });
    const [pending] = await listApprovals(A, as(daniel));
    expect(pending.kind).toBe("cancel");
    await decideRequest(A, as(daniel), pending.id, "approve");
    expect(await status(live.id)).toBe("cancelled");
    expect((await ledger(maya, vacation)).reduce((a, r) => a + r.amount, 0)).toBe(0);

    const p = await submitRequest(A, as(maya), vac(day(42), day(42)));
    if (!p.ok) throw new Error();
    expect(await cancelRequest(A, as(maya), p.id)).toMatchObject({ ok: true, status: "cancelled" });
  });

  it("lets HR book for someone with a reason, but not approve their own", async () => {
    expect((await adminAddTimeOff(A, as(priya, "admin"), maya, vac(day(49), day(49)), { reason: "", approveNow: true, allowNegative: false })).ok).toBe(false);
    const r = await adminAddTimeOff(A, as(priya, "admin"), maya, vac(day(49), day(49)), { reason: "Phoned in", approveNow: true, allowNegative: false });
    expect(r).toMatchObject({ ok: true, status: "approved" });
    expect(outbox.at(-1)?.subject).toBe("Northwind: your time off was booked by HR");
    const own = await adminAddTimeOff(A, as(priya, "admin"), priya, vac(day(49), day(49)), { reason: "Mine", approveNow: true, allowNegative: false });
    expect((own as { errors: Record<string, string> }).errors.approveNow).toBeDefined();
    await expect(adminAddTimeOff(A, as(maya), daniel, vac(day(49), day(49)), { reason: "x", approveNow: true, allowNegative: false })).rejects.toBeInstanceOf(NotAllowed);
  });

  it("lets HR decide any step as a logged override", async () => {
    const r = await submitRequest(A, as(maya), { planId: wellbeing, startDate: day(56), endDate: day(56) });
    if (!r.ok) throw new Error();
    const list = await listApprovals(A, as(priya, "admin"));
    expect(list.find((x) => x.id === r.id)?.mine).toBe(false);
    await decideRequest(A, as(priya, "admin"), r.id, "approve");
    const [st] = await withTenant(A.tenantId, (tx) => tx`select override, decided_by from approval_steps where request_id = ${r.id}`);
    expect(st).toEqual({ override: true, decided_by: priya });
  });

  it("adjusts balances for HR only", async () => {
    await expect(adjustBalance(A, as(maya), {})).rejects.toBeInstanceOf(NotAllowed);
    expect((await adjustBalance(A, as(priya, "admin"), { personId: maya, planId: vacation, amount: "0", effectiveDate: today, reason: "x" })).ok).toBe(false);
    const r = await adjustBalance(A, as(priya, "admin"), { personId: maya, planId: vacation, amount: "2.5", effectiveDate: today, reason: "Worked a holiday" });
    expect(r.ok).toBe(true);
    const [row] = await withTenant(A.tenantId, (tx) => tx`select kind, amount::float as amount, reason from accrual_ledger where kind = 'adjustment'`);
    expect(row).toEqual({ kind: "adjustment", amount: 2.5, reason: "Worked a holiday" });
  });

  it("keeps other people's and other companies' requests out of reach", async () => {
    const [mine] = await listMyRequests(A, as(maya));
    expect((await cancelRequest(A, as(daniel), mine.id)).ok).toBe(false);
    expect(await listMyRequests(B, as(hannah, "admin"))).toEqual([]);
    expect(await listApprovals(B, as(hannah, "admin"))).toEqual([]);
    const r = await submitRequest(A, as(maya), { planId: wellbeing, startDate: day(63), endDate: day(63) });
    if (!r.ok) throw new Error();
    expect(await decideRequest(B, as(hannah, "admin"), r.id, "approve")).toMatchObject({ ok: false });
    expect(await status(r.id)).toBe("pending");
  });
});
