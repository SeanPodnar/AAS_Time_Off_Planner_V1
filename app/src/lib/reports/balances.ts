// Reports built on balances (FR-71, FR-72, FR-75, FR-76). They use the accrual engine itself,
// so a report and the balance a person sees on screen can never disagree.
import type postgres from "postgres";
import { withTenant } from "../tenancy";
import { addDays, addYears, todayIn, type ISODate } from "../accrual/dates";
import { loadContext, loadRules, postAccruals, type Context } from "../accrual/post";
import { annualAmountAt, computeDueRows, futureCredits, planYearStart } from "../accrual/schedule";
import { nextMinimumStep, statutoryMinimumDays, type JurisdictionRule } from "../accrual/rules";
import { formatDate, runLabel, totalsRow, type Column, type Report, type ReportFilter, type Row, type RunContext } from "./types";

type Tx = postgres.TransactionSql;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;
const d = (v: unknown): ISODate => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const uuid = (v?: string) => (v && UUID.test(v) ? v : null);

export type Subject = { c: Context; name: string; team: string | null; location: string | null; manager: string | null };

/** Active people and their plans with a balance (assigned on `asOf`), after the report's filters. */
export async function subjects(tx: Tx, f: ReportFilter, asOf: ISODate): Promise<Subject[]> {
  const team = uuid(f.teamId), loc = uuid(f.locationId), mgr = uuid(f.managerId), plan = uuid(f.planId);
  const q = f.q?.trim().toLowerCase() || null;
  const pairs = await tx`
    select distinct a.person_id, a.plan_id, p.full_name, t.name as team, l.name as location, m.full_name as manager
      from plan_assignments a join people p on p.id = a.person_id join plans pl on pl.id = a.plan_id
      left join teams t on t.id = p.team_id left join locations l on l.id = p.location_id left join people m on m.id = p.manager_id
     where p.status = 'active' and pl.accrual_method <> 'none'
       and a.effective_from <= ${asOf} and (a.effective_to is null or a.effective_to > ${asOf})
       ${team ? tx`and p.team_id = ${team}` : tx``} ${loc ? tx`and p.location_id = ${loc}` : tx``}
       ${mgr ? tx`and p.manager_id = ${mgr}` : tx``} ${plan ? tx`and a.plan_id = ${plan}` : tx``}
       ${q ? tx`and (lower(p.full_name) like ${"%" + q + "%"} or lower(p.email) like ${"%" + q + "%"})` : tx``}
     order by p.full_name`;
  const out: Subject[] = [];
  for (const x of pairs) {
    const c = await loadContext(tx, x.person_id, x.plan_id);
    if (c) out.push({ c, name: x.full_name, team: x.team, location: x.location, manager: x.manager });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.c.plan.name.localeCompare(b.c.plan.name));
}

async function filterWords(tx: Tx, f: ReportFilter): Promise<string[]> {
  const out: string[] = [];
  const one = async (label: string, id: string | null, q: (id: string) => Promise<postgres.Row[]>) => {
    if (!id) return;
    const [r] = await q(id);
    if (r) out.push(`${label}: ${r.name}`);
  };
  await one("Team", uuid(f.teamId), (id) => tx`select name from teams where id = ${id}`);
  await one("Location", uuid(f.locationId), (id) => tx`select name from locations where id = ${id}`);
  await one("Manager", uuid(f.managerId), (id) => tx`select full_name as name from people where id = ${id}`);
  await one("Plan", uuid(f.planId), (id) => tx`select name from plans where id = ${id}`);
  if (f.q?.trim()) out.push(`Search: ${f.q.trim()}`);
  return out;
}

/** Balance on a date: ledger rows dated on or before it, plus credits due by then not yet posted. */
function balanceOn(c: Context, rules: JurisdictionRule[], date: ISODate): number {
  const due = computeDueRows({ ...c, rules, asOf: date }).rows;
  return r3([...c.existing, ...due].filter((r) => r.effectiveDate <= date).reduce((a, r) => a + r.amount, 0));
}
const bookedAfter = (c: Context, date: ISODate) =>
  r3(-c.existing.filter((r) => r.effectiveDate > date && (r.kind === "booking" || r.kind === "booking_reversal")).reduce((a, r) => a + r.amount, 0));

