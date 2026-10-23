// Time off plans for HR admins: plans, their levels, and who is assigned to which level.
// Everything runs inside withTenant, so one company can never see or change another's plans,
// and every change is written to the audit log.
import { z } from "zod";
import type postgres from "postgres";
import { withTenant, writeAudit } from "./tenancy";
import { fieldErrors } from "./validation";
import { NotAllowed, type Actor } from "./people";
import { parseTiers, type Tier } from "./planText";

export { NotAllowed };
export { formatTiers, parseTiers, type Tier } from "./planText";
export type { Actor };

function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new NotAllowed("HR admin only");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CATEGORIES = ["vacation", "sick", "personal", "wellbeing", "bereavement", "parental", "unpaid", "lieu", "other"] as const;
const UNITS = ["days", "hours"] as const;
const METHODS = ["lump_sum", "periodic", "hours_worked", "none"] as const;
const LUMP_TIMINGS = ["plan_year_start", "hire_date", "anniversary"] as const;
const FREQUENCIES = ["annual", "semi_annual", "quarterly", "monthly"] as const;
const CREDIT_TIMINGS = ["start", "end"] as const;
const ROUNDINGS = ["nearest", "up", "down"] as const;
const CARRYOVERS = ["none", "capped", "unlimited", "max_balance"] as const;
const APPROVALS = ["auto", "manager", "admin"] as const;
const VISIBILITIES = ["name", "out_of_office", "hidden"] as const;
const CALENDAR_STATUSES = ["busy", "free", "out_of_office"] as const;
const COUNTS = ["working_days", "calendar_days"] as const;

// Form values arrive as strings, tests and code may pass real types. These helpers accept both.
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const en = <T extends readonly [string, ...string[]]>(values: T, def: T[number] | null, message: string) =>
  z.preprocess((v) => (blank(v) ? def : v), z.enum(values, { message }));
const enOpt = <T extends readonly [string, ...string[]]>(values: T, message: string) =>
  z.preprocess((v) => (blank(v) ? null : v), z.enum(values, { message }).nullable());
const bool = (def: boolean) =>
  z.preprocess((v) => (v === undefined ? def : v === true || v === "true" || v === "on" || v === "1"), z.boolean());
const reqNum = (message: string, min: number, max: number, minMsg: string, maxMsg: string, def?: number) =>
  z.preprocess((v) => (blank(v) ? def : Number(v)), z.number({ message }).min(min, minMsg).max(max, maxMsg));
const optNum = (message: string, min: number, max: number, minMsg: string, maxMsg: string) =>
  z.preprocess((v) => (blank(v) ? null : Number(v)), z.number({ message }).min(min, minMsg).max(max, maxMsg).nullable());
const reqInt = (message: string, min: number, max: number, msg: string, def?: number) =>
  z.preprocess((v) => (blank(v) ? def : Number(v)), z.number({ message }).int(message).min(min, msg).max(max, msg));
const optInt = (message: string, min: number, max: number, msg: string) =>
  z.preprocess((v) => (blank(v) ? null : Number(v)), z.number({ message }).int(message).min(min, msg).max(max, msg).nullable());

const daysInMonth = (m: number) => new Date(2024, m, 0).getDate();

