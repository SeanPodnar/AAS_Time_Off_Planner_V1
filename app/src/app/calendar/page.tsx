import Link from "next/link";
import { CompanyHeader, brandStyle } from "../components/CompanyHeader";
import { requestContext, approvalsBadge } from "../requests/context";
import { teamCalendar, type CalendarEntry } from "@/lib/calendar/service";
import { addDays, todayIn, weekday } from "@/lib/accrual/dates";
import { abbreviations } from "./abbr";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKS = [2, 4, 6];
type SP = { from?: string; weeks?: string; team?: string; location?: string; plan?: string };

const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...o }).format(new Date(`${iso}T00:00:00Z`));
const PART = { full: "", am: "morning", pm: "afternoon" } as const;

function describe(e: CalendarEntry) {
  return [e.label, PART[e.part], e.status === "pending" ? "pending" : ""].filter(Boolean).join(", ");
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { site, user, company, actor } = await requestContext();
  const sp = await searchParams;
  const weeks = WEEKS.includes(Number(sp.weeks)) ? Number(sp.weeks) : 4;
  const today = todayIn(company.timeZone);
  const thisMonday = addDays(today, 1 - weekday(today));
  const explicitFrom = sp.from && DATE.test(sp.from) && !Number.isNaN(Date.parse(sp.from)) ? sp.from : undefined;
  const from = explicitFrom ?? thisMonday;
  const to = addDays(from, weeks * 7 - 1);
  const [cal, approvals] = await Promise.all([
    teamCalendar(company, actor, { from, to, teamId: sp.team || undefined, locationId: sp.location || undefined, planId: sp.plan || undefined }),
    approvalsBadge(company, actor),
  ]);

  const days: string[] = [];
  for (let d = cal.from; d <= cal.to; d = addDays(d, 1)) days.push(d);
  const byCell = new Map<string, CalendarEntry[]>();
  for (const e of cal.entries) {
    const k = `${e.personId}|${e.day}`;
    const list = byCell.get(k);
    if (list) list.push(e); else byCell.set(k, [e]);
  }
  const abbr = abbreviations(cal.entries.map((e) => e.label));

  const href = (start: string | undefined) => {
    const q = new URLSearchParams();
    if (start) q.set("from", start);
    if (weeks !== 4) q.set("weeks", String(weeks));
    if (sp.team) q.set("team", sp.team);
    if (sp.location) q.set("location", sp.location);
    if (sp.plan) q.set("plan", sp.plan);
    const s = q.toString();
    return s ? `/calendar?${s}` : "/calendar";
  };
  const step = weeks * 7;

  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/calendar" approvals={approvals} />
      <main className="wrap">
        <div className="pagehead">
          <h1>Team calendar</h1>
          <nav className="row" aria-label="Date range">
            <Link className="btn ghost" href={href(addDays(from, -step))}>Previous</Link>
            <Link className="btn ghost" href={href(undefined)}>This week</Link>
            <Link className="btn ghost" href={href(addDays(from, step))}>Next</Link>
          </nav>
        </div>
        <form method="get" action="/calendar" className="card">
          {explicitFrom && <input type="hidden" name="from" value={explicitFrom} />}
          <div className="row filters">
            <div className="field">
              <label htmlFor="f-team">Team</label>
              <select id="f-team" name="team" defaultValue={sp.team ?? ""}>
                <option value="">All</option>
                {cal.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-location">Location</label>
              <select id="f-location" name="location" defaultValue={sp.location ?? ""}>
                <option value="">All</option>
                {cal.locations.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-plan">Type of time off</label>
              <select id="f-plan" name="plan" defaultValue={sp.plan ?? ""}>
                <option value="">All</option>
                {cal.plans.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-weeks">Show</label>
              <select id="f-weeks" name="weeks" defaultValue={String(weeks)}>
                {WEEKS.map((w) => <option key={w} value={w}>{w} weeks</option>)}
              </select>
            </div>
            <button className="btn" type="submit">Apply</button>
          </div>
        </form>

        {cal.people.length === 0 ? (
          <p className="muted">No people match these filters.</p>
        ) : (
          <div className="tablewrap calwrap">
            <table className="cal">
              <caption className="sr-only">Time off for {fmt(cal.from, { day: "numeric", month: "long", year: "numeric" })} to {fmt(cal.to, { day: "numeric", month: "long", year: "numeric" })}, one row per person and one column per day</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: "left" }}>Person</th>
                  {days.map((d) => {
                    const wk = weekday(d) >= 6;
                    return (
                      <th key={d} scope="col" className={wk ? "wkend" : undefined} title={`${fmt(d, { weekday: "long", day: "numeric", month: "long" })}${wk ? ", weekend" : ""}`}>
                        <span>{fmt(d, { weekday: "short" })}</span>
                        <span>{fmt(d, { day: "numeric", month: "short" })}</span>
                        <span className="sr-only">{wk ? ", weekend" : ""}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {cal.people.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">{p.name}{(p.team || p.location) && <span className="muted">{[p.team, p.location].filter(Boolean).join(", ")}</span>}</th>
                    {days.map((d) => {
                      const wk = weekday(d) >= 6;
                      const es = byCell.get(`${p.id}|${d}`);
                      if (!es) return <td key={d} className={wk ? "wkend" : undefined}><span className="sr-only">{wk ? "Weekend, " : ""}Nothing booked</span></td>;
                      const full = es.map(describe).join("; ");
                      return (
                        <td key={d} className={`booked${wk ? " wkend" : ""}`} title={full}>
                          {es.map((e, i) => (
                            <span key={i} className={`chip${e.status === "pending" ? " pending" : ""}`} aria-hidden="true">
                              {abbr.get(e.label)}{e.part !== "full" ? ` ${e.part.toUpperCase()}` : ""}{e.status === "pending" ? " ?" : ""}
                            </span>
                          ))}
                          <span className="sr-only">{full}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <section aria-labelledby="legend-h" className="stack">
          <h2 id="legend-h">Key</h2>
          <ul className="legend">
            {[...abbr.entries()].map(([label, a]) => <li key={label}><span className="chip">{a}</span>{label}</li>)}
            <li><span className="chip">AM</span>/<span className="chip">PM</span>half day, morning or afternoon</li>
            <li><span className="chip pending">?</span>dashed = waiting for approval</li>
            <li><span className="chip" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>Sat</span>shaded columns are weekends</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
