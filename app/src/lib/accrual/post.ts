// Database side of the accrual engine: load what the pure core needs, post the rows it returns,
// and read balances. Posting is idempotent (unique source_key, on conflict do nothing), so the
// nightly job and on-demand runs can overlap or repeat safely.
import type postgres from "postgres";
import { withTenant, writeAudit } from "../tenancy";
import { addDays, addYears, todayIn, type ISODate } from "./dates";
import { nextMinimumStep, statutoryMinimumDays, type JurisdictionRule } from "./rules";
import { annualAmountAt, computeDueRows, futureCredits, planYearStart, type Assignment, type Level, type LedgerRow, type Person, type PlanConfig, type Warning } from "./schedule";

type Tx = postgres.TransactionSql;
const d = (v: unknown): ISODate => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadRules(tx: Tx): Promise<JurisdictionRule[]> {
  const rows = await tx`select jurisdiction, category, rule_kind, min_years, amount, amount_unit, effective_from, verified, source, notes from jurisdiction_rules`;
  return rows.map((r) => ({
    jurisdiction: r.jurisdiction, category: r.category, ruleKind: r.rule_kind, minYears: Number(r.min_years), amount: n(r.amount),
    amountUnit: r.amount_unit, effectiveFrom: d(r.effective_from), verified: r.verified, source: r.source, notes: r.notes,
  }));
}

function toPlan(r: postgres.Row): PlanConfig {
  return {
    id: r.id, name: r.name, category: r.category, unit: r.unit, accrualMethod: r.accrual_method, lumpSumTiming: r.lump_sum_timing,
    frequency: r.frequency, creditTiming: r.credit_timing, hoursWorkedRatio: n(r.hours_worked_ratio), planYearStartMonth: r.plan_year_start_month,
    planYearStartDay: r.plan_year_start_day, firstYearProration: r.first_year_proration, rounding: r.rounding, carryover: r.carryover,
    carryoverCap: n(r.carryover_cap), carryoverExpiryMonth: r.carryover_expiry_month, carryoverExpiryDay: r.carryover_expiry_day,
    maxBalance: n(r.max_balance), tenureEnabled: r.tenure_enabled,
  };
}

type Context = { person: Person; plan: PlanConfig; levels: Level[]; assignments: Assignment[]; existing: LedgerRow[] };

/** Every (person, plan) pair with at least one assignment, optionally for one person. */
async function loadContexts(tx: Tx, personId?: string): Promise<Context[]> {
  const pairs = await tx`
    select distinct a.person_id, a.plan_id from plan_assignments a join people p on p.id = a.person_id
     where p.status = 'active' ${personId ? tx`and a.person_id = ${personId}` : tx``}`;
  const out: Context[] = [];
  for (const { person_id, plan_id } of pairs) out.push((await loadContext(tx, person_id, plan_id))!);
  return out;
}

export type { Context };

/** Everything the engine needs for one person and one plan, or null if either is missing. */
export async function loadContext(tx: Tx, personId: string, planId: string): Promise<Context | null> {
  const [p] = await tx`select id, hire_date, jurisdiction, hours_per_day, work_days from people where id = ${personId}`;
  const [plan] = await tx`select * from plans where id = ${planId}`;
  if (!p || !plan) return null;
  const levels = await tx`select id, annual_amount, tenure_tiers from plan_levels where plan_id = ${planId}`;
  const assigns = await tx`select level_id, effective_from, effective_to from plan_assignments where person_id = ${personId} and plan_id = ${planId} order by effective_from`;
  const ledger = await tx`select effective_date, plan_year, kind, amount, source_key, reason, rule_ref from accrual_ledger where person_id = ${personId} and plan_id = ${planId}`;
  return {
    person: { id: p.id, hireDate: d(p.hire_date), jurisdiction: p.jurisdiction, hoursPerDay: Number(p.hours_per_day), workDays: p.work_days.map(Number) },
    plan: toPlan(plan),
    levels: levels.map((l) => ({ id: l.id, annualAmount: Number(l.annual_amount), tenureTiers: (l.tenure_tiers as { years: number; amount: number }[]).map((t) => ({ years: Number(t.years), amount: Number(t.amount) })) })),
    assignments: assigns.map((a) => ({ levelId: a.level_id, from: d(a.effective_from), to: a.effective_to ? d(a.effective_to) : null })),
    existing: ledger.map((r) => ({ effectiveDate: d(r.effective_date), planYear: d(r.plan_year), kind: r.kind, amount: Number(r.amount), sourceKey: r.source_key, reason: r.reason, ruleRef: r.rule_ref })),
  };
}

export type PostResult = { posted: number; warnings: (Warning & { personId: string; planId: string })[] };

/**
 * Posts every accrual row due up to asOf for one company (or one person in it).
 * Run by the nightly job with asOf = the company's today, and after plan or assignment changes.
 */
