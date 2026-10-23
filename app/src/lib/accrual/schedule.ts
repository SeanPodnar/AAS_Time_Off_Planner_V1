// The accrual engine's pure core. Given a plan, a person, their level assignments, the statutory
// rules and the ledger rows already posted, it works out which ledger rows are due up to `asOf`.
// No database access here, so every rule is tested directly with worked examples.
//
// Conventions
// - Amounts are in the plan's unit (days or hours). Regular periodic credits are not rounded
//   (15 days a year is 1.25 a month); prorated amounts round to half days (days) or quarter hours.
// - A balance on a date is the sum of ledger rows dated on or before it.
// - Every row has a deterministic source_key, so posting is idempotent.
import { addDays, addMonths, addYears, maxDate, minDate, monthsRemaining, weekday, yearsBetween, ymd, type ISODate } from "./dates";
import { forfeitRule, statutoryMinimumDays, type JurisdictionRule } from "./rules";

export type PlanConfig = {
  id: string;
  name: string;
  category: string;
  unit: "days" | "hours";
  accrualMethod: "lump_sum" | "periodic" | "hours_worked" | "none";
  lumpSumTiming: "plan_year_start" | "hire_date" | "anniversary" | null;
  frequency: "annual" | "semi_annual" | "quarterly" | "monthly" | null;
  creditTiming: "start" | "end";
  hoursWorkedRatio: number | null;
  planYearStartMonth: number;
  planYearStartDay: number;
  firstYearProration: boolean;
  rounding: "nearest" | "up" | "down";
  carryover: "none" | "capped" | "unlimited" | "max_balance";
  carryoverCap: number | null;
  carryoverExpiryMonth: number | null;
  carryoverExpiryDay: number | null;
  maxBalance: number | null;
  tenureEnabled: boolean;
};
export type Level = { id: string; annualAmount: number; tenureTiers: { years: number; amount: number }[] };
export type Assignment = { levelId: string; from: ISODate; to: ISODate | null };
export type Person = { id: string; hireDate: ISODate; jurisdiction: string; hoursPerDay: number; workDays: number[] };

export type LedgerKind = "grant" | "accrual" | "proration" | "carryover_in" | "forfeit" | "expire" | "override" | "adjustment" | "opening_balance" | "booking" | "booking_reversal" | "payout";
export type LedgerRow = { effectiveDate: ISODate; planYear: ISODate; kind: LedgerKind; amount: number; sourceKey: string; reason: string | null; ruleRef: string | null };
export type Warning = { date: ISODate; message: string; ruleRef: string | null };

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0; // + 0 turns -0 into 0

export function roundAmount(x: number, unit: "days" | "hours", mode: "nearest" | "up" | "down"): number {
  const step = unit === "days" ? 0.5 : 0.25;
  const q = x / step;
  const f = mode === "up" ? Math.ceil(q - 1e-9) : mode === "down" ? Math.floor(q + 1e-9) : Math.round(q + 1e-9);
  return r3(f * step);
}

// Plan years ---------------------------------------------------------------------------------

/** Start of the plan year containing `d`. Anniversary plans run from each work anniversary. */
export function planYearStart(plan: PlanConfig, person: Person, d: ISODate): ISODate {
  if (plan.accrualMethod === "lump_sum" && plan.lumpSumTiming === "anniversary") {
    return addYears(person.hireDate, yearsBetween(person.hireDate, d));
  }
  const { y } = ymd(d);
  const mm = String(plan.planYearStartMonth).padStart(2, "0"), dd = String(plan.planYearStartDay).padStart(2, "0");
  const thisYear = `${y}-${mm}-${dd}`;
  return d >= thisYear ? thisYear : `${y - 1}-${mm}-${dd}`;
}

// Entitlement -------------------------------------------------------------------------------

function levelAt(assignments: Assignment[], d: ISODate): string | null {
  const a = assignments.find((x) => x.from <= d && (x.to === null || d < x.to));
  return a ? a.levelId : null;
}

/** Annual entitlement in force on `d` (level in force, raised by tenure tiers if the plan uses them). */
export function annualAmountAt(plan: PlanConfig, levels: Level[], assignments: Assignment[], person: Person, d: ISODate): number {
  const id = levelAt(assignments, d);
  const level = levels.find((l) => l.id === id);
  if (!level) return 0;
  if (!plan.tenureEnabled || level.tenureTiers.length === 0) return level.annualAmount;
  const years = yearsBetween(person.hireDate, d);
  const tier = [...level.tenureTiers].filter((t) => t.years <= years).sort((a, b) => b.years - a.years)[0];
  return tier ? Math.max(tier.amount, level.annualAmount) : level.annualAmount;
}