const planObject = z
  .object({
    name: z.string().trim().min(1, "Enter a plan name.").max(80, "Keep the plan name to 80 characters or fewer."),
    category: en(CATEGORIES, null, "Choose a category."),
    unit: en(UNITS, "days", "Choose days or hours."),
    accrualMethod: en(METHODS, null, "Choose how time is earned."),
    lumpSumTiming: enOpt(LUMP_TIMINGS, "Choose when the time is granted."),
    frequency: enOpt(FREQUENCIES, "Choose how often time is earned."),
    creditTiming: en(CREDIT_TIMINGS, "start", "Choose start or end of the period."),
    hoursWorkedRatio: optNum("Enter a number of hours.", 0, 100000, "Enter more than 0 hours.", "Use 100000 or fewer."),
    planYearStartMonth: reqInt("Choose a month.", 1, 12, "Choose a month.", 1),
    planYearStartDay: reqInt("Enter a day from 1 to 28.", 1, 28, "Enter a day from 1 to 28.", 1),
    firstYearProration: bool(true),
    rounding: en(ROUNDINGS, "nearest", "Choose how to round."),
    carryover: en(CARRYOVERS, "none", "Choose a carryover rule."),
    carryoverCap: optNum("Enter an amount.", 0, 100000, "Enter 0 or more.", "Use 100000 or fewer."),
    carryoverExpiryMonth: optInt("Choose a month.", 1, 12, "Choose a month."),
    carryoverExpiryDay: optInt("Enter a day from 1 to 31.", 1, 31, "Enter a day from 1 to 31."),
    maxBalance: optNum("Enter an amount.", 0, 100000, "Enter more than 0.", "Use 100000 or fewer."),
    payoutUnused: bool(false),
    approvalMode: en(APPROVALS, "manager", "Choose who approves."),
    secondApproval: bool(true),
    cancelNeedsApproval: bool(true),
    negativeLimit: reqNum("Enter an amount, or 0 for none.", 0, 100000, "Enter 0 or more.", "Use 100000 or fewer.", 0),
    waitingPeriodDays: reqInt("Enter a whole number of days.", 0, 730, "Use 0 to 730 days.", 0),
    visibility: en(VISIBILITIES, "name", "Choose what coworkers see."),
    calendarStatus: en(CALENDAR_STATUSES, "out_of_office", "Choose a calendar status."),
    counts: en(COUNTS, "working_days", "Choose working days or calendar days."),
    tenureEnabled: bool(false),
    active: bool(true),
  })
  .superRefine((p, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (p.accrualMethod === "lump_sum" && !p.lumpSumTiming) add("lumpSumTiming", "Choose when the time is granted.");
    if (p.accrualMethod === "periodic" && !p.frequency) add("frequency", "Choose how often time is earned.");
    if (p.accrualMethod === "hours_worked") {
      if (p.hoursWorkedRatio === null) add("hoursWorkedRatio", "Enter how many hours worked earn one hour off.");
      if (p.unit !== "hours") add("unit", "Plans earned from hours worked must be counted in hours.");
    }
    if (p.carryover === "capped" && p.carryoverCap === null) add("carryoverCap", "Enter the most that can carry over.");
    if (p.carryover === "max_balance" && p.maxBalance === null) add("maxBalance", "Enter the maximum balance.");
    if (p.maxBalance !== null && p.maxBalance <= 0) add("maxBalance", "Enter more than 0, or leave it empty for no limit.");
    if (p.carryover !== "none") {
      if ((p.carryoverExpiryMonth === null) !== (p.carryoverExpiryDay === null)) {
        add(p.carryoverExpiryMonth === null ? "carryoverExpiryMonth" : "carryoverExpiryDay", "Enter both a month and a day, or leave both empty.");
      } else if (p.carryoverExpiryMonth !== null && p.carryoverExpiryDay! > daysInMonth(p.carryoverExpiryMonth)) {
        add("carryoverExpiryDay", "That month does not have that many days.");
      }
    }
  });

type PlanBase = z.infer<typeof planObject>;

const levelInput = z.object({
  id: z.preprocess((v) => (blank(v) ? null : v), z.string().regex(UUID, "That level no longer exists.").nullable()),
  name: z.string().trim().min(1, "Enter a level name.").max(60, "Keep the level name to 60 characters or fewer."),
  annualAmount: reqNum("Enter an amount per year.", 0, 2000, "Enter 0 or more.", "Use 2000 or fewer."),
});

