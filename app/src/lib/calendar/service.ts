// Team calendar (FR-60) and private calendar feeds (FR-61). Labels come from visibility.ts;
// everything runs inside withTenant, so no company sees another's people or time off.
import type postgres from "postgres";
import { withTenant, writeAudit } from "../tenancy";
import { NotAllowed, type Actor } from "../people";
import { hashToken, looksLikeToken, newToken } from "../tokens";
import { RateLimiter } from "../rate-limit";
import { addDays, todayIn, type ISODate } from "../accrual/dates";
import type { Company } from "../requests/service";
import { canFilterByPlan, feedLabelFor, labelFor, type Relation, type Status, type Visibility } from "./visibility";
import { buildIcs, type IcsEvent } from "./ics";

type Tx = postgres.TransactionSql;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const d = (v: unknown): ISODate => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/** Everyone the viewer manages: their reports at any level, plus people they are a secondary manager for. */
export async function managedBy(tx: Tx, viewerId: string): Promise<Set<string>> {
  const rows = await tx`
    with recursive r(id) as (
      select id from people where manager_id = ${viewerId}
      union select p.id from people p join r on p.manager_id = r.id
    )
    select id from r union select person_id as id from person_managers where manager_id = ${viewerId}`;
  return new Set(rows.map((x) => x.id as string));
}

function relation(actor: Actor, personId: string, managed: Set<string>): Relation {
  if (personId === actor.personId) return "self";
  if (actor.role === "admin") return "hr";
  return managed.has(personId) ? "manager" : "coworker";
}

// Live bookings: pending or approved new requests and approved changes. A pending change is left
// out; the approved original stays on the calendar until the change is approved.
const LIVE = (tx: Tx) => tx`r.status in ('pending', 'approved') and r.kind <> 'cancel' and not (r.kind = 'change' and r.status = 'pending')`;

export type CalendarFilter = { from: string; to: string; teamId?: string; locationId?: string; planId?: string };
export type CalendarPerson = { id: string; name: string; team: string | null; location: string | null };
export type CalendarEntry = { personId: string; day: ISODate; part: "full" | "am" | "pm"; label: string; status: Status };
export type CalendarView = { from: ISODate; to: ISODate; people: CalendarPerson[]; entries: CalendarEntry[]; plans: { id: string; name: string }[]; teams: { id: string; name: string }[]; locations: { id: string; name: string }[] };

/**
 * The team calendar for a date range (up to 93 days). People can be filtered by team and
 * location. Filtering by plan only matches bookings whose plan the viewer is allowed to see.
 */
export async function teamCalendar(company: Company, actor: Actor, f: CalendarFilter): Promise<CalendarView> {
  const from = DATE.test(f.from) ? f.from : todayIn(company.timeZone);
  let to = DATE.test(f.to) && f.to >= from ? f.to : addDays(from, 27);
  if (addDays(from, 92) < to) to = addDays(from, 92);
  const teamId = f.teamId && UUID.test(f.teamId) ? f.teamId : null;
  const locationId = f.locationId && UUID.test(f.locationId) ? f.locationId : null;
  const planId = f.planId && UUID.test(f.planId) ? f.planId : null;

  return withTenant(company.tenantId, async (tx) => {
    const managed = await managedBy(tx, actor.personId);
    const people = await tx`
      select p.id, p.full_name, t.name as team, l.name as location from people p
        left join teams t on t.id = p.team_id left join locations l on l.id = p.location_id
       where p.status = 'active' ${teamId ? tx`and p.team_id = ${teamId}` : tx``} ${locationId ? tx`and p.location_id = ${locationId}` : tx``}
       order by lower(p.full_name)`;
    const ids = people.map((p) => p.id as string);
    const rows = ids.length === 0 ? [] : await tx`
      select r.person_id, rd.day, rd.part, r.status, r.plan_id, pl.name as plan_name, pl.visibility
        from request_days rd join requests r on r.id = rd.request_id join plans pl on pl.id = r.plan_id
       where rd.day between ${from} and ${to} and r.person_id = any(${ids}::uuid[]) and ${LIVE(tx)}
       order by rd.day`;
    const entries: CalendarEntry[] = [];
    for (const x of rows) {
      const rel = relation(actor, x.person_id, managed);
      const vis = x.visibility as Visibility;
      if (planId && (x.plan_id !== planId || !canFilterByPlan(rel, vis))) continue;
      const label = labelFor(rel, x.plan_name, vis, x.status);
      if (label === null) continue;
      entries.push({ personId: x.person_id, day: d(x.day), part: x.part, label, status: x.status });
    }
    const allPlans = await tx`select id, name, visibility from plans where active order by lower(name)`;
    const privileged = actor.role === "admin" || managed.size > 0;
    const plans = allPlans.filter((p) => privileged || p.visibility === "name").map((p) => ({ id: p.id as string, name: p.name as string }));
    const teams = (await tx`select id, name from teams order by lower(name)`).map((t) => ({ id: t.id as string, name: t.name as string }));
    const locations = (await tx`select id, name from locations order by lower(name)`).map((t) => ({ id: t.id as string, name: t.name as string }));
    return {
      from, to, entries, plans, teams, locations,
      people: people.map((p) => ({ id: p.id, name: p.full_name, team: p.team, location: p.location })),
    };
  });
}

// Feeds ---------------------------------------------------------------------------------