/** Dates within [from, to) where the entitlement may change: assignment boundaries and tenure anniversaries. */
function changePoints(plan: PlanConfig, level: Level[], assignments: Assignment[], person: Person, from: ISODate, to: ISODate): ISODate[] {
  const pts = new Set<ISODate>();
  for (const a of assignments) {
    if (a.from > from && a.from < to) pts.add(a.from);
    if (a.to && a.to > from && a.to < to) pts.add(a.to);
  }
  if (plan.tenureEnabled) {
    for (let k = 1; k < 60; k++) {
      const ann = addYears(person.hireDate, k);
      if (ann >= to) break;
      if (ann > from) pts.add(ann);
    }
  }
  void level;
  return [...pts].sort();
}

// Credits -----------------------------------------------------------------------------------

type Credit = { date: ISODate; planYear: ISODate; kind: "grant" | "accrual" | "proration"; amount: number; key: string; reason: string };

function workedHours(person: Person, from: ISODate, toExclusive: ISODate): number {
  let n = 0;
  for (let d = from; d < toExclusive; d = addDays(d, 1)) if (person.workDays.includes(weekday(d))) n++;
  return n * person.hoursPerDay;
}

/** Credits due in the plan year starting `S`, dated on or before `asOf`. */
export function creditsForYear(plan: PlanConfig, levels: Level[], assignments: Assignment[], person: Person, S: ISODate, asOf: ISODate): Credit[] {
  const E = plan.accrualMethod === "lump_sum" && plan.lumpSumTiming === "anniversary" ? addYears(S, 1) : addYears(S, 1);
  const firstAssigned = assignments.map((a) => a.from).sort()[0];
  if (!firstAssigned) return [];
  const activeFrom = maxDate(S, person.hireDate, firstAssigned);
  if (activeFrom >= E) return [];
  const out: Credit[] = [];
  const amt = (d: ISODate) => annualAmountAt(plan, levels, assignments, person, d);
  const key = (kind: string, d: ISODate, extra = "") => `acc:${person.id}:${plan.id}:${kind}:${d}${extra}`;
  const prorate = (annual: number, from: ISODate, end: ISODate) =>
    plan.firstYearProration ? roundAmount((annual * monthsRemaining(from, end)) / 12, plan.unit, plan.rounding) : annual;

  if (plan.accrualMethod === "lump_sum") {
    const full = activeFrom === S;
    const first = full ? amt(S) : prorate(amt(activeFrom), activeFrom, E);
    if (first !== 0) out.push({ date: activeFrom, planYear: S, kind: full ? "grant" : "proration", amount: first, key: key("grant", activeFrom), reason: full ? "Annual grant" : "First-year grant, prorated by months remaining" });
    // Level or tenure changes later in the year: grant (or remove) the prorated difference.
    let prev = amt(activeFrom);
    for (const c of changePoints(plan, levels, assignments, person, activeFrom, E)) {
      const now = amt(c);
      if (now !== prev) {
        const delta = plan.firstYearProration
          ? roundAmount(((now - prev) * monthsRemaining(c, E)) / 12, plan.unit, plan.rounding)
          : now - prev;
        if (delta !== 0) out.push({ date: c, planYear: S, kind: "proration", amount: delta, key: key("change", c), reason: "Entitlement changed during the year, prorated" });
        prev = now;
      }
    }
  } else if (plan.accrualMethod === "periodic") {
    const n = { annual: 1, semi_annual: 2, quarterly: 4, monthly: 12 }[plan.frequency!];
    const len = 12 / n;
    for (let k = 0; k < n; k++) {
      const ps = addMonths(S, k * len), pe = addMonths(S, (k + 1) * len);
      if (pe <= activeFrom) continue;
      // A start inside the period is partial unless the half-month rule still counts every month.
      const partial = activeFrom > ps && (!plan.firstYearProration || monthsRemaining(activeFrom, pe) < len);
      const from = maxDate(ps, activeFrom);
      const creditDate = plan.creditTiming === "start" ? from : addDays(pe, -1);
      const annual = amt(from);
      if (annual === 0) continue;
      const amount = partial
        ? (plan.firstYearProration ? roundAmount(((annual / n) * monthsRemaining(activeFrom, pe)) / len, plan.unit, plan.rounding) : r3(annual / n))
        : r3(annual / n);
      if (amount !== 0) out.push({ date: creditDate, planYear: S, kind: partial ? "proration" : "accrual", amount, key: key("period", ps), reason: partial ? "Partial period, prorated" : `Accrual for period starting ${ps}` });
    }
  } else if (plan.accrualMethod === "hours_worked") {
    // Salaried staff: hours worked are their standard schedule. Credited at each month end.
    for (let ms = S; ms < E; ms = addMonths(ms, 1)) {
      const me = minDate(addMonths(ms, 1), E);
      const from = maxDate(ms, activeFrom);
      if (from >= me) continue;
      if (!levelAt(assignments, from)) continue;
      const hours = workedHours(person, from, me);
      const amount = r3(hours / plan.hoursWorkedRatio!);
      if (amount > 0) out.push({ date: addDays(me, -1), planYear: S, kind: "accrual", amount, key: key("hours", ms), reason: `${hours} hours worked at 1 per ${plan.hoursWorkedRatio}` });
    }
  }
  return out.filter((c) => c.date <= asOf);
}