async function prepare(ctx: RunContext, f: ReportFilter) {
  const today = todayIn(ctx.timeZone, ctx.now);
  const asOf = f.asOf && DATE.test(f.asOf) ? f.asOf : today;
  await postAccruals(ctx.tenantId, { asOf: today, actor: "system:accrual" });
  return { today, asOf };
}

const base = (ctx: RunContext, key: string, title: string, filters: string[], columns: Column[], rows: Row[], totals: Row | null, notes: string[] = []): Report =>
  ({ key, title, companyName: ctx.companyName, runLabel: runLabel(ctx), filters, columns, rows, totals, notes });

const unitNote = (rows: Row[]) => new Set(rows.map((r) => r.unit)).size > 1 ? ["Totals add days and hours together only where noted; filter by one plan for exact totals."] : [];

// FR-71 -----------------------------------------------------------------------------------

export async function balanceSummary(ctx: RunContext, f: ReportFilter): Promise<Report> {
  const { asOf } = await prepare(ctx, f);
  return withTenant(ctx.tenantId, async (tx) => {
    const rules = await loadRules(tx);
    const columns: Column[] = [
      { key: "person", label: "Person", type: "text" }, { key: "team", label: "Team", type: "text" }, { key: "plan", label: "Plan", type: "text" },
      { key: "unit", label: "Unit", type: "text" }, { key: "entitlement", label: "Entitlement per year", type: "number" },
      { key: "available", label: "Available on date", type: "number" }, { key: "booked", label: "Booked after date", type: "number" },
      { key: "projected", label: "Projected at plan year end", type: "number" }, { key: "yearEnd", label: "Plan year ends", type: "date" },
    ];
    const rows: Row[] = [];
    for (const s of await subjects(tx, f, asOf)) {
      const S = planYearStart(s.c.plan, s.c.person, asOf);
      const available = balanceOn(s.c, rules, asOf);
      const booked = bookedAfter(s.c, asOf);
      const future = futureCredits({ ...s.c, rules, asOf });
      rows.push({
        person: s.name, team: s.team, plan: s.c.plan.name, unit: s.c.plan.unit,
        entitlement: annualAmountAt(s.c.plan, s.c.levels, s.c.assignments, s.c.person, asOf),
        available, booked, projected: r3(available - booked + future), yearEnd: addDays(addYears(S, 1), -1),
      });
    }
    const single = new Set(rows.map((r) => r.unit)).size <= 1;
    return base(ctx, "balances", "Balance summary", [`Balances on ${formatDate(asOf)}`, ...(await filterWords(tx, f))], columns, rows,
      rows.length && single ? totalsRow(columns, rows, ["entitlement", "available", "booked", "projected"]) : null,
      single ? [] : ["No totals: these rows mix days and hours. Filter by one plan to see totals."]);
  });
}

// FR-75 -----------------------------------------------------------------------------------

/**
 * Untaken leave liability in hours: what is owed if people took or were paid their unused
 * balance. Includes vacation plans and any plan marked "pay out unused". Days convert at each
 * person's standard hours per day. Negative balances (time taken in advance) reduce the total.
 */