export type PlanLevelInput = { id?: string | null; name: string; annualAmount: number; tenureTiers: Tier[] };
export type PlanInput = Omit<PlanBase, "unit"> & { unit: "days" | "hours"; levels: PlanLevelInput[] };
export type PlanLevel = { id: string; name: string; annualAmount: number; tenureTiers: Tier[] };
export type PlanRow = Omit<PlanInput, "levels" | "category" | "accrualMethod"> & {
  id: string;
  category: (typeof CATEGORIES)[number];
  accrualMethod: (typeof METHODS)[number];
  levels: PlanLevel[];
  assignedCount: number;
};

/** Normalizes fields that only apply to some accrual methods, so stored rows stay tidy. */
function tidy(p: PlanBase): PlanBase {
  const m = p.accrualMethod;
  const none = m === "none";
  return {
    ...p,
    lumpSumTiming: m === "lump_sum" ? p.lumpSumTiming : null,
    frequency: m === "periodic" ? p.frequency : null,
    creditTiming: m === "periodic" || m === "hours_worked" ? p.creditTiming : "start",
    hoursWorkedRatio: m === "hours_worked" ? p.hoursWorkedRatio : null,
    carryover: none ? "none" : p.carryover,
    carryoverCap: !none && p.carryover === "capped" ? p.carryoverCap : null,
    carryoverExpiryMonth: !none && p.carryover !== "none" ? p.carryoverExpiryMonth : null,
    carryoverExpiryDay: !none && p.carryover !== "none" ? p.carryoverExpiryDay : null,
    maxBalance: none ? null : p.maxBalance,
    firstYearProration: none ? false : p.firstYearProration,
    tenureEnabled: none ? false : p.tenureEnabled,
  };
}

// Rows --------------------------------------------------------------------------------------

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toPlan(r: Record<string, unknown>, levels: PlanLevel[], assignedCount: number): PlanRow {
  return {
    id: r.id as string, name: r.name as string, category: r.category as PlanRow["category"], unit: r.unit as "days" | "hours",
    accrualMethod: r.accrual_method as PlanRow["accrualMethod"], lumpSumTiming: r.lump_sum_timing as PlanRow["lumpSumTiming"],
    frequency: r.frequency as PlanRow["frequency"], creditTiming: r.credit_timing as PlanRow["creditTiming"],
    hoursWorkedRatio: num(r.hours_worked_ratio), planYearStartMonth: Number(r.plan_year_start_month), planYearStartDay: Number(r.plan_year_start_day),
    firstYearProration: r.first_year_proration as boolean, rounding: r.rounding as PlanRow["rounding"], carryover: r.carryover as PlanRow["carryover"],
    carryoverCap: num(r.carryover_cap), carryoverExpiryMonth: num(r.carryover_expiry_month), carryoverExpiryDay: num(r.carryover_expiry_day),
    maxBalance: num(r.max_balance), payoutUnused: r.payout_unused as boolean, approvalMode: r.approval_mode as PlanRow["approvalMode"],
    secondApproval: r.second_approval as boolean, cancelNeedsApproval: r.cancel_needs_approval as boolean, negativeLimit: Number(r.negative_limit), waitingPeriodDays: Number(r.waiting_period_days),
    visibility: r.visibility as PlanRow["visibility"], calendarStatus: r.calendar_status as PlanRow["calendarStatus"], counts: r.counts as PlanRow["counts"],
    tenureEnabled: r.tenure_enabled as boolean, active: r.active as boolean, levels, assignedCount,
  };
}

const toLevel = (r: Record<string, unknown>): PlanLevel => ({
  id: r.id as string, name: r.name as string, annualAmount: Number(r.annual_amount), tenureTiers: (r.tenure_tiers as Tier[]) ?? [],
});

