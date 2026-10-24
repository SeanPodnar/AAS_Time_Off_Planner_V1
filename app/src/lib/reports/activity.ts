// Reports on activity (FR-70, FR-73, FR-74, FR-77): who's out, absence rate, approval metrics
// and the audit report. Same Report shape as every other report, so screen and exports agree.
import type postgres from "postgres";
import { withTenant } from "../tenancy";
import { addDays, todayIn, toDate, type ISODate } from "../accrual/dates";
import { holidayDates } from "../holidays";
import { isWorkingDay, partValue, type Part } from "../requests/days";
import { formatDate, runLabel, totalsRow, type Column, type Report, type ReportFilter, type Row, type RunContext } from "./types";

type Tx = postgres.TransactionSql;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const uuid = (v?: string) => (v && UUID.test(v) ? v : null);
const validDate = (s?: string): s is ISODate => {
  if (!s || !DATE.test(s)) return false;
  const t = toDate(s).getTime();
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};
const days = (a: ISODate, b: ISODate) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const like = (s: string) => `%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The report's date range: what was asked for, else `len` days (ending today for past reports, starting today for who's out). Capped at 366 days. */
function rangeOf(ctx: RunContext, f: ReportFilter, len: number, ahead: boolean): { from: ISODate; to: ISODate } {
  const today = todayIn(ctx.timeZone, ctx.now);
  let from: ISODate, to: ISODate;
  if (validDate(f.from) && validDate(f.to) && f.from <= f.to) { from = f.from; to = f.to; }
  else if (validDate(f.from) && !validDate(f.to)) { from = f.from; to = addDays(from, len - 1); }
  else if (validDate(f.to) && !validDate(f.from)) { to = f.to; from = addDays(to, -(len - 1)); }
  else if (ahead) { from = today; to = addDays(today, len - 1); }
  else { to = today; from = addDays(today, -(len - 1)); }
  if (days(from, to) > 365) to = addDays(from, 365);
  return { from, to };
}

const rangeWords = (from: ISODate, to: ISODate) => `From ${formatDate(from)} to ${formatDate(to)}`;

async function filterWords(tx: Tx, f: ReportFilter, use: { people?: boolean; plan?: boolean; q?: boolean }): Promise<string[]> {
  const out: string[] = [];
  const one = async (label: string, id: string | null, q: (id: string) => Promise<postgres.Row[]>) => {
    if (!id) return;
    const [r] = await q(id);
    if (r) out.push(`${label}: ${r.name}`);
  };
  if (use.people) {
    await one("Team", uuid(f.teamId), (id) => tx`select name from teams where id = ${id}`);
    await one("Location", uuid(f.locationId), (id) => tx`select name from locations where id = ${id}`);
    await one("Manager", uuid(f.managerId), (id) => tx`select full_name as name from people where id = ${id}`);
  }
  if (use.plan) await one("Plan", uuid(f.planId), (id) => tx`select name from plans where id = ${id}`);
  if (use.q && f.q?.trim()) out.push(`Search: ${f.q.trim()}`);
  return out;
}

const base = (ctx: RunContext, key: string, title: string, filters: string[], columns: Column[], rows: Row[], totals: Row | null, notes: string[] = []): Report =>
  ({ key, title, companyName: ctx.companyName, runLabel: runLabel(ctx), filters, columns, rows, totals, notes });

/** Person filters shared by the people-based reports. */
const peopleWhere = (tx: Tx, f: ReportFilter) => {
  const team = uuid(f.teamId), loc = uuid(f.locationId), mgr = uuid(f.managerId);
  return tx`${team ? tx`and p.team_id = ${team}` : tx``} ${loc ? tx`and p.location_id = ${loc}` : tx``} ${mgr ? tx`and p.manager_id = ${mgr}` : tx``}`;
};

// FR-70 -----------------------------------------------------------------------------------

export async function whosOut(ctx: RunContext, f: ReportFilter): Promise<Report> {
  const { from, to } = rangeOf(ctx, f, 7, true);
  return withTenant(ctx.tenantId, async (tx) => {
    const plan = uuid(f.planId);
    const found = await tx`
      select p.full_name, t.name as team, pl.name as plan, r.start_date::text as first_day, r.end_date::text as last_day, r.status,
             sum(case when rd.part = 'full' then 1 else 0.5 end)::float8 as n
        from requests r
        join people p on p.id = r.person_id join plans pl on pl.id = r.plan_id
        join request_days rd on rd.request_id = r.id and rd.day between ${from} and ${to}
        left join teams t on t.id = p.team_id
       where r.status in ('pending', 'approved') and r.kind <> 'cancel' and not (r.kind = 'change' and r.status = 'pending')
         ${peopleWhere(tx, f)} ${plan ? tx`and r.plan_id = ${plan}` : tx``}
       group by r.id, p.full_name, t.name, pl.name
       order by r.start_date, p.full_name, r.id`;
    const columns: Column[] = [
      { key: "person", label: "Person", type: "text" }, { key: "team", label: "Team", type: "text" }, { key: "plan", label: "Plan", type: "text" },
      { key: "first", label: "First day", type: "date" }, { key: "last", label: "Last day", type: "date" },
      { key: "days", label: "Days in range", type: "number" }, { key: "status", label: "Status", type: "text" },
    ];
    const rows: Row[] = found.map((x) => ({
      person: x.full_name, team: x.team, plan: x.plan, first: x.first_day, last: x.last_day, days: Number(x.n),
      status: x.status === "approved" ? "Approved" : "Waiting for approval",
    }));
    return base(ctx, "whos-out", "Who's out", [rangeWords(from, to), ...(await filterWords(tx, f, { people: true, plan: true }))], columns, rows,
      rows.length ? totalsRow(columns, rows, ["days"]) : null);
  });
}

// FR-73 -----------------------------------------------------------------------------------

export async function absenceRate(ctx: RunContext, f: ReportFilter): Promise<Report> {
  const { from, to } = rangeOf(ctx, f, 30, false);
  return withTenant(ctx.tenantId, async (tx) => {
    const plan = uuid(f.planId);
    const people = await tx`
      select p.id, p.full_name, t.name as team, p.jurisdiction, p.work_days
        from people p left join teams t on t.id = p.team_id
       where p.status = 'active' ${peopleWhere(tx, f)}
       order by lower(p.full_name), p.id`;
    const booked = await tx`
      select r.person_id, rd.day::text as day, rd.part
        from requests r join request_days rd on rd.request_id = r.id
        join people p on p.id = r.person_id
       where r.status = 'approved' and r.kind <> 'cancel' and rd.day between ${from} and ${to}
         ${peopleWhere(tx, f)} ${plan ? tx`and r.plan_id = ${plan}` : tx``}`;
    const byPerson = new Map<string, { day: ISODate; part: Part }[]>();
    for (const b of booked) {
      const list = byPerson.get(b.person_id as string) ?? [];
      list.push({ day: b.day as ISODate, part: b.part as Part });
      byPerson.set(b.person_id as string, list);
    }
    const holidays = new Map<string, Set<ISODate>>();
    const rows: Row[] = [];
    for (const p of people) {
      const j = p.jurisdiction as string;
      if (!holidays.has(j)) holidays.set(j, await holidayDates(tx, j, from, to));
      const sched = { workDays: (p.work_days as number[]).map(Number), holidays: holidays.get(j)! };
      let working = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkingDay(sched, d)) working++;
      const off = (byPerson.get(p.id as string) ?? []).filter((b) => isWorkingDay(sched, b.day)).reduce((a, b) => a + partValue(b.part), 0);
      rows.push({ person: p.full_name, team: p.team, working, off, rate: working > 0 ? r4(off / working) : null });
    }
    const columns: Column[] = [
      { key: "person", label: "Person", type: "text" }, { key: "team", label: "Team", type: "text" },
      { key: "working", label: "Working days in range", type: "number", decimals: 0 }, { key: "off", label: "Days off", type: "number" },
      { key: "rate", label: "Absence rate", type: "percent" },
    ];
    let totals: Row | null = null;
    if (rows.length) {
      totals = totalsRow(columns, rows, ["working", "off"]);
      totals.rate = (totals.working as number) > 0 ? r4((totals.off as number) / (totals.working as number)) : null;
    }
    return base(ctx, "absence", "Absence rate and days lost", [rangeWords(from, to), ...(await filterWords(tx, f, { people: true, plan: true }))], columns, rows, totals,
      ["Counts approved time off on working days only. Holidays and days people don't work are left out."]);
  });
}

// FR-74 -----------------------------------------------------------------------------------

export async function approvalMetrics(ctx: RunContext, f: ReportFilter): Promise<Report> {
  const { from, to } = rangeOf(ctx, f, 30, false);
  const tz = ctx.timeZone;
  return withTenant(ctx.tenantId, async (tx) => {
    const found = await tx`
      select p.full_name,
             count(*)::int as decided,
             count(*) filter (where s.status = 'approved')::int as approved,
             count(*) filter (where s.status = 'declined')::int as declined,
             avg(extract(epoch from (s.decided_at - s.pending_since)) / 3600) filter (where s.pending_since is not null)::float8 as hours,
             count(*) filter (where s.override)::int as overrides
        from approval_steps s join people p on p.id = s.decided_by
       where s.decided_by is not null and s.status in ('approved', 'declined')
         and (s.decided_at at time zone ${tz})::date between ${from} and ${to}
       group by p.id, p.full_name
       order by lower(p.full_name), p.id`;
    const rows: Row[] = found.map((x) => ({
      approver: x.full_name, decided: x.decided, approved: x.approved, declined: x.declined,
      rate: x.decided > 0 ? r4(x.declined / x.decided) : null, hours: x.hours === null ? null : r1(Number(x.hours)), overrides: x.overrides,
    }));
    const [w] = await tx`
      select count(distinct s.request_id)::int as n, min(coalesce(s.pending_since, r.created_at)) as since
        from approval_steps s join requests r on r.id = s.request_id
       where s.status = 'pending' and r.status = 'pending'`;
    const since = w.since ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(w.since as Date) : null;
    const notes = [w.n > 0 && since ? `Still waiting now: ${w.n} request${w.n === 1 ? "" : "s"}, oldest waiting since ${formatDate(since)}` : "Still waiting now: 0 requests"];
    const columns: Column[] = [
      { key: "approver", label: "Approver", type: "text" }, { key: "decided", label: "Decided", type: "number", decimals: 0 },
      { key: "approved", label: "Approved", type: "number", decimals: 0 }, { key: "declined", label: "Declined", type: "number", decimals: 0 },
      { key: "rate", label: "Decline rate", type: "percent" }, { key: "hours", label: "Average hours to decide", type: "number", decimals: 1 },
      { key: "overrides", label: "HR overrides", type: "number", decimals: 0 },
    ];
    let totals: Row | null = null;
    if (rows.length) {
      totals = totalsRow(columns, rows, ["decided", "approved", "declined", "overrides"]);
      totals.rate = (totals.decided as number) > 0 ? r4((totals.declined as number) / (totals.decided as number)) : null;
    }
    return base(ctx, "approvals", "Approval metrics", [rangeWords(from, to)], columns, rows, totals, notes);
  });
}

// FR-77 -----------------------------------------------------------------------------------

const AUDIT_CAP = 5000;

function whenText(at: Date, tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function detailText(detail: unknown): string {
  const cut = (s: string) => (s.length > 200 ? `${s.slice(0, 200)}...` : s);
  const val = (v: unknown) => cut(typeof v === "string" ? v : JSON.stringify(v) ?? "");
  if (detail === null || detail === undefined) return "";
  if (typeof detail !== "object" || Array.isArray(detail)) return val(detail);
  return Object.entries(detail as Record<string, unknown>).map(([k, v]) => `${k}: ${val(v)}`).join("; ");
}

export async function auditReport(ctx: RunContext, f: ReportFilter): Promise<Report> {
  const { from, to } = rangeOf(ctx, f, 30, false);
  const tz = ctx.timeZone;
  return withTenant(ctx.tenantId, async (tx) => {
    const q = f.q?.trim();
    const found = await tx`
      select a.at, a.action, a.detail, coalesce(p.full_name, a.actor) as who
        from audit_log a left join people p on a.actor like 'person:%' and p.id::text = substring(a.actor from 8)
       where (a.at at time zone ${tz})::date between ${from} and ${to}
         ${q ? tx`and (lower(a.action) like ${like(q)} or lower(coalesce(p.full_name, a.actor)) like ${like(q)})` : tx``}
       order by a.at desc, a.id
       limit ${AUDIT_CAP + 1}`;
    const capped = found.length > AUDIT_CAP;
    const rows: Row[] = found.slice(0, AUDIT_CAP).map((x) => ({ when: whenText(x.at as Date, tz), who: x.who, action: x.action, details: detailText(x.detail) }));
    const columns: Column[] = [
      { key: "when", label: "When", type: "text" }, { key: "who", label: "Who", type: "text" },
      { key: "action", label: "Action", type: "text" }, { key: "details", label: "Details", type: "text" },
    ];
    return base(ctx, "audit", "Audit report", [rangeWords(from, to), ...(await filterWords(tx, f, { q: true }))], columns, rows, null,
      capped ? [`Showing the newest ${AUDIT_CAP} entries. Narrow the date range or search to see the rest.`] : []);
  });
}