// Year end ----------------------------------------------------------------------------------

/** Plan year starts from the first year the person could accrue up to the year containing asOf. */
export function planYears(plan: PlanConfig, person: Person, assignments: Assignment[], asOf: ISODate): ISODate[] {
  const first = assignments.map((a) => a.from).sort()[0];
  if (!first) return [];
  const startFrom = maxDate(person.hireDate, first);
  if (startFrom > asOf) return [];
  const out: ISODate[] = [];
  for (let s = planYearStart(plan, person, startFrom); s <= asOf; s = addYears(s, 1)) out.push(s);
  return out;
}

const sumTo = (rows: LedgerRow[], d: ISODate) => r3(rows.filter((r) => r.effectiveDate <= d).reduce((a, r) => a + r.amount, 0));

export type ComputeInput = {
  plan: PlanConfig; levels: Level[]; assignments: Assignment[]; person: Person;
  rules: JurisdictionRule[]; existing: LedgerRow[]; asOf: ISODate;
};

/**
 * Rows due up to asOf that are not yet in the ledger, in date order, plus warnings.
 * Credits respect a maximum balance; year end applies the plan's carryover rule, then
 * jurisdiction overrides; carried days expire on the plan's expiry date if unused.
 */
export function computeDueRows(input: ComputeInput): { rows: LedgerRow[]; warnings: Warning[] } {
  const { plan, levels, assignments, person, rules, asOf } = input;
  const ledger = [...input.existing];
  const have = new Set(ledger.map((r) => r.sourceKey));
  const rows: LedgerRow[] = [];
  const warnings: Warning[] = [];
  const add = (r: LedgerRow) => { if (!have.has(r.sourceKey)) { have.add(r.sourceKey); ledger.push(r); rows.push(r); } };
  if (plan.accrualMethod === "none") return { rows, warnings };

  for (const S of planYears(plan, person, assignments, asOf)) {
    const E = addYears(S, 1);
    for (const c of creditsForYear(plan, levels, assignments, person, S, asOf)) {
      if (have.has(c.key)) continue;
      let amount = c.amount, reason = c.reason;
      if (plan.maxBalance !== null && amount > 0) {
        const room = Math.max(0, r3(plan.maxBalance - sumTo(ledger, c.date)));
        if (room < amount) { amount = room; reason += `; limited by the maximum balance of ${plan.maxBalance}`; }
      }
      add({ effectiveDate: c.date, planYear: c.planYear, kind: c.kind, amount: r3(amount), sourceKey: c.key, reason, ruleRef: null });
    }

    // Year end runs once the new plan year has started.
    if (E > asOf) continue;
    const last = addDays(E, -1);
    const balance = sumTo(ledger, last);
    let carry: number;
    if (balance <= 0) carry = balance;
    else if (plan.carryover === "none") carry = 0;
    else if (plan.carryover === "capped") carry = Math.min(balance, plan.carryoverCap ?? 0);
    else carry = balance;
    const forfeit = r3(balance - carry);
    const yearKey = `ye:${person.id}:${plan.id}:${S}`;
    if (forfeit > 0) {
      add({ effectiveDate: last, planYear: S, kind: "forfeit", amount: -forfeit, sourceKey: `${yearKey}:forfeit`, reason: `Year end: plan carries ${plan.carryover === "none" ? "nothing" : `up to ${carry}`}`, ruleRef: null });
      const rule = forfeitRule(rules, person.jurisdiction, plan.category, last);
      if (rule?.ruleKind === "no_forfeit") {
        let keep = forfeit;
        if (person.jurisdiction.startsWith("CA-")) {
          // Canada protects statutory vacation, not amounts above it.
          const min = statutoryMinimumDays(rules, person.jurisdiction, person.hireDate, last, person.workDays.length);
          const minInUnit = min ? (plan.unit === "hours" ? min.days * person.hoursPerDay : min.days) : 0;
          keep = r3(Math.max(0, Math.min(forfeit, Math.min(balance, minInUnit) - Math.max(carry, 0))));
        }
        if (keep > 0) add({ effectiveDate: last, planYear: S, kind: "override", amount: keep, sourceKey: `${yearKey}:override`, reason: `Kept by law in ${person.jurisdiction}: ${rule.notes ?? "earned vacation can't be forfeited"}`, ruleRef: `${rule.jurisdiction}:${rule.ruleKind}` });
      } else if (rule?.ruleKind === "forfeit_conditional") {
        warnings.push({ date: last, message: `${person.jurisdiction} allows forfeiting vacation only with notice and a chance to use it. Confirm notice was given.`, ruleRef: `${rule.jurisdiction}:${rule.ruleKind}` });
      }
    }

    // Carried days expire if not used by the expiry date (bookings use carried days first).
    if (plan.carryover === "capped" && plan.carryoverExpiryMonth && plan.carryoverExpiryDay && carry > 0) {
      const { y } = ymd(E);
      let X = `${y}-${String(plan.carryoverExpiryMonth).padStart(2, "0")}-${String(plan.carryoverExpiryDay).padStart(2, "0")}`;
      if (X < E) X = addYears(X, 1);
      if (X <= asOf && X < addYears(E, 1)) {
        const used = -ledger.filter((r) => (r.kind === "booking" || r.kind === "booking_reversal") && r.effectiveDate >= E && r.effectiveDate <= X).reduce((a, r) => a + r.amount, 0);
        const remaining = r3(Math.max(0, carry - used));
        // Expiry is a forfeit too: no-forfeit laws block it (US) or protect the statutory minimum (Canada).
        const rule = forfeitRule(rules, person.jurisdiction, plan.category, X);
        let protectedAmt = 0;
        if (rule?.ruleKind === "no_forfeit") {
          if (person.jurisdiction.startsWith("CA-")) {
            const min = statutoryMinimumDays(rules, person.jurisdiction, person.hireDate, last, person.workDays.length);
            const minInUnit = min ? (plan.unit === "hours" ? min.days * person.hoursPerDay : min.days) : 0;
            protectedAmt = Math.min(remaining, Math.max(0, minInUnit - used));
          } else protectedAmt = remaining;
          if (protectedAmt > 0) warnings.push({ date: X, message: `${protectedAmt} carried ${plan.unit} not expired: ${person.jurisdiction} does not allow forfeiting earned vacation.`, ruleRef: `${rule.jurisdiction}:${rule.ruleKind}` });
        }
        const expire = r3(remaining - protectedAmt);
        if (expire > 0) add({ effectiveDate: X, planYear: E, kind: "expire", amount: -expire, sourceKey: `${yearKey}:expire`, reason: `Carried ${plan.unit} not used by ${X}`, ruleRef: null });
      }
    }
  }
  rows.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  return { rows, warnings };
}

/** Credits still to come in the plan year containing asOf (for "projected at year end"). */
export function futureCredits(input: Omit<ComputeInput, "existing">): number {
  const { plan, levels, assignments, person, asOf } = input;
  if (plan.accrualMethod === "none") return 0;
  const S = planYearStart(plan, person, asOf);
  const E = addYears(S, 1);
  return r3(creditsForYear(plan, levels, assignments, person, S, addDays(E, -1)).filter((c) => c.date > asOf).reduce((a, c) => a + c.amount, 0));
}