export async function listPlans(tenantId: string, actor: Actor): Promise<PlanRow[]> {
  assertAdmin(actor);
  return withTenant(tenantId, async (tx) => {
    const plans = await tx`select * from plans order by lower(name)`;
    const levels = await tx`select * from plan_levels order by sort_order, lower(name)`;
    const counts = await tx`select plan_id, count(distinct person_id)::int as n from plan_assignments where effective_to is null group by plan_id`;
    return plans.map((p) =>
      toPlan(p, levels.filter((l) => l.plan_id === p.id).map(toLevel), counts.find((c) => c.plan_id === p.id)?.n ?? 0));
  });
}

export async function getPlan(tenantId: string, actor: Actor, id: string): Promise<PlanRow | null> {
  assertAdmin(actor);
  if (!UUID.test(id)) return null;
  return withTenant(tenantId, async (tx) => {
    const [p] = await tx`select * from plans where id = ${id}`;
    if (!p) return null;
    const levels = await tx`select * from plan_levels where plan_id = ${id} order by sort_order, lower(name)`;
    const [{ n }] = await tx`select count(distinct person_id)::int as n from plan_assignments where plan_id = ${id} and effective_to is null`;
    return toPlan(p, levels.map(toLevel), n);
  });
}

// Saving ------------------------------------------------------------------------------------

export type SaveResult = { ok: true; id: string } | { ok: false; errors: Record<string, string> };

type CleanLevel = { id: string | null; name: string; annualAmount: number; tenureTiers: Tier[] };

/** Validates level rows. Errors are keyed "levels.<row>.<field>" using the row's position in the submitted list. */
function parseLevels(rawLevels: unknown, none: boolean): { levels: CleanLevel[]; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const levels: CleanLevel[] = [];
  const rows = Array.isArray(rawLevels) ? rawLevels : [];
  const seen = new Map<string, number>();
  rows.forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (blank(r.id) && blank(r.name) && blank(r.annualAmount) && blank(r.tenureTiers)) return; // an untouched blank row
    const rowRaw = none && blank(r.annualAmount) ? { ...r, annualAmount: 0 } : r;
    const parsed = levelInput.safeParse(rowRaw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors[`levels.${i}.${String(issue.path[0] ?? "name")}`] ??= issue.message;
      return;
    }
    const tiers = parseTiers(r.tenureTiers);
    if (!tiers.ok) { errors[`levels.${i}.tenureTiers`] = tiers.error; return; }
    const key = parsed.data.name.toLowerCase();
    if (seen.has(key)) { errors[`levels.${i}.name`] = "Another level in this plan already has this name."; return; }
    seen.set(key, i);
    levels.push({ id: parsed.data.id, name: parsed.data.name, annualAmount: none ? 0 : parsed.data.annualAmount, tenureTiers: none ? [] : tiers.tiers });
  });
  return { levels, errors };
}

const PLAN_COLUMNS = [
  "name", "category", "unit", "accrualMethod", "lumpSumTiming", "frequency", "creditTiming", "hoursWorkedRatio", "planYearStartMonth", "planYearStartDay",
  "firstYearProration", "rounding", "carryover", "carryoverCap", "carryoverExpiryMonth", "carryoverExpiryDay", "maxBalance", "payoutUnused", "approvalMode",
  "secondApproval", "cancelNeedsApproval", "negativeLimit", "waitingPeriodDays", "visibility", "calendarStatus", "counts", "tenureEnabled", "active",
] as const;