export type FeedScope = "me" | "team" | "reports";
export type FeedRow = { scope: FeedScope; createdAt: string; lastUsedAt: string | null };

/** The person's live feed links (the links themselves are shown only once, when made). */
export async function myFeeds(company: Company, actor: Actor): Promise<{ feeds: FeedRow[]; canReports: boolean; hasTeam: boolean }> {
  return withTenant(company.tenantId, async (tx) => {
    const rows = await tx`select scope, created_at, last_used_at from calendar_feeds where person_id = ${actor.personId} and revoked_at is null order by scope`;
    const managed = await managedBy(tx, actor.personId);
    const [me] = await tx`select team_id, manager_id from people where id = ${actor.personId}`;
    return {
      feeds: rows.map((r) => ({ scope: r.scope, createdAt: new Date(r.created_at).toISOString(), lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null })),
      canReports: managed.size > 0,
      hasTeam: !!(me?.team_id || me?.manager_id),
    };
  });
}

/** Makes a new link for a scope, revoking any earlier one. Returns the secret token once. */
export async function resetFeed(company: Company, actor: Actor, scope: FeedScope): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (!["me", "team", "reports"].includes(scope)) return { ok: false, error: "Choose a calendar." };
  return withTenant(company.tenantId, async (tx) => {
    if (scope === "reports" && (await managedBy(tx, actor.personId)).size === 0) throw new NotAllowed("Only managers have a reports calendar");
    await tx`update calendar_feeds set revoked_at = now() where person_id = ${actor.personId} and scope = ${scope} and revoked_at is null`;
    const token = newToken();
    await tx`insert into calendar_feeds (tenant_id, person_id, scope, token_hash) values (${company.tenantId}, ${actor.personId}, ${scope}, ${hashToken(token)})`;
    await writeAudit(tx, `person:${actor.personId}`, "calendar_feed.reset", { scope });
    return { ok: true as const, token };
  });
}

export async function revokeFeed(company: Company, actor: Actor, scope: FeedScope): Promise<void> {
  await withTenant(company.tenantId, async (tx) => {
    const r = await tx`update calendar_feeds set revoked_at = now() where person_id = ${actor.personId} and scope = ${scope} and revoked_at is null returning id`;
    if (r.length) await writeAudit(tx, `person:${actor.personId}`, "calendar_feed.revoked", { scope });
  });
}

// Calendar apps poll every few minutes to every few hours; this only stops runaway fetching.
const feedLimiter = new RateLimiter(120, 60 * 60_000);

/**
 * The ICS file for a feed token on this company's address, or null if the token is unknown,
 * revoked, belongs to another company, or its owner is inactive. Covers 90 days back and a year ahead.
 * Names, dates and half days only: no comments, balances or approvers.
 */
export async function renderFeed(company: Company, token: string, host: string, now = new Date()): Promise<string | null> {
  if (!looksLikeToken(token)) return null;
  const hash = hashToken(token);
  if (!feedLimiter.take(hash.toString("hex"))) return null;
  return withTenant(company.tenantId, async (tx) => {
    const [feed] = await tx`select f.id, f.person_id, f.scope, p.full_name, p.team_id, p.manager_id from calendar_feeds f join people p on p.id = f.person_id
                             where f.token_hash = ${hash} and f.revoked_at is null and p.status = 'active'`;
    if (!feed) return null;
    await tx`update calendar_feeds set last_used_at = now() where id = ${feed.id}`;
    const today = todayIn(company.timeZone, now);
    const from = addDays(today, -90), to = addDays(today, 365);
    let who: string[];
    if (feed.scope === "me") who = [feed.person_id];
    else if (feed.scope === "reports") who = [...(await managedBy(tx, feed.person_id))];
    else {
      const rows = await tx`select id from people where status = 'active' and id <> ${feed.person_id}
                              and ((${feed.team_id}::uuid is not null and team_id = ${feed.team_id}) or (${feed.manager_id}::uuid is not null and manager_id = ${feed.manager_id}))`;
      who = rows.map((r) => r.id as string);
    }
    const own = feed.scope === "me";
    const reqs = who.length === 0 ? [] : await tx`
      select r.id, r.start_date, r.end_date, r.start_part, r.end_part, r.status, p.full_name, pl.name as plan_name, pl.visibility, pl.calendar_status
        from requests r join people p on p.id = r.person_id join plans pl on pl.id = r.plan_id
       where r.person_id = any(${who}::uuid[]) and r.end_date >= ${from} and r.start_date <= ${to} and ${LIVE(tx)}
         and (${own} or r.status = 'approved')
       order by r.start_date`;
    const events: IcsEvent[] = [];
    for (const r of reqs) {
      const label = feedLabelFor(own, r.plan_name, r.visibility as Visibility, r.status as Status);
      if (label === null) continue;
      const half = d(r.start_date) === d(r.end_date) && r.start_part !== "full" ? (r.start_part === "am" ? " (morning)" : " (afternoon)") : "";
      const summary = `${own ? "" : `${r.full_name}: `}${label}${half}${r.status === "pending" ? " (pending)" : ""}`;
      events.push({ uid: `${r.id}@${host}`, start: d(r.start_date), endInclusive: d(r.end_date), summary, busy: r.calendar_status });
    }
    const name = own ? `${company.label}: my time off` : feed.scope === "reports" ? `${company.label}: my team's time off` : `${company.label}: team time off`;
    return buildIcs(name, events, now);
  });
}
