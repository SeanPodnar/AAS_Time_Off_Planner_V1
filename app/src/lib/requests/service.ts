// Requests and approvals (FR-50 to FR-57). Every function runs inside withTenant, so one
// company can never read or change another's requests. Each decision writes the request,
// its steps, any ledger rows and the audit entry in one transaction; emails go out after commit.
//
// Balances move only through accrual_ledger. Approval books the days (kind booking); a later
// change or cancellation reverses them (booking_reversal). Pending requests do not touch the
// ledger but count against what is available, so people cannot overbook while waiting.
import { z } from "zod";
import type postgres from "postgres";
import { withTenant, writeAudit } from "../tenancy";
import { sendEmail, type Email } from "../mailer";
import { NotAllowed, type Actor } from "../people";
import { addDays, todayIn, type ISODate } from "../accrual/dates";
import { loadContext, loadRules, postAccruals, type Context } from "../accrual/post";
import { computeDueRows, planYearStart } from "../accrual/schedule";
import { holidayDates } from "../holidays";
import { partsClash, partValue, requestDays, runLength, totalDays, type DayPart, type Part, type Schedule } from "./days";

export { NotAllowed };
type Tx = postgres.TransactionSql;

/** Company context the service needs: the site's tenant, short label (for email subjects) and time zone. */
export type Company = { tenantId: string; label: string; timeZone: string; baseUrl?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;
const d = (v: unknown): ISODate => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
export const requestInput = z.object({
  planId: z.string().regex(UUID, "Choose a plan."),
  startDate: z.string().refine(validDate, "Enter the first day."),
  endDate: z.string().refine(validDate, "Enter the last day."),
  startPart: z.enum(["full", "am", "pm"]).default("full"),
  endPart: z.enum(["full", "am", "pm"]).default("full"),
  comment: z.preprocess(blankToNull, z.string().trim().max(1000, "Keep the comment to 1000 characters or fewer.").nullable()).default(null),
});
export type RequestInput = z.input<typeof requestInput>;

export type Errors = Record<string, string>;
export type Result<T = object> = ({ ok: true } & T) | { ok: false; errors: Errors };

// Loading ---------------------------------------------------------------------------------

type PersonRow = { id: string; fullName: string; email: string; managerId: string | null; teamId: string | null; hireDate: ISODate; workDays: number[]; hoursPerDay: number; status: string; jurisdiction: string };
async function person(tx: Tx, id: string): Promise<PersonRow | null> {
  const [p] = await tx`select id, full_name, email, manager_id, team_id, hire_date, work_days, hours_per_day, status, jurisdiction from people where id = ${id}`;
  return p ? { id: p.id, fullName: p.full_name, email: p.email, managerId: p.manager_id, teamId: p.team_id, hireDate: d(p.hire_date), workDays: p.work_days.map(Number), hoursPerDay: Number(p.hours_per_day), status: p.status, jurisdiction: p.jurisdiction } : null;
}

type PlanRow = { id: string; name: string; unit: "days" | "hours"; accrualMethod: string; approvalMode: "auto" | "manager" | "admin"; secondApproval: boolean; negativeLimit: number; waitingPeriodDays: number; counts: "working_days" | "calendar_days"; visibility: string; cancelNeedsApproval: boolean; active: boolean };
async function plan(tx: Tx, id: string): Promise<PlanRow | null> {
  const [p] = await tx`select * from plans where id = ${id}`;
  return p ? {
    id: p.id, name: p.name, unit: p.unit, accrualMethod: p.accrual_method, approvalMode: p.approval_mode, secondApproval: p.second_approval,
    negativeLimit: Number(p.negative_limit), waitingPeriodDays: Number(p.waiting_period_days), counts: p.counts, visibility: p.visibility,
    cancelNeedsApproval: p.cancel_needs_approval, active: p.active,
  } : null;
}

async function threshold(tx: Tx) {
  const [s] = await tx`select second_approval_threshold from tenant_settings`;
  return s ? Number(s.second_approval_threshold) : 10;
}

/**
 * The person's work days and holidays (their jurisdiction's defaults with the company's changes)
 * around a date range. The window reaches a year either side so the run of joined-up time off
 * sees holidays that sit between bookings.
 */
async function scheduleFor(tx: Tx, p: PersonRow, from: ISODate, to: ISODate): Promise<Schedule> {
  return { workDays: p.workDays, holidays: await holidayDates(tx, p.jurisdiction, addDays(from, -370), addDays(to, 370)) };
}

/** Live days a person has booked or requested, excluding the given requests. Cancellation requests add no days. */
async function liveDays(tx: Tx, personId: string, exclude: string[]) {
  const rows = await tx`
    select rd.day, rd.part, r.id from request_days rd join requests r on r.id = rd.request_id
     where r.person_id = ${personId} and r.status in ('pending', 'approved') and r.kind <> 'cancel'
       and not (r.id = any(${exclude}::uuid[]))`;
  return rows.map((r) => ({ day: d(r.day), part: r.part as Part, requestId: r.id as string }));
}

// Balance ---------------------------------------------------------------------------------

/**
 * What the person can still book on `date` in this plan: ledger rows dated on or before it,
 * credits the engine says will be due by then, all booked leave (even later dates), minus
 * pending requests not yet in the ledger. `release` adds back a booking that a change would reverse.
 */
async function availableOn(tx: Tx, c: Context, date: ISODate, excludePending: string[], release: number) {
  const rules = await loadRules(tx);
  const due = computeDueRows({ ...c, rules, asOf: date }).rows;
  const ledger = c.existing.filter((r) => r.effectiveDate <= date || r.kind === "booking" || r.kind === "booking_reversal").reduce((a, r) => a + r.amount, 0);
  const projected = due.filter((r) => r.effectiveDate <= date).reduce((a, r) => a + r.amount, 0);
  const [{ pending }] = await tx`
    select coalesce(sum(amount), 0)::float as pending from requests
     where person_id = ${c.person.id} and plan_id = ${c.plan.id} and status = 'pending' and kind <> 'cancel'
       and not (id = any(${excludePending}::uuid[]))`;
  return r3(ledger + projected - Number(pending) + release);
}

async function bookedAmount(tx: Tx, requestId: string) {
  const [{ n }] = await tx`select coalesce(sum(amount), 0)::float as n from accrual_ledger where source_key like ${`bk:${requestId}:%`} or source_key like ${`bkr:${requestId}:%`}`;
  return -Number(n); // positive: what is currently booked
}

// Validation and summary ------------------------------------------------------------------

export type Summary = {
  days: number; amount: number; unit: "days" | "hours"; tracked: boolean;
  availableBefore: number | null; availableAfter: number | null;
  run: number; secondApproval: boolean; approvers: string[];
  teamOff: { name: string; label: string | null; from: ISODate; to: ISODate }[];
  dayList: DayPart[];
};

type Draft = { input: z.output<typeof requestInput>; who: PersonRow; p: PlanRow; days: DayPart[]; summary: Summary };

/**
 * Checks a request and works out its summary. `replacing` is the approved request a change
 * would replace (its days don't count as overlap and its booking is added back), `editing` a
 * pending request being edited in place.
 */
async function draft(tx: Tx, company: Company, actor: Actor, personId: string, raw: unknown, opts: { replacing?: string; editing?: string; allowNegative?: boolean } = {}): Promise<Draft | { errors: Errors }> {
  const parsed = requestInput.safeParse(raw ?? {});
  if (!parsed.success) {
    const errors: Errors = {};
    for (const i of parsed.error.issues) errors[String(i.path[0] ?? "form")] ??= i.message;
    return { errors };
  }
  const input = parsed.data;
  if (!UUID.test(personId)) return { errors: { form: "That person can't book time off." } };
  // One booking at a time per person, so two requests sent together can't both pass the balance check.
  await tx`select 1 from people where id = ${personId} for update`;
  const who = await person(tx, personId);
  if (!who || who.status !== "active") return { errors: { form: "That person can't book time off." } };
  const p = await plan(tx, input.planId);
  if (!p) return { errors: { planId: "Choose a plan." } };
  const errors: Errors = {};
  const { startDate: s, endDate: e } = input;
  if (e < s) errors.endDate = "The last day can't be before the first day.";
  else if (addDays(s, 366) < e) errors.endDate = "Book up to a year at a time.";
  if (s === e && input.startPart !== input.endPart) input.endPart = input.startPart;
  if (s < e && input.startPart === "am") errors.startPart = "A half day at the start of a longer absence is the afternoon.";
  if (s < e && input.endPart === "pm") errors.endPart = "A half day at the end of a longer absence is the morning.";
  if (Object.keys(errors).length) return { errors };

  const [assigned] = await tx`select 1 as x from plan_assignments where person_id = ${personId} and plan_id = ${p.id}
                               and effective_from <= ${s} and (effective_to is null or effective_to > ${e})`;
  if (!assigned) return { errors: { planId: "This plan doesn't cover those dates for this person." } };
  if (!p.active) return { errors: { planId: "This plan is no longer in use." } };
  const earliest = addDays(who.hireDate, p.waitingPeriodDays);
  if (s < earliest) return { errors: { startDate: `This plan can be used from ${earliest}.` } };

  const schedule = await scheduleFor(tx, who, s, e);
  const days = requestDays(schedule, s, e, input.startPart, input.endPart, p.counts);
  if (days.length === 0) return { errors: { startDate: "Those dates have no working days (weekends and holidays are not counted)." } };

  const exclude = [opts.replacing, opts.editing].filter(Boolean) as string[];
  const others = await liveDays(tx, personId, exclude);
  const clash = days.find((x) => others.some((o) => o.day === x.day && partsClash(o.part, x.part)));
  if (clash) return { errors: { startDate: `You already have time off on ${clash.day}.` } };

  const count = totalDays(days);
  const amount = r3(p.unit === "hours" ? count * who.hoursPerDay : count);
  const tracked = p.accrualMethod !== "none";
  let availableBefore: number | null = null, availableAfter: number | null = null;
  if (tracked) {
    const c = (await loadContext(tx, personId, p.id))!;
    const release = opts.replacing ? await bookedAmount(tx, opts.replacing) : 0;
    availableBefore = await availableOn(tx, c, s, exclude, release);
    availableAfter = r3(availableBefore - amount);
    if (availableAfter < -p.negativeLimit && !(opts.allowNegative && actor.role === "admin")) {
      return { errors: { form: `Not enough ${p.name} for this request: ${availableBefore} ${p.unit} available, ${amount} needed.` } };
    }
  }

  const run = runLength(schedule, days.map((x) => x.day), others.map((o) => o.day));
  const limit = await threshold(tx);
  const secondApproval = p.approvalMode === "manager" && p.secondApproval && run > limit;
  const steps = await planSteps(tx, who, p, secondApproval);
  const approvers = steps.length === 0 ? ["Approved automatically"] : await Promise.all(steps.map(async (st) => st.approverId ? (await person(tx, st.approverId))!.fullName : "HR"));

  // Teammates already off: same team or same manager. Coworkers see only what the plan allows.
  const team = await tx`
    select p.full_name, pl.name as plan_name, pl.visibility, min(rd.day) as first, max(rd.day) as last
      from request_days rd join requests r on r.id = rd.request_id join people p on p.id = r.person_id join plans pl on pl.id = r.plan_id
     where r.status in ('pending', 'approved') and r.kind <> 'cancel' and r.person_id <> ${personId}
       and rd.day between ${s} and ${e}
       and ((${who.teamId}::uuid is not null and p.team_id = ${who.teamId}) or (${who.managerId}::uuid is not null and p.manager_id = ${who.managerId}))
       and pl.visibility <> 'hidden'
     group by p.full_name, pl.name, pl.visibility order by p.full_name`;
  const teamOff = team.map((t) => ({ name: t.full_name, label: t.visibility === "name" ? t.plan_name : "Out of office", from: d(t.first), to: d(t.last) }));

  return { input, who, p, days, summary: { days: count, amount, unit: p.unit, tracked, availableBefore, availableAfter, run, secondApproval, approvers, teamOff, dayList: days } };
}

type StepPlan = { role: "manager" | "next_manager" | "admin"; approverId: string | null };

/** Approval steps for a request. Manager steps fall back to HR when the manager is missing or inactive. */
async function planSteps(tx: Tx, who: PersonRow, p: PlanRow, second: boolean): Promise<StepPlan[]> {
  if (p.approvalMode === "auto") return [];
  if (p.approvalMode === "admin") return [{ role: "admin", approverId: null }];
  const mgr = who.managerId ? await person(tx, who.managerId) : null;
  if (!mgr || mgr.status !== "active") return [{ role: "admin", approverId: null }];
  const steps: StepPlan[] = [{ role: "manager", approverId: mgr.id }];
  if (second) {
    const next = mgr.managerId ? await person(tx, mgr.managerId) : null;
    steps.push(next && next.status === "active" && next.id !== who.id ? { role: "next_manager", approverId: next.id } : { role: "admin", approverId: null });
  }
  return steps;
}

// Writing ---------------------------------------------------------------------------------

async function writeDays(tx: Tx, tenantId: string, requestId: string, days: DayPart[]) {
  await tx`delete from request_days where request_id = ${requestId}`;
  for (const x of days) await tx`insert into request_days (tenant_id, request_id, day, part) values (${tenantId}, ${requestId}, ${x.day}, ${x.part})`;
}

async function writeSteps(tx: Tx, tenantId: string, requestId: string, steps: StepPlan[]) {
  await tx`delete from approval_steps where request_id = ${requestId}`;
  for (const [i, st] of steps.entries()) {
    await tx`insert into approval_steps (tenant_id, request_id, step_no, role, approver_id, status, pending_since)
             values (${tenantId}, ${requestId}, ${i + 1}, ${st.role}, ${st.approverId}, ${i === 0 ? "pending" : "waiting"}, ${i === 0 ? tx`now()` : null})`;
  }
}

/** Books an approved request's days, one ledger row per plan year it touches. Untracked plans book nothing. */
async function book(tx: Tx, tenantId: string, requestId: string, actor: string) {
  const [r] = await tx`select person_id, plan_id from requests where id = ${requestId}`;
  const c = (await loadContext(tx, r.person_id, r.plan_id))!;
  if (c.plan.accrualMethod === "none") return;
  const days = await tx`select day, part from request_days where request_id = ${requestId} order by day`;
  const byYear = new Map<ISODate, { first: ISODate; days: number }>();
  for (const x of days) {
    const day = d(x.day);
    const y = planYearStart(c.plan, c.person, day);
    const g = byYear.get(y) ?? { first: day, days: 0 };
    g.days += partValue(x.part);
    byYear.set(y, g);
  }
  for (const [y, g] of byYear) {
    const amount = r3(c.plan.unit === "hours" ? g.days * c.person.hoursPerDay : g.days);
    await tx`insert into accrual_ledger (tenant_id, person_id, plan_id, effective_date, plan_year, kind, amount, source_key, reason, created_by)
             values (${tenantId}, ${r.person_id}, ${r.plan_id}, ${g.first}, ${y}, 'booking', ${-amount}, ${`bk:${requestId}:${y}`}, ${`Time off ${g.days} days`}, ${actor})
             on conflict (tenant_id, source_key) do nothing`;
  }
}

/** Reverses whatever a request booked. */
async function unbook(tx: Tx, tenantId: string, requestId: string, actor: string, reason: string) {
  const rows = await tx`select person_id, plan_id, effective_date, plan_year, amount, source_key from accrual_ledger where source_key like ${`bk:${requestId}:%`}`;
  for (const b of rows) {
    await tx`insert into accrual_ledger (tenant_id, person_id, plan_id, effective_date, plan_year, kind, amount, source_key, reason, created_by)
             values (${tenantId}, ${b.person_id}, ${b.plan_id}, ${b.effective_date}, ${b.plan_year}, 'booking_reversal', ${-Number(b.amount)}, ${"bkr:" + String(b.source_key).slice(3)}, ${reason}, ${actor})
             on conflict (tenant_id, source_key) do nothing`;
  }
}

// Emails ----------------------------------------------------------------------------------

type Outgoing = Email[];
const fmtDates = (s: ISODate, e: ISODate) => (s === e ? s : `${s} to ${e}`);
async function adminEmails(tx: Tx, except: string) {
  return (await tx`select email from people where role = 'admin' and status = 'active' and id <> ${except}`).map((r) => r.email as string);
}
/** Active backups for an approver today, excluding the requester (nobody is asked to approve their own time off). */
async function backupEmails(tx: Tx, approverId: string, on: ISODate, requesterId: string) {
  return (await tx`select p.email from approval_backups b join people p on p.id = b.backup_id
                    where b.approver_id = ${approverId} and ${on} between b.start_date and b.end_date and p.status = 'active' and p.id <> ${requesterId}`).map((r) => r.email as string);
}
/** Approvers this person is covering for today. */
async function coveredFor(tx: Tx, personId: string, on: ISODate): Promise<string[]> {
  return (await tx`select approver_id from approval_backups where backup_id = ${personId} and ${on} between start_date and end_date`).map((r) => r.approver_id as string);
}

async function notifyStep(tx: Tx, company: Company, out: Outgoing, requestId: string, subjectLead: string) {
  const [st] = await tx`select s.role, a.email, a.id as approver from approval_steps s left join people a on a.id = s.approver_id where s.request_id = ${requestId} and s.status = 'pending'`;
  if (!st) return;
  const [r] = await tx`select r.start_date, r.end_date, r.days, r.person_id, p.full_name, pl.name as plan_name from requests r join people p on p.id = r.person_id join plans pl on pl.id = r.plan_id where r.id = ${requestId}`;
  const to = st.email ? [st.email as string, ...(await backupEmails(tx, st.approver, todayIn(company.timeZone), r.person_id))] : await adminEmails(tx, r.person_id);
  const link = company.baseUrl ? `\n\nReview it: ${company.baseUrl}/approvals` : "";
  for (const email of to) out.push({ to: email, subject: `${company.label}: ${subjectLead} from ${r.full_name}`, text: `${r.full_name} asked for ${r.plan_name}, ${fmtDates(d(r.start_date), d(r.end_date))} (${Number(r.days)} days).${link}` });
}
async function notifyRequester(tx: Tx, company: Company, out: Outgoing, requestId: string, what: string, comment?: string | null) {
  const [r] = await tx`select r.start_date, r.end_date, p.email, pl.name as plan_name from requests r join people p on p.id = r.person_id join plans pl on pl.id = r.plan_id where r.id = ${requestId}`;
  out.push({ to: r.email, subject: `${company.label}: your time off was ${what}`, text: `Your ${r.plan_name} request for ${fmtDates(d(r.start_date), d(r.end_date))} was ${what}.${comment ? `\n\nComment: ${comment}` : ""}` });
}
const flush = async (out: Outgoing) => { for (const e of out) await sendEmail(e); };

const actorRef = (a: Actor) => `person:${a.personId}`;

async function today(company: Company) { return todayIn(company.timeZone); }

// Public API ------------------------------------------------------------------------------

/** Live summary for the request form: days, balance after, run length, approvers, teammates off. */
export async function previewRequest(company: Company, actor: Actor, raw: unknown, opts: { personId?: string; requestId?: string } = {}): Promise<Result<{ summary: Summary }>> {
  const personId = opts.personId ?? actor.personId;
  if (personId !== actor.personId && actor.role !== "admin") throw new NotAllowed("Only HR can book for someone else");
  return withTenant(company.tenantId, async (tx) => {
    let replacing: string | undefined, editing: string | undefined;
    if (opts.requestId) {
      const [r] = await tx`select status, kind, target_id from requests where id = ${opts.requestId} and person_id = ${personId}`;
      if (r?.status === "approved") replacing = opts.requestId;
      else if (r?.status === "pending") { editing = opts.requestId; replacing = r.target_id ?? undefined; }
    }
    const res = await draft(tx, company, actor, personId, raw, { replacing, editing, allowNegative: actor.role === "admin" && personId !== actor.personId });
    return "errors" in res ? { ok: false, errors: res.errors } : { ok: true, summary: res.summary };
  });
}

async function createRequest(tx: Tx, company: Company, actor: Actor, dft: Draft, kind: "new" | "change", targetId: string | null, adminReason: string | null) {
  const { input, who, p, days, summary } = dft;
  const [r] = await tx`
    insert into requests (tenant_id, person_id, plan_id, kind, target_id, start_date, end_date, start_part, end_part, days, amount, comment, requester_time_zone, created_by, admin_reason)
    values (${company.tenantId}, ${who.id}, ${p.id}, ${kind}, ${targetId}, ${input.startDate}, ${input.endDate}, ${input.startPart}, ${input.endPart},
            ${summary.days}, ${summary.amount}, ${input.comment}, ${company.timeZone}, ${actor.personId}, ${adminReason}) returning id`;
  await writeDays(tx, company.tenantId, r.id, days);
  await writeSteps(tx, company.tenantId, r.id, await planSteps(tx, who, p, summary.secondApproval));
  return r.id as string;
}

/** Finishes an approved request: books it, and for changes and cancellations updates the original. */
async function finalize(tx: Tx, company: Company, requestId: string, actor: string) {
  const [r] = await tx`select kind, target_id from requests where id = ${requestId}`;
  await tx`update requests set status = 'approved', decided_at = now(), updated_at = now() where id = ${requestId}`;
  if (r.kind === "new") await book(tx, company.tenantId, requestId, actor);
  if (r.kind === "change") {
    await unbook(tx, company.tenantId, r.target_id, actor, "Replaced by an approved change");
    await tx`update requests set status = 'superseded', updated_at = now() where id = ${r.target_id}`;
    await book(tx, company.tenantId, requestId, actor);
  }
  if (r.kind === "cancel") {
    await unbook(tx, company.tenantId, r.target_id, actor, "Cancellation approved");
    await tx`update requests set status = 'cancelled', updated_at = now() where id = ${r.target_id}`;
  }
}

/** FR-50, FR-51, FR-52: an employee asks for time off. Automatic plans are approved at once. */
export async function submitRequest(company: Company, actor: Actor, raw: unknown): Promise<Result<{ id: string; status: string }>> {
  await postAccruals(company.tenantId, { asOf: await today(company), personId: actor.personId, actor: "system:accrual" });
  const out: Outgoing = [];
  const res = await withTenant(company.tenantId, async (tx): Promise<Result<{ id: string; status: string }>> => {
    const dft = await draft(tx, company, actor, actor.personId, raw);
    if ("errors" in dft) return { ok: false, errors: dft.errors };
    const id = await createRequest(tx, company, actor, dft, "new", null, null);
    let status = "pending";
    if (dft.summary.approvers[0] === "Approved automatically") { await finalize(tx, company, id, actorRef(actor)); status = "approved"; }
    else await notifyStep(tx, company, out, id, "Time off request");
    await writeAudit(tx, actorRef(actor), "request.submitted", { requestId: id, planId: dft.p.id, startDate: dft.input.startDate, endDate: dft.input.endDate, days: dft.summary.days, status, run: dft.summary.run });
    return { ok: true, id, status };
  });
  await flush(out);
  return res;
}

async function loadOwned(tx: Tx, actor: Actor, requestId: string) {
  if (!UUID.test(requestId)) return null;
  const [r] = await tx`select r.*, pl.cancel_needs_approval, pl.approval_mode from requests r join plans pl on pl.id = r.plan_id where r.id = ${requestId}`;
  if (!r) return null;
  if (r.person_id !== actor.personId && actor.role !== "admin") return null; // employees only see their own
  return r;
}

/**
 * FR-53. Pending requests are edited in place and go back to the first approval step.
 * Approved requests get a change request; the original stays booked until it is approved.
 * HR admins may pass approveNow (with a reason) to apply a change at once, except to their own time off.
 */
export async function amendRequest(company: Company, actor: Actor, requestId: string, raw: unknown, admin: { reason?: string; approveNow?: boolean; allowNegative?: boolean } = {}): Promise<Result<{ id: string; status: string }>> {
  const out: Outgoing = [];
  const res = await withTenant(company.tenantId, async (tx): Promise<Result<{ id: string; status: string }>> => {
    const r = await loadOwned(tx, actor, requestId);
    if (!r || r.kind === "cancel" || !["pending", "approved"].includes(r.status)) return { ok: false, errors: { form: "This request can't be changed." } };
    const onBehalf = r.person_id !== actor.personId;
    if (onBehalf && !admin.reason?.trim()) return { ok: false, errors: { reason: "Give a reason for changing someone else's time off." } };
    const now = await today(company);
    if (r.status === "approved" && d(r.start_date) <= now && actor.role !== "admin") return { ok: false, errors: { form: "Time off that has started can only be changed by HR." } };

    if (r.status === "pending") {
      const dft = await draft(tx, company, actor, r.person_id, raw, { editing: requestId, replacing: r.target_id ?? undefined, allowNegative: admin.allowNegative });
      if ("errors" in dft) return { ok: false, errors: dft.errors };
      if (dft.p.id !== r.plan_id && r.target_id) return { ok: false, errors: { planId: "A change keeps the same plan. Cancel and book again to switch plans." } };
      const { input, summary } = dft;
      await tx`update requests set plan_id = ${input.planId}, start_date = ${input.startDate}, end_date = ${input.endDate}, start_part = ${input.startPart}, end_part = ${input.endPart},
                 days = ${summary.days}, amount = ${summary.amount}, comment = ${input.comment}, updated_at = now() where id = ${requestId}`;
      await writeDays(tx, company.tenantId, requestId, dft.days);
      await writeSteps(tx, company.tenantId, requestId, await planSteps(tx, dft.who, dft.p, summary.secondApproval));
      let status = "pending";
      if (summary.approvers[0] === "Approved automatically") { await finalize(tx, company, requestId, actorRef(actor)); status = "approved"; }
      else await notifyStep(tx, company, out, requestId, "Updated time off request");
      await writeAudit(tx, actorRef(actor), "request.edited", { requestId, startDate: input.startDate, endDate: input.endDate, days: summary.days, reason: admin.reason ?? null });
      return { ok: true, id: requestId, status };
    }

    const dft = await draft(tx, company, actor, r.person_id, raw, { replacing: requestId, allowNegative: admin.allowNegative });
    if ("errors" in dft) return { ok: false, errors: dft.errors };
    if (dft.p.id !== r.plan_id) return { ok: false, errors: { planId: "A change keeps the same plan. Cancel and book again to switch plans." } };
    const [open] = await tx`select 1 as x from requests where target_id = ${requestId} and status = 'pending'`;
    if (open) return { ok: false, errors: { form: "A change or cancellation is already waiting for approval." } };
    const id = await createRequest(tx, company, actor, dft, "change", requestId, admin.reason?.trim() || null);
    let status = "pending";
    const immediate = dft.summary.approvers[0] === "Approved automatically" || (admin.approveNow && actor.role === "admin" && onBehalf);
    if (immediate) { await tx`update approval_steps set status = 'cancelled' where request_id = ${id}`; await finalize(tx, company, id, actorRef(actor)); status = "approved"; if (onBehalf) await notifyRequester(tx, company, out, id, "changed by HR", admin.reason); }
    else await notifyStep(tx, company, out, id, "Change to time off");
    await writeAudit(tx, actorRef(actor), "request.change_requested", { requestId: id, targetId: requestId, startDate: dft.input.startDate, endDate: dft.input.endDate, status, reason: admin.reason ?? null });
    return { ok: true, id, status };
  });
  await flush(out);
  return res;
}

/**
 * FR-54. Pending requests cancel at once. Approved future time needs approval when the plan
 * says so; time that has started can only be cancelled by HR. HR cancels at once (with a reason
 * when it is someone else's).
 */
export async function cancelRequest(company: Company, actor: Actor, requestId: string, reason?: string): Promise<Result<{ status: "cancelled" | "pending_cancellation" }>> {
  const out: Outgoing = [];
  const res = await withTenant(company.tenantId, async (tx): Promise<Result<{ status: "cancelled" | "pending_cancellation" }>> => {
    const r = await loadOwned(tx, actor, requestId);
    if (!r || !["pending", "approved"].includes(r.status)) return { ok: false, errors: { form: "This request can't be cancelled." } };
    const onBehalf = r.person_id !== actor.personId;
    if (onBehalf && !reason?.trim()) return { ok: false, errors: { reason: "Give a reason for cancelling someone else's time off." } };
    const ref = actorRef(actor);
    if (r.status === "pending") {
      await tx`update requests set status = 'cancelled', updated_at = now() where id = ${requestId}`;
      await tx`update approval_steps set status = 'cancelled' where request_id = ${requestId} and status in ('pending', 'waiting')`;
      await writeAudit(tx, ref, "request.withdrawn", { requestId, reason: reason ?? null });
      return { ok: true, status: "cancelled" };
    }
    if (r.kind === "cancel") return { ok: false, errors: { form: "This request can't be cancelled." } };
    const started = d(r.start_date) <= (await today(company));
    if (started && actor.role !== "admin") return { ok: false, errors: { form: "Time off that has started can only be cancelled by HR." } };
    const [open] = await tx`select 1 as x from requests where target_id = ${requestId} and status = 'pending'`;
    if (open) return { ok: false, errors: { form: "A change or cancellation is already waiting for approval." } };

    const needsApproval = !onBehalf && actor.role !== "admin" && r.cancel_needs_approval && r.approval_mode !== "auto";
    if (!needsApproval) {
      await unbook(tx, company.tenantId, requestId, ref, onBehalf ? `Cancelled by HR: ${reason}` : "Cancelled");
      await tx`update requests set status = 'cancelled', updated_at = now() where id = ${requestId}`;
      if (onBehalf) await notifyRequester(tx, company, out, requestId, "cancelled by HR", reason);
      await writeAudit(tx, ref, "request.cancelled", { requestId, reason: reason ?? null });
      return { ok: true, status: "cancelled" };
    }
    const who = (await person(tx, r.person_id))!;
    const p = (await plan(tx, r.plan_id))!;
    const [c] = await tx`
      insert into requests (tenant_id, person_id, plan_id, kind, target_id, start_date, end_date, start_part, end_part, days, amount, comment, requester_time_zone, created_by)
      values (${company.tenantId}, ${r.person_id}, ${r.plan_id}, 'cancel', ${requestId}, ${r.start_date}, ${r.end_date}, ${r.start_part}, ${r.end_part}, ${r.days}, ${r.amount}, ${reason?.trim() || null}, ${company.timeZone}, ${actor.personId})
      returning id`;
    await writeSteps(tx, company.tenantId, c.id, (await planSteps(tx, who, p, false)));
    await notifyStep(tx, company, out, c.id, "Cancellation request");
    await writeAudit(tx, ref, "request.cancellation_requested", { requestId: c.id, targetId: requestId });
    return { ok: true, status: "pending_cancellation" };
  });
  await flush(out);
  return res;
}

/**
 * FR-52, FR-55. The current step's approver decides. HR admins can decide any step (logged as
 * an override). Nobody decides their own request. Declining needs a comment.
 */
export async function decideRequest(company: Company, actor: Actor, requestId: string, decision: "approve" | "decline", comment?: string): Promise<Result<{ status: string }>> {
  const out: Outgoing = [];
  const res = await withTenant(company.tenantId, async (tx): Promise<Result<{ status: string }>> => {
    if (!UUID.test(requestId)) return { ok: false, errors: { form: "That request no longer exists." } };
    const [r] = await tx`select id, person_id, status from requests where id = ${requestId} for update`;
    if (!r || r.status !== "pending") return { ok: false, errors: { form: "This request has already been decided." } };
    if (r.person_id === actor.personId) throw new NotAllowed("You can't decide your own request");
    const [st] = await tx`select id, step_no, role, approver_id from approval_steps where request_id = ${requestId} and status = 'pending'`;
    if (!st) return { ok: false, errors: { form: "This request has no open approval." } };
    const covering = await coveredFor(tx, actor.personId, todayIn(company.timeZone));
    const mine = st.approver_id === actor.personId || (st.approver_id && covering.includes(st.approver_id)) || (st.role === "admin" && actor.role === "admin");
    if (!mine && actor.role !== "admin") throw new NotAllowed("Not your approval");
    const override = !mine;
    const text = comment?.trim() || null;
    if (decision === "decline" && !text) return { ok: false, errors: { comment: "Say why you are declining." } };
    const ref = actorRef(actor);
    await tx`update approval_steps set status = ${decision === "approve" ? "approved" : "declined"}, decided_by = ${actor.personId}, override = ${override}, comment = ${text}, decided_at = now() where id = ${st.id}`;
    let status: string;
    if (decision === "decline") {
      await tx`update approval_steps set status = 'cancelled' where request_id = ${requestId} and status = 'waiting'`;
      await tx`update requests set status = 'declined', decided_at = now(), updated_at = now() where id = ${requestId}`;
      await notifyRequester(tx, company, out, requestId, "declined", text);
      status = "declined";
    } else {
      const [next] = await tx`select id from approval_steps where request_id = ${requestId} and status = 'waiting' order by step_no limit 1`;
      if (next) {
        await tx`update approval_steps set status = 'pending', pending_since = now() where id = ${next.id}`;
        await notifyStep(tx, company, out, requestId, "Second approval needed");
        status = "pending";
      } else {
        await finalize(tx, company, requestId, ref);
        await notifyRequester(tx, company, out, requestId, "approved", text);
        status = "approved";
      }
    }
    await writeAudit(tx, ref, `request.${decision === "approve" ? "approved" : "declined"}`, { requestId, step: st.step_no, override, comment: text });
    return { ok: true, status };
  });
  await flush(out);
  return res;
}

/** FR-56. HR books time off for someone, with a reason; optionally approved at once and past the negative limit. */
export async function adminAddTimeOff(company: Company, actor: Actor, personId: string, raw: unknown, opts: { reason: string; approveNow: boolean; allowNegative: boolean }): Promise<Result<{ id: string; status: string }>> {
  if (actor.role !== "admin") throw new NotAllowed("HR admin only");
  if (!UUID.test(personId)) return { ok: false, errors: { form: "That person no longer exists." } };
  if (!opts.reason?.trim()) return { ok: false, errors: { reason: "Give a reason." } };
  if (opts.approveNow && personId === actor.personId) return { ok: false, errors: { approveNow: "Someone else must approve your own time off." } };
  await postAccruals(company.tenantId, { asOf: await today(company), personId, actor: "system:accrual" });
  const out: Outgoing = [];
  const res = await withTenant(company.tenantId, async (tx): Promise<Result<{ id: string; status: string }>> => {
    const dft = await draft(tx, company, actor, personId, raw, { allowNegative: opts.allowNegative });
    if ("errors" in dft) return { ok: false, errors: dft.errors };
    const id = await createRequest(tx, company, actor, dft, "new", null, opts.reason.trim());
    let status = "pending";
    if (opts.approveNow || dft.summary.approvers[0] === "Approved automatically") {
      await tx`update approval_steps set status = 'cancelled' where request_id = ${id}`;
      await finalize(tx, company, id, actorRef(actor));
      status = "approved";
      await notifyRequester(tx, company, out, id, "booked by HR", opts.reason);
    } else await notifyStep(tx, company, out, id, "Time off request");
    await writeAudit(tx, actorRef(actor), "request.added_by_admin", { requestId: id, personId, reason: opts.reason.trim(), approveNow: opts.approveNow, allowNegative: opts.allowNegative, status });
    return { ok: true, id, status };
  });
  await flush(out);
  return res;
}

export const adjustmentInput = z.object({
  personId: z.string().regex(UUID, "Choose a person."),
  planId: z.string().regex(UUID, "Choose a plan."),
  amount: z.coerce.number({ message: "Enter an amount." }).refine((n) => n !== 0 && Math.abs(n) <= 1000, "Enter a non-zero amount up to 1000."),
  effectiveDate: z.string().refine(validDate, "Enter the date it applies from."),
  reason: z.string().trim().min(1, "Give a reason.").max(500, "Keep the reason to 500 characters or fewer."),
});

/** FR-57. HR credits or debits a balance with a reason and date. */
export async function adjustBalance(company: Company, actor: Actor, raw: unknown): Promise<Result<{ id: string }>> {
  if (actor.role !== "admin") throw new NotAllowed("HR admin only");
  const parsed = adjustmentInput.safeParse(raw ?? {});
  if (!parsed.success) {
    const errors: Errors = {};
    for (const i of parsed.error.issues) errors[String(i.path[0] ?? "form")] ??= i.message;
    return { ok: false, errors };
  }
  const a = parsed.data;
  return withTenant(company.tenantId, async (tx): Promise<Result<{ id: string }>> => {
    const c = await loadContext(tx, a.personId, a.planId);
    if (!c || !c.assignments.length) return { ok: false, errors: { planId: "This person doesn't have that plan." } };
    if (c.plan.accrualMethod === "none") return { ok: false, errors: { planId: "This plan doesn't keep a balance." } };
    const [row] = await tx`
      insert into accrual_ledger (tenant_id, person_id, plan_id, effective_date, plan_year, kind, amount, source_key, reason, created_by)
      values (${company.tenantId}, ${a.personId}, ${a.planId}, ${a.effectiveDate}, ${planYearStart(c.plan, c.person, a.effectiveDate)}, 'adjustment', ${a.amount},
              ${"adj:" + crypto.randomUUID()}, ${a.reason}, ${actorRef(actor)}) returning id`;
    await writeAudit(tx, actorRef(actor), "balance.adjusted", { personId: a.personId, planId: a.planId, amount: a.amount, effectiveDate: a.effectiveDate, reason: a.reason });
    return { ok: true, id: row.id };
  });
}

// Reading ---------------------------------------------------------------------------------

export type StepRow = { stepNo: number; role: string; approverName: string; status: string; comment: string | null; decidedAt: string | null; override: boolean };
export type RequestRow = {
  id: string; personId: string; personName: string; planId: string; planName: string; unit: "days" | "hours";
  kind: "new" | "change" | "cancel"; targetId: string | null; startDate: ISODate; endDate: ISODate; startPart: Part; endPart: Part;
  days: number; amount: number; status: string; comment: string | null; adminReason: string | null; createdAt: string;
  steps: StepRow[]; openFollowUp: "change" | "cancel" | null; canAmend: boolean; canCancel: boolean;
};

async function rows(tx: Tx, company: Company, actor: Actor, where: postgres.PendingQuery<postgres.Row[]>): Promise<RequestRow[]> {
  const rs = await tx`
    select r.*, p.full_name, pl.name as plan_name, pl.unit,
           (select f.kind from requests f where f.target_id = r.id and f.status = 'pending' limit 1) as open_follow_up
      from requests r join people p on p.id = r.person_id join plans pl on pl.id = r.plan_id
     where ${where} order by r.start_date desc, r.created_at desc limit 200`;
  if (rs.length === 0) return [];
  const steps = await tx`
    select s.request_id, s.step_no, s.role, s.status, s.comment, s.decided_at, s.override, a.full_name as approver,
           s.decided_by, s.approver_id, k.full_name as decider
      from approval_steps s left join people a on a.id = s.approver_id left join people k on k.id = s.decided_by where s.request_id = any(${rs.map((r) => r.id)}::uuid[]) order by s.step_no`;
  const now = todayIn(company.timeZone);
  return rs.map((r) => {
    const live = r.status === "pending" || r.status === "approved";
    const started = d(r.start_date) <= now;
    const own = r.person_id === actor.personId;
    return {
      id: r.id, personId: r.person_id, personName: r.full_name, planId: r.plan_id, planName: r.plan_name, unit: r.unit,
      kind: r.kind, targetId: r.target_id, startDate: d(r.start_date), endDate: d(r.end_date), startPart: r.start_part, endPart: r.end_part,
      days: Number(r.days), amount: Number(r.amount), status: r.status, comment: r.comment, adminReason: r.admin_reason, createdAt: new Date(r.created_at).toISOString(),
      steps: steps.filter((s) => s.request_id === r.id).map((s) => ({ stepNo: s.step_no, role: s.role, approverName: s.decided_by && s.decided_by !== s.approver_id && s.decider ? `${s.decider}${s.override ? " (HR override)" : s.role === "admin" ? "" : ` for ${s.approver}`}` : s.approver ?? "HR", status: s.status, comment: s.comment, decidedAt: s.decided_at ? new Date(s.decided_at).toISOString() : null, override: s.override })),
      openFollowUp: r.open_follow_up ?? null,
      canAmend: live && r.kind !== "cancel" && !r.open_follow_up && (r.status === "pending" || !started || actor.role === "admin"),
      canCancel: live && !(r.kind === "cancel" && r.status === "approved") && !r.open_follow_up && (r.status === "pending" || !started || actor.role === "admin") && (own || actor.role === "admin"),
    };
  });
}

/** The signed-in person's own requests, newest first. */
export async function listMyRequests(company: Company, actor: Actor): Promise<RequestRow[]> {
  return withTenant(company.tenantId, (tx) => rows(tx, company, actor, tx`r.person_id = ${actor.personId}`));
}

/** HR view of one person's requests. */
export async function listPersonRequests(company: Company, actor: Actor, personId: string): Promise<RequestRow[]> {
  if (actor.role !== "admin") throw new NotAllowed("HR admin only");
  if (!UUID.test(personId)) return [];
  return withTenant(company.tenantId, (tx) => rows(tx, company, actor, tx`r.person_id = ${personId}`));
}

export type ApprovalRow = RequestRow & { mine: boolean; stepRole: string; run: number; longRun: boolean; coveringFor: string | null };

/**
 * Open approvals for the signed-in person: steps waiting on them, plus (for HR admins) every
 * other open step, marked mine = false so the screen can show it as an override.
 */
export async function listApprovals(company: Company, actor: Actor): Promise<ApprovalRow[]> {
  return withTenant(company.tenantId, async (tx) => {
    const covering = await coveredFor(tx, actor.personId, todayIn(company.timeZone));
    const open = await tx`
      select s.request_id, s.role, s.approver_id from approval_steps s join requests r on r.id = s.request_id
       where s.status = 'pending' and r.status = 'pending' and r.person_id <> ${actor.personId}
         and (s.approver_id = ${actor.personId} or s.approver_id = any(${covering}::uuid[]) or ${actor.role === "admin"})`;
    if (open.length === 0) return [];
    const list = await rows(tx, company, actor, tx`r.id = any(${open.map((o) => o.request_id)}::uuid[])`);
    const limit = await threshold(tx);
    const out: ApprovalRow[] = [];
    for (const r of list) {
      const o = open.find((x) => x.request_id === r.id)!;
      const who = (await person(tx, r.personId))!;
      const mineDays = (await tx`select day from request_days where request_id = ${r.id}`).map((x) => d(x.day));
      const others = (await liveDays(tx, r.personId, [r.id, ...(r.targetId ? [r.targetId] : [])])).map((x) => x.day);
      out.push({ ...r, mine: o.approver_id === actor.personId || covering.includes(o.approver_id) || (o.role === "admin" && actor.role === "admin"), coveringFor: covering.includes(o.approver_id) ? o.approver_id : null, stepRole: o.role, ...(await (async () => { const run = runLength(await scheduleFor(tx, who, r.startDate, r.endDate), mineDays, others); return { run, longRun: run > limit }; })()) });
    }
    return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
  });
}

/** How many approvals wait on this person (for the header badge). */
export async function approvalCount(company: Company, actor: Actor): Promise<number> {
  return withTenant(company.tenantId, async (tx) => {
    const covering = await coveredFor(tx, actor.personId, todayIn(company.timeZone));
    const [{ n }] = await tx`
      select count(*)::int as n from approval_steps s join requests r on r.id = s.request_id
       where s.status = 'pending' and r.status = 'pending' and r.person_id <> ${actor.personId}
         and (s.approver_id = ${actor.personId} or s.approver_id = any(${covering}::uuid[]) or (s.role = 'admin' and ${actor.role === "admin"}))`;
    return n;
  });
}

/** Plans a person can request now (assigned and active), for the request form. */
export async function requestablePlans(company: Company, actor: Actor, personId = actor.personId): Promise<{ id: string; name: string; unit: "days" | "hours"; tracked: boolean; approvalMode: string }[]> {
  if (personId !== actor.personId && actor.role !== "admin") throw new NotAllowed("HR admin only");
  return withTenant(company.tenantId, async (tx) => {
    const rs = await tx`
      select distinct pl.id, pl.name, pl.unit, pl.accrual_method, pl.approval_mode from plan_assignments a join plans pl on pl.id = a.plan_id
       where a.person_id = ${personId} and pl.active and (a.effective_to is null or a.effective_to > ${todayIn(company.timeZone)}) order by pl.name`;
    return rs.map((r) => ({ id: r.id, name: r.name, unit: r.unit, tracked: r.accrual_method !== "none", approvalMode: r.approval_mode }));
  });
}