export async function savePlan(tenantId: string, actor: Actor, raw: unknown, id?: string): Promise<SaveResult> {
  assertAdmin(actor);
  const rawObj = (raw ?? {}) as Record<string, unknown>;
  const parsed = planObject.safeParse(raw ?? {});
  const errors: Record<string, string> = parsed.success ? {} : fieldErrors(parsed.error);
  const lv = parseLevels(rawObj.levels, rawObj.accrualMethod === "none");
  Object.assign(errors, lv.errors);
  let levels = lv.levels;
  if (rawObj.accrualMethod === "none" && levels.length === 0 && Object.keys(lv.errors).length === 0) {
    levels = [{ id: null, name: "Standard", annualAmount: 0, tenureTiers: [] }];
  }
  if (levels.length === 0 && Object.keys(lv.errors).length === 0) errors.levels = "Add at least one level, for example Standard.";
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  if (id && !UUID.test(id)) return { ok: false, errors: { form: "That plan no longer exists." } };
  const p = tidy(parsed.data);

  try {
    return await withTenant(tenantId, async (tx): Promise<SaveResult> => {
      let before: PlanRow | null = null;
      if (id) {
        const [row] = await tx`select * from plans where id = ${id} for update`;
        if (!row) return { ok: false, errors: { form: "That plan no longer exists." } };
        const existing = await tx`select * from plan_levels where plan_id = ${id} order by sort_order, lower(name)`;
        before = toPlan(row, existing.map(toLevel), 0);
        const known = new Set(before.levels.map((l) => l.id));
        const lerr: Record<string, string> = {};
        // Posted balances are in the plan's unit and plan years. Changing those would rewrite history,
        // so once a plan has ledger rows the admin creates a new plan instead.
        const [{ posted }] = await tx`select exists (select 1 from accrual_ledger where plan_id = ${id}) as posted`;
        if (posted) {
          const locked = "This plan already has balances. Create a new plan to change this.";
          if (p.unit !== before.unit) lerr.unit = locked;
          if (p.accrualMethod !== before.accrualMethod) lerr.accrualMethod = locked;
          if (p.planYearStartMonth !== before.planYearStartMonth) lerr.planYearStartMonth = locked;
          if (p.planYearStartDay !== before.planYearStartDay) lerr.planYearStartDay = locked;
          if (p.accrualMethod === "lump_sum" && p.lumpSumTiming !== before.lumpSumTiming) lerr.lumpSumTiming = locked;
          if (p.accrualMethod === "periodic" && p.frequency !== before.frequency) lerr.frequency = locked;
        }
        levels.forEach((l, i) => { if (l.id && !known.has(l.id)) lerr[`levels.${i}.name`] = "That level no longer exists."; });
        const kept = new Set(levels.map((l) => l.id).filter(Boolean));
        for (const gone of before.levels.filter((l) => !kept.has(l.id))) {
          const [{ n }] = await tx`select count(*)::int as n from plan_assignments where level_id = ${gone.id}`;
          if (n > 0) {
            lerr.levels = `The level "${gone.name}" is used by ${n} ${n === 1 ? "assignment" : "assignments"}. Move people to another level before removing it.`;
            break;
          }
        }
        if (Object.keys(lerr).length) return { ok: false, errors: lerr };
      }

      const cols = {
        name: p.name, category: p.category, unit: p.unit, accrual_method: p.accrualMethod, lump_sum_timing: p.lumpSumTiming, frequency: p.frequency,
        credit_timing: p.creditTiming, hours_worked_ratio: p.hoursWorkedRatio, plan_year_start_month: p.planYearStartMonth, plan_year_start_day: p.planYearStartDay,
        first_year_proration: p.firstYearProration, rounding: p.rounding, carryover: p.carryover, carryover_cap: p.carryoverCap,
        carryover_expiry_month: p.carryoverExpiryMonth, carryover_expiry_day: p.carryoverExpiryDay, max_balance: p.maxBalance, payout_unused: p.payoutUnused,
        approval_mode: p.approvalMode, second_approval: p.secondApproval, cancel_needs_approval: p.cancelNeedsApproval, negative_limit: p.negativeLimit, waiting_period_days: p.waitingPeriodDays,
        visibility: p.visibility, calendar_status: p.calendarStatus, counts: p.counts, tenure_enabled: p.tenureEnabled, active: p.active,
      };
      let planId = id;
      if (id) {
        await tx`update plans set ${tx(cols)}, updated_at = now() where id = ${id}`;
      } else {
        const [r] = await tx`insert into plans ${tx({ tenant_id: tenantId, ...cols })} returning id`;
        planId = r.id;
      }

      const kept = new Set(levels.map((l) => l.id).filter(Boolean));
      for (const gone of (before?.levels ?? []).filter((l) => !kept.has(l.id))) await tx`delete from plan_levels where id = ${gone.id}`;
      for (const [i, l] of levels.entries()) {
        if (l.id) {
          await tx`update plan_levels set name = ${l.name}, annual_amount = ${l.annualAmount}, tenure_tiers = ${tx.json(l.tenureTiers)}, sort_order = ${i} where id = ${l.id}`;
        } else {
          await tx`insert into plan_levels (tenant_id, plan_id, name, annual_amount, tenure_tiers, sort_order)
                   values (${tenantId}, ${planId!}, ${l.name}, ${l.annualAmount}, ${tx.json(l.tenureTiers)}, ${i})`;
        }
      }

      const after = (await getPlanInTx(tx, planId!))!;
      if (!before) {
        await writeAudit(tx, `person:${actor.personId}`, "plan.created", {
          planId, name: p.name, category: p.category, accrualMethod: p.accrualMethod, levels: after.levels.map((l) => `${l.name}: ${l.annualAmount}`),
        });
      } else {
        await writeAudit(tx, `person:${actor.personId}`, "plan.updated", { planId, changed: diffPlans(before, after) });
      }
      return { ok: true, id: planId! };
    });
  } catch (e) {
    const err = e as { code?: string; constraint_name?: string };
    if (err.code === "23505" && err.constraint_name === "plans_name_per_tenant") return { ok: false, errors: { name: "Another plan at this company already has this name." } };
    if (err.code === "23505" && err.constraint_name === "plan_levels_name_per_plan") return { ok: false, errors: { levels: "Two levels in this plan have the same name." } };
    throw e;
  }
}