export async function liabilityHours(ctx: RunContext, f: ReportFilter): Promise<Report> {
  const { asOf } = await prepare(ctx, f);
  return withTenant(ctx.tenantId, async (tx) => {
    const rules = await loadRules(tx);
    const payout = new Set((await tx`select id from plans where payout_unused`).map((r) => r.id as string));
    const columns: Column[] = [
      { key: "person", label: "Person", type: "text" }, { key: "team", label: "Team", type: "text" }, { key: "location", label: "Location", type: "text" },
      { key: "plan", label: "Plan", type: "text" }, { key: "balance", label: "Unused balance", type: "number" }, { key: "unit", label: "Unit", type: "text" },
      { key: "hoursPerDay", label: "Hours per day", type: "number" }, { key: "hours", label: "Liability (hours)", type: "number" },
    ];
    const rows: Row[] = [];
    for (const s of await subjects(tx, f, asOf)) {
      if (s.c.plan.category !== "vacation" && !payout.has(s.c.plan.id)) continue;
      const balance = balanceOn(s.c, rules, asOf);
      const hours = r3(s.c.plan.unit === "hours" ? balance : balance * s.c.person.hoursPerDay);
      rows.push({ person: s.name, team: s.team, location: s.location, plan: s.c.plan.name, balance, unit: s.c.plan.unit, hoursPerDay: s.c.person.hoursPerDay, hours });
    }
    const group = (key: "team" | "location") => {
      const m = new Map<string, number>();
      const none = key === "team" ? "No team" : "No location";
      for (const r of rows) m.set(String(r[key] ?? none), r3((m.get(String(r[key] ?? none)) ?? 0) + (r.hours as number)));
      return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}: ${v} hours`).join("; ");
    };
    const notes = rows.length ? [`By team: ${group("team")}`, `By location: ${group("location")}`, "Vacation plans and plans marked \"pay out unused\". Dollar values come with the salary table (backlog)."] : [];
    return base(ctx, "liability", "Untaken leave liability", [`Balances on ${formatDate(asOf)}`, ...(await filterWords(tx, f))], columns, rows,
      rows.length ? totalsRow(columns, rows, ["hours"]) : null, notes);
  });
}

// FR-72 -----------------------------------------------------------------------------------

/**
 * What each plan's next year end will do: projected balance, what carries over, what the plan
 * forfeits, what the law keeps, and warnings. Based on posted and booked time; pending requests
 * are not included. Covers plan years ending by `to` (default: 90 days from today).
 */
export async function yearEndPreview(ctx: RunContext, f: ReportFilter): Promise<Report> {
  const { today } = await prepare(ctx, f);
  const until = f.to && DATE.test(f.to) && f.to >= today ? f.to : addDays(today, 90);
  return withTenant(ctx.tenantId, async (tx) => {
    const rules = await loadRules(tx);
    const columns: Column[] = [
      { key: "person", label: "Person", type: "text" }, { key: "jurisdiction", label: "Province or state", type: "text" }, { key: "plan", label: "Plan", type: "text" },
      { key: "unit", label: "Unit", type: "text" }, { key: "yearEnd", label: "Plan year ends", type: "date" },
      { key: "balance", label: "Projected balance at year end", type: "number" }, { key: "forfeit", label: "Plan forfeits", type: "number" },
      { key: "kept", label: "Kept by law", type: "number" }, { key: "lost", label: "Net lost", type: "number" }, { key: "note", label: "Note", type: "text" },
    ];
    const rows: Row[] = [];
    for (const s of await subjects(tx, f, today)) {
      const E = addYears(planYearStart(s.c.plan, s.c.person, today), 1);
      const last = addDays(E, -1);
      if (last > until) continue;
      const { rows: due, warnings } = computeDueRows({ ...s.c, rules, asOf: E });
      const all = [...s.c.existing, ...due];
      const balance = r3(all.filter((r) => r.effectiveDate <= last && !(r.effectiveDate === last && (r.kind === "forfeit" || r.kind === "override"))).reduce((a, r) => a + r.amount, 0));
      const at = (kind: string) => r3(all.filter((r) => r.effectiveDate === last && r.kind === kind).reduce((a, r) => a + r.amount, 0));
      const forfeit = -at("forfeit"), kept = at("override");
      const notes = [...new Set([...all.filter((r) => r.effectiveDate === last && r.kind === "override").map((r) => r.reason ?? ""), ...warnings.filter((w) => w.date === last).map((w) => w.message)])].filter(Boolean);
      rows.push({ person: s.name, jurisdiction: s.c.person.jurisdiction, plan: s.c.plan.name, unit: s.c.plan.unit, yearEnd: last, balance, forfeit, kept, lost: r3(forfeit - kept), note: notes.join(" ") || null });
    }
    rows.sort((a, b) => String(a.yearEnd).localeCompare(String(b.yearEnd)) || String(a.person).localeCompare(String(b.person)));
    const single = new Set(rows.map((r) => r.unit)).size <= 1;
    return base(ctx, "year-end", "Year-end forfeiture preview", [`Plan years ending by ${formatDate(until)}`, ...(await filterWords(tx, f))], columns, rows,
      rows.length && single ? totalsRow(columns, rows, ["balance", "forfeit", "kept", "lost"]) : null,
      ["Uses posted accruals and approved bookings; pending requests are not included.", ...(single ? [] : unitNote(rows))]);
  });
}

// FR-76 -----------------------------------------------------------------------------------

/**
 * People whose vacation plan gives less than the statutory minimum now, or will after a service
 * anniversary in the next 90 days, plus overrides the law applied at the last year end.
 */
export async function complianceReport(ctx: RunContext, f: ReportFilter): Promise<Report> {
  const { today } = await prepare(ctx, f);
  const horizon = addDays(today, 90);
  return withTenant(ctx.tenantId, async (tx) => {
    const rules = await loadRules(tx);
    const columns: Column[] = [
      { key: "person", label: "Person", type: "text" }, { key: "jurisdiction", label: "Province or state", type: "text" }, { key: "plan", label: "Plan", type: "text" },
      { key: "issue", label: "Issue", type: "text" }, { key: "minimum", label: "Statutory minimum (days per year)", type: "number" },
      { key: "gives", label: "Plan gives (days per year)", type: "number" }, { key: "date", label: "From", type: "date" },
    ];
    const rows: Row[] = [];
    for (const s of await subjects(tx, f, today)) {
      if (s.c.plan.category !== "vacation" || s.c.plan.accrualMethod === "hours_worked") continue;
      const perDays = (amt: number) => r3(s.c.plan.unit === "hours" ? amt / s.c.person.hoursPerDay : amt);
      const gives = perDays(annualAmountAt(s.c.plan, s.c.levels, s.c.assignments, s.c.person, today));
      const min = statutoryMinimumDays(rules, s.c.person.jurisdiction, s.c.person.hireDate, today, s.c.person.workDays.length);
      if (min && gives < min.days) rows.push({ person: s.name, jurisdiction: s.c.person.jurisdiction, plan: s.c.plan.name, issue: "Below the minimum now", minimum: min.days, gives, date: today });
      const next = nextMinimumStep(rules, s.c.person.jurisdiction, s.c.person.hireDate, today);
      if (next && next.amount !== null) {
        const when = addYears(s.c.person.hireDate, next.minYears);
        const need = next.amountUnit === "weeks" ? next.amount * s.c.person.workDays.length : next.amount;
        const givesThen = perDays(annualAmountAt(s.c.plan, s.c.levels, s.c.assignments, s.c.person, when));
        if (when <= horizon && givesThen < need) rows.push({ person: s.name, jurisdiction: s.c.person.jurisdiction, plan: s.c.plan.name, issue: `Below the minimum after ${next.minYears} years of service`, minimum: need, gives: givesThen, date: when });
      }
    }
    const overrides = await tx`
      select p.full_name, p.jurisdiction, pl.name as plan, l.effective_date, l.amount, pl.unit, l.rule_ref
        from accrual_ledger l join people p on p.id = l.person_id join plans pl on pl.id = l.plan_id
       where l.kind = 'override' and l.effective_date >= ${addDays(today, -366)} and l.effective_date <= ${today} order by l.effective_date, p.full_name`;
    for (const o of overrides) {
      rows.push({ person: o.full_name, jurisdiction: o.jurisdiction, plan: o.plan, issue: `Law kept ${Number(o.amount)} ${o.unit} at year end (${o.rule_ref})`, minimum: null, gives: null, date: d(o.effective_date) });
    }
    const unverified = rules.some((r) => !r.verified);
    return base(ctx, "compliance", "Compliance", [`Today ${formatDate(today)}; anniversaries up to ${formatDate(horizon)}`, ...(await filterWords(tx, f))], columns, rows, null,
      unverified ? ["Statutory figures come from published sources and are pending legal review."] : []);
  });
}