export async function postAccruals(tenantId: string, opts: { asOf: ISODate; personId?: string; actor: string }): Promise<PostResult> {
  return withTenant(tenantId, async (tx) => {
    const rules = await loadRules(tx);
    const result: PostResult = { posted: 0, warnings: [] };
    for (const c of await loadContexts(tx, opts.personId)) {
      const { rows, warnings } = computeDueRows({ ...c, rules, asOf: opts.asOf });
      for (const r of rows) {
        const ins = await tx`
          insert into accrual_ledger (tenant_id, person_id, plan_id, effective_date, plan_year, kind, amount, source_key, reason, rule_ref, created_by)
          values (${tenantId}, ${c.person.id}, ${c.plan.id}, ${r.effectiveDate}, ${r.planYear}, ${r.kind}, ${r.amount}, ${r.sourceKey}, ${r.reason}, ${r.ruleRef}, ${opts.actor})
          on conflict (tenant_id, source_key) do nothing returning id`;
        result.posted += ins.length;
      }
      result.warnings.push(...warnings.map((w) => ({ ...w, personId: c.person.id, planId: c.plan.id })));
    }
    if (result.posted > 0) await writeAudit(tx, opts.actor, "accrual.posted", { asOf: opts.asOf, personId: opts.personId ?? null, rows: result.posted });
    return result;
  });
}

export type Balance = {
  planId: string; planName: string; unit: "days" | "hours"; category: string; tracked: boolean;
  balance: number; scheduled: number; projectedYearEnd: number; planYearStart: ISODate; planYearEnd: ISODate;
  annualEntitlement: number; compliance: { level: "warn" | "info"; text: string }[];
};

/**
 * Balances as of a date, per assigned plan. balance counts ledger rows dated on or before asOf;
 * scheduled is booked leave dated after asOf; projected adds credits still to come this plan year.
 * Call postAccruals first so the ledger is current.
 */
export async function balancesFor(tenantId: string, personId: string, asOf: ISODate): Promise<Balance[]> {
  return withTenant(tenantId, async (tx) => {
    const rules = await loadRules(tx);
    const out: Balance[] = [];
    for (const c of await loadContexts(tx, personId)) {
      const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0; // + 0 turns -0 into 0
      const balance = r3(c.existing.filter((r) => r.effectiveDate <= asOf).reduce((a, r) => a + r.amount, 0));
      const scheduled = r3(-c.existing.filter((r) => r.effectiveDate > asOf && (r.kind === "booking" || r.kind === "booking_reversal")).reduce((a, r) => a + r.amount, 0));
      const S = planYearStart(c.plan, c.person, asOf);
      const future = futureCredits({ ...c, rules, asOf });
      const annual = annualAmountAt(c.plan, c.levels, c.assignments, c.person, asOf);
      out.push({
        planId: c.plan.id, planName: c.plan.name, unit: c.plan.unit, category: c.plan.category, tracked: c.plan.accrualMethod !== "none",
        balance, scheduled, projectedYearEnd: r3(balance - scheduled + future), planYearStart: S, planYearEnd: addDays(addYears(S, 1), -1),
        annualEntitlement: annual, compliance: complianceNotes(c, rules, asOf, annual),
      });
    }
    return out.sort((a, b) => a.planName.localeCompare(b.planName));
  });
}

/** Warnings for admins when a vacation plan gives less than the statutory minimum. */
export function complianceNotes(c: Pick<Context, "person" | "plan">, rules: JurisdictionRule[], asOf: ISODate, annual: number): Balance["compliance"] {
  if (c.plan.category !== "vacation" || c.plan.accrualMethod === "none") return [];
  const notes: Balance["compliance"] = [];
  const min = statutoryMinimumDays(rules, c.person.jurisdiction, c.person.hireDate, asOf, c.person.workDays.length);
  const perYear = c.plan.unit === "hours" ? annual / c.person.hoursPerDay : annual;
  if (min && c.plan.accrualMethod !== "hours_worked" && perYear < min.days) {
    notes.push({ level: "warn", text: `${c.person.jurisdiction} requires at least ${min.days} days a year after ${min.rule.minYears} year${min.rule.minYears === 1 ? "" : "s"} of service; this plan gives ${perYear}.` });
  }
  const next = nextMinimumStep(rules, c.person.jurisdiction, c.person.hireDate, asOf);
  if (next && next.amountUnit === "weeks" && next.amount !== null && perYear < next.amount * c.person.workDays.length) {
    notes.push({ level: "info", text: `The minimum rises to ${next.amount * c.person.workDays.length} days on the ${next.minYears}-year anniversary (${addYears(c.person.hireDate, next.minYears)}).` });
  }
  if (rules.some((r) => r.jurisdiction === c.person.jurisdiction && !r.verified)) notes.push({ level: "info", text: "Statutory figures are pending legal review." });
  return notes;
}

/** Brings one person's ledger up to the company's today, then returns their balances. */
export async function currentBalances(tenantId: string, timeZone: string, personId: string): Promise<{ asOf: ISODate; balances: Balance[] }> {
  const asOf = todayIn(timeZone);
  await postAccruals(tenantId, { asOf, personId, actor: "system:accrual" });
  return { asOf, balances: await balancesFor(tenantId, personId, asOf) };
}