async function getPlanInTx(tx: postgres.TransactionSql, id: string): Promise<PlanRow | null> {
  const [p] = await tx`select * from plans where id = ${id}`;
  if (!p) return null;
  const levels = await tx`select * from plan_levels where plan_id = ${id} order by sort_order, lower(name)`;
  return toPlan(p, levels.map(toLevel), 0);
}

function diffPlans(a: PlanRow, b: PlanRow) {
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of PLAN_COLUMNS) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changed[k] = { from: a[k], to: b[k] };
  const byId = new Map(a.levels.map((l) => [l.id, l]));
  const afterIds = new Set(b.levels.map((l) => l.id));
  const levels = {
    added: b.levels.filter((l) => !byId.has(l.id)).map((l) => l.name),
    removed: a.levels.filter((l) => !afterIds.has(l.id)).map((l) => l.name),
    changed: b.levels.filter((l) => byId.has(l.id) && JSON.stringify(byId.get(l.id)) !== JSON.stringify(l))
      .map((l) => ({ name: l.name, from: byId.get(l.id), to: l })),
  };
  return levels.added.length || levels.removed.length || levels.changed.length ? { ...changed, levels } : changed;
}

// Assignments -------------------------------------------------------------------------------

export type AssignInput = { personId: string; planId: string; levelId: string; effectiveFrom: string };
export type AssignResult = { ok: true } | { ok: false; errors: Record<string, string> };

const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

async function checkPlanLevel(tx: postgres.TransactionSql, planId: string, levelId: string): Promise<Record<string, string> | null> {
  if (!UUID.test(planId ?? "")) return { planId: "Choose a plan." };
  const [plan] = await tx`select active, name from plans where id = ${planId}`;
  if (!plan) return { planId: "Choose a plan from this company." };
  if (!plan.active) return { planId: "This plan is inactive. Turn it on before assigning people." };
  if (!UUID.test(levelId ?? "")) return { levelId: "Choose a level." };
  const [level] = await tx`select 1 as ok from plan_levels where id = ${levelId} and plan_id = ${planId}`;
  if (!level) return { levelId: "Choose a level that belongs to this plan." };
  return null;
}

