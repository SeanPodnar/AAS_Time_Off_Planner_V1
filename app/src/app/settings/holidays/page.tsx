import Link from "next/link";
import { getSettings, peopleJurisdictions } from "@/lib/people";
import { todayIn } from "@/lib/accrual/dates";
import { HOLIDAY_RULES_VERIFIED, holidayCalendar } from "@/lib/holidays";
import { JURISDICTIONS, jurisdictionName } from "@/lib/jurisdictions";
import { requireAdmin } from "@/lib/session";
import { CompanyHeader, brandStyle } from "../../components/CompanyHeader";
import { addHolidayAction, removeChangeAction, skipHolidayAction } from "./actions";

export const dynamic = "force-dynamic";

const SOURCE = { statutory: "Statutory", federal: "Federal (optional for private employers)", company: "Company" } as const;
const WEEKDAY = new Intl.DateTimeFormat("en-CA", { weekday: "short", timeZone: "UTC" });
const dayLabel = (d: string) => `${d} (${WEEKDAY.format(new Date(`${d}T00:00:00Z`))})`;

type Params = { year?: string; j?: string; added?: string; skipped?: string; removed?: string; error?: string };

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { site, user, actor } = await requireAdmin();
  const tenantId = site.tenant.id;
  const sp = await searchParams;
  const [settings, counts] = await Promise.all([getSettings(tenantId, site.tenant.country), peopleJurisdictions(tenantId)]);

  const thisYear = Number(todayIn(settings.timeZone).slice(0, 4));
  const years = [thisYear - 1, thisYear, thisYear + 1];
  const year = years.includes(Number(sp.year)) ? Number(sp.year) : thisYear;

  const choices = counts.map((c) => c.jurisdiction);
  const fallback = site.tenant.country === "CA" ? "CA-ON" : "US-NY";
  const options = choices.length > 0 ? choices : [fallback];
  const j = sp.j && JURISDICTIONS.some((x) => x.code === sp.j) ? sp.j : options[0];
  if (!options.includes(j)) options.push(j);
  const name = jurisdictionName(j);

  const days = await holidayCalendar(tenantId, actor, j, year);
  const hidden = (
    <>
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="j" value={j} />
    </>
  );

  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/settings" />
      <main className="wrap">
        <h1>Holidays</h1>
        <p className="muted small"><Link href="/settings">Back to company settings</Link></p>
        {!HOLIDAY_RULES_VERIFIED && <p className="notice warn" role="note">Statutory holidays come from published sources and are pending legal review.</p>}
        {sp.added && <p className="notice ok" role="status">Company holiday added.</p>}
        {sp.skipped && <p className="notice ok" role="status">Holiday is no longer observed.</p>}
        {sp.removed && <p className="notice ok" role="status">Change removed.</p>}
        {sp.error && <p className="notice warn" role="alert">{sp.error}</p>}

        <form method="get" className="card">
          <div className="grid">
            <div className="field">
              <label htmlFor="year">Year</label>
              <select id="year" name="year" defaultValue={String(year)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            </div>
            <div className="field">
              <label htmlFor="j">Province or state</label>
              <select id="j" name="j" defaultValue={j}>
                {options.map((o) => <option key={o} value={o}>{jurisdictionName(o)}{counts.find((c) => c.jurisdiction === o) ? ` (${counts.find((c) => c.jurisdiction === o)!.count})` : ""}</option>)}
              </select>
              <span className="muted small">Only places where active people work. The number is how many.</span>
            </div>
          </div>
          <button className="btn" type="submit">Show holidays</button>
        </form>

        <h2>{name}, {year}</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Name</th><th>Source</th><th>Status</th></tr></thead>
            <tbody>
              {days.length === 0 && <tr><td colSpan={4} className="muted">No holidays for this year.</td></tr>}
              {days.map((h) => (
                <tr key={`${h.date}-${h.source}-${h.name}`}>
                  <td>{dayLabel(h.date)}</td>
                  <td>{h.name}</td>
                  <td><span className={h.source === "company" ? "pill ok" : "pill"}>{SOURCE[h.source]}</span></td>
                  <td>
                    {h.source === "company" ? (
                      <form action={removeChangeAction} className="row">
                        {hidden}
                        <input type="hidden" name="id" value={h.changeId ?? ""} />
                        <span className="small">{h.jurisdiction ? `${jurisdictionName(h.jurisdiction)} only` : "Everyone"}</span>
                        <button className="btn ghost small" type="submit">Remove</button>
                      </form>
                    ) : h.skipped ? (
                      <form action={removeChangeAction} className="row">
                        {hidden}
                        <input type="hidden" name="id" value={h.changeId ?? ""} />
                        <span className="pill bad">Not observed</span>
                        <button className="btn ghost small" type="submit">Observe again</button>
                      </form>
                    ) : (
                      <form action={skipHolidayAction} className="stack">
                        {hidden}
                        <input type="hidden" name="day" value={h.date} />
                        <input type="hidden" name="name" value={h.name} />
                        <div className="row">
                          <label className="small muted" htmlFor={`r-${h.date}`}>{h.source === "statutory" ? "Reason (required)" : "Reason (optional)"}</label>
                          <input id={`r-${h.date}`} name="reason" maxLength={500} required={h.source === "statutory"} style={{ width: "16rem" }} />
                          <button className="btn ghost small" type="submit">Don&apos;t observe</button>
                        </div>
                        {h.source === "statutory" && <span className="muted small" style={{ whiteSpace: "normal" }}>The law still requires a day off with pay or a substitute day. Add the substitute day below.</span>}
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form action={addHolidayAction} className="card">
          <h2>Add a company holiday</h2>
          {hidden}
          <div className="grid">
            <div className="field">
              <label htmlFor="day">Date</label>
              <input id="day" name="day" type="date" required min={`${year}-01-01`} max={`${year}-12-31`} />
            </div>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" required maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="appliesTo">Applies to</label>
              <select id="appliesTo" name="appliesTo" defaultValue="all">
                <option value="all">Everyone</option>
                <option value="selected">{name} only</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="reason">Reason (optional)</label>
              <input id="reason" name="reason" maxLength={500} />
            </div>
          </div>
          <button className="btn" type="submit">Add holiday</button>
        </form>
      </main>
    </div>
  );
}