export async function assignPlan(tenantId: string, actor: Actor, input: AssignInput): Promise<AssignResult> {
  assertAdmin(actor);
  if (!validDate(input.effectiveFrom)) return { ok: false, errors: { effectiveFrom: "Enter the date the plan starts." } };
  if (!UUID.test(input.personId ?? "")) return { ok: false, errors: { personId: "That person no longer exists." } };
  return withTenant(tenantId, async (tx): Promise<AssignResult> => {
    const [person] = await tx`select id from people where id = ${input.personId}`;
    if (!person) return { ok: false, errors: { personId: "That person no longer exists." } };
    const bad = await checkPlanLevel(tx, input.planId, input.levelId);
    if (bad) return { ok: false, errors: bad };

    const [open] = await tx`select id, level_id, effective_from::text as effective_from from plan_assignments
                             where person_id = ${input.personId} and plan_id = ${input.planId} and effective_to is null
                             order by effective_from desc limit 1 for update`;
    if (open && input.effectiveFrom < open.effective_from) {
      return { ok: false, errors: { effectiveFrom: `This person's current assignment starts on ${open.effective_from}. Choose that date or later.` } };
    }
    const [overlap] = await tx`select 1 as x from plan_assignments where person_id = ${input.personId} and plan_id = ${input.planId}
                                and effective_to is not null and effective_to > ${input.effectiveFrom}`;
    if (overlap) return { ok: false, errors: { effectiveFrom: "That date falls inside an earlier assignment. Choose a later date." } };

    if (open && input.effectiveFrom === open.effective_from) {
      // Same start date: correct the level in place instead of creating an empty period.
      await tx`update plan_assignments set level_id = ${input.levelId} where id = ${open.id}`;
    } else {
      if (open) await tx`update plan_assignments set effective_to = ${input.effectiveFrom} where id = ${open.id}`;
      await tx`insert into plan_assignments (tenant_id, person_id, plan_id, level_id, effective_from)
               values (${tenantId}, ${input.personId}, ${input.planId}, ${input.levelId}, ${input.effectiveFrom})`;
    }
    await writeAudit(tx, `person:${actor.personId}`, "plan.assigned", {
      personId: input.personId, planId: input.planId, levelId: input.levelId, effectiveFrom: input.effectiveFrom,
      previousLevelId: open?.level_id ?? null,
    });
    return { ok: true };
  });
}

export type AssignAllInput = { planId: string; levelId: string; effectiveFrom: string };
export type AssignAllResult = { ok: true; count: number } | { ok: false; errors: Record<string, string> };

export async function assignPlanToAll(tenantId: string, actor: Actor, input: AssignAllInput): Promise<AssignAllResult> {
  assertAdmin(actor);
  if (!validDate(input.effectiveFrom)) return { ok: false, errors: { effectiveFrom: "Enter the date the plan starts." } };
  return withTenant(tenantId, async (tx): Promise<AssignAllResult> => {
    const bad = await checkPlanLevel(tx, input.planId, input.levelId);
    if (bad) return { ok: false, errors: bad };
    const rows = await tx`
      insert into plan_assignments (tenant_id, person_id, plan_id, level_id, effective_from)
      select ${tenantId}, p.id, ${input.planId}, ${input.levelId}, ${input.effectiveFrom}
        from people p
       where p.status = 'active'
         and not exists (select 1 from plan_assignments a
                          where a.person_id = p.id and a.plan_id = ${input.planId}
                            and (a.effective_to is null or a.effective_to > ${input.effectiveFrom}))
      returning person_id`;
    await writeAudit(tx, `person:${actor.personId}`, "plan.assigned_all", {
      planId: input.planId, levelId: input.levelId, effectiveFrom: input.effectiveFrom, count: rows.length,
    });
    return { ok: true, count: rows.length };
  });
}

export type AssignmentRow = {
  id: string; planId: string; planName: string; levelId: string; levelName: string; effectiveFrom: string; effectiveTo: string | null; current: boolean;
};

export async function listAssignments(tenantId: string, actor: Actor, personId: string): Promise<AssignmentRow[]> {
  assertAdmin(actor);
  if (!UUID.test(personId)) return [];
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select a.id, a.plan_id, pl.name as plan_name, a.level_id, lv.name as level_name,
             a.effective_from::text as effective_from, a.effective_to::text as effective_to
        from plan_assignments a
        join plans pl on pl.id = a.plan_id
        join plan_levels lv on lv.id = a.level_id
       where a.person_id = ${personId}
       order by lower(pl.name), a.effective_from desc`;
    return rows.map((r) => ({
      id: r.id, planId: r.plan_id, planName: r.plan_name, levelId: r.level_id, levelName: r.level_name,
      effectiveFrom: r.effective_from, effectiveTo: r.effective_to, current: r.effective_to === null,
    }));
  });
}

// Starter templates -------------------------------------------------------------------------

const BASE: Omit<PlanInput, "name" | "category" | "accrualMethod" | "levels"> = {
  unit: "days", lumpSumTiming: null, frequency: null, creditTiming: "start", hoursWorkedRatio: null,
  planYearStartMonth: 1, planYearStartDay: 1, firstYearProration: true, rounding: "nearest",
  carryover: "none", carryoverCap: null, carryoverExpiryMonth: null, carryoverExpiryDay: null, maxBalance: null, payoutUnused: false,
  approvalMode: "manager", secondApproval: true, cancelNeedsApproval: true, negativeLimit: 0, waitingPeriodDays: 0,
  visibility: "name", calendarStatus: "out_of_office", counts: "working_days", tenureEnabled: false, active: true,
};

export type PlanTemplate = { key: string; label: string; plan: PlanInput };

export const starterTemplates: PlanTemplate[] = [
  {
    key: "vacation", label: "Vacation",
    plan: { ...BASE, name: "Vacation", category: "vacation", accrualMethod: "periodic", frequency: "monthly", creditTiming: "start",
      carryover: "capped", carryoverCap: 5, approvalMode: "manager",
      levels: [{ name: "Standard", annualAmount: 15, tenureTiers: [] }, { name: "Senior", annualAmount: 20, tenureTiers: [] }] },
  },
  {
    key: "wellbeing", label: "Wellbeing",
    plan: { ...BASE, name: "Wellbeing", category: "wellbeing", accrualMethod: "lump_sum", lumpSumTiming: "plan_year_start", carryover: "none",
      approvalMode: "auto", secondApproval: false, visibility: "out_of_office", levels: [{ name: "Standard", annualAmount: 3, tenureTiers: [] }] },
  },
  {
    key: "sick", label: "Sick",
    plan: { ...BASE, name: "Sick", category: "sick", accrualMethod: "lump_sum", lumpSumTiming: "plan_year_start", carryover: "none",
      approvalMode: "auto", secondApproval: false, visibility: "out_of_office", levels: [{ name: "Standard", annualAmount: 6, tenureTiers: [] }] },
  },
  {
    key: "personal", label: "Personal",
    plan: { ...BASE, name: "Personal", category: "personal", accrualMethod: "lump_sum", lumpSumTiming: "plan_year_start", carryover: "none",
      approvalMode: "manager", secondApproval: false, levels: [{ name: "Standard", annualAmount: 2, tenureTiers: [] }] },
  },
  {
    key: "unpaid", label: "Unpaid",
    plan: { ...BASE, name: "Unpaid", category: "unpaid", accrualMethod: "none", firstYearProration: false, approvalMode: "admin", secondApproval: false,
      visibility: "out_of_office", levels: [{ name: "Standard", annualAmount: 0, tenureTiers: [] }] },
  },
];
