import Link from "next/link";
import { notFound } from "next/navigation";
import { findReport, runReport } from "@/lib/reports";
import type { Cell, Column, Row } from "@/lib/reports/types";
import { formatDate } from "@/lib/reports/types";
import { getSettings, listPeople, type PersonRow } from "@/lib/people";
import { listPlans } from "@/lib/plans";
import { withTenant } from "@/lib/tenancy";
import { requireAdmin } from "@/lib/session";
import { CompanyHeader, brandStyle } from "../../components/CompanyHeader";
import { filterFrom, filterQuery, first, type SP } from "../params";

export const dynamic = "force-dynamic";

const NUM = new Intl.NumberFormat("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const isNum = (c: Column) => c.type === "number" || c.type === "percent";

function show(c: Column, v: Cell): string {
  if (v === null || v === "") return "";
  if (typeof v === "number") {
    if (c.type === "percent") return `${(v * 100).toFixed(1)}%`;
    return c.decimals !== undefined ? v.toFixed(c.decimals) : NUM.format(v);
  }
  return c.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : v;
}

/** Sorts rows by one column; empty cells always go last. The totals row is kept apart by the caller. */
function sortRows(rows: Row[], col: Column, dir: "asc" | "desc"): Row[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[col.key], y = b[col.key];
    const xe = x === null || x === "", ye = y === null || y === "";
    if (xe || ye) return xe === ye ? 0 : xe ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return String(x).localeCompare(String(y), "en", { numeric: true }) * sign;
  });
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SP> }) {
  const { key } = await params;
  const { site, user, actor } = await requireAdmin();
  const def = findReport(key);
  if (!def) notFound();
  const tenantId = site.tenant.id;
  const sp = await searchParams;
  const settings = await getSettings(tenantId, site.tenant.country);
  const as = { tenantId, timeZone: settings.timeZone, runByName: user.fullName };
  const report = await runReport(actor, as, key, filterFrom(sp));
  if (!report) notFound();

  const wants = new Set<string>(def.filters);
  const people = wants.has("people");
  const [lists, everyone, plans] = await Promise.all([
    people ? withTenant(tenantId, async (tx) => ({
      teams: (await tx`select id, name from teams order by lower(name)`) as unknown as { id: string; name: string }[],
      locations: (await tx`select id, name from locations order by lower(name)`) as unknown as { id: string; name: string }[],
    })) : null,
    people ? listPeople(tenantId, actor) : ([] as PersonRow[]),
    wants.has("plan") ? listPlans(tenantId, actor) : [],
  ]);
  const managerIds = new Set(everyone.map((p) => p.managerId).filter(Boolean));
  const managers = everyone.filter((p) => managerIds.has(p.id));

  const sortCol = report.columns.find((c) => c.key === first(sp.sort));
  const dir = first(sp.dir) === "desc" ? "desc" : "asc";
  const rows = sortCol ? sortRows(report.rows, sortCol, dir) : report.rows;

  const fq = filterQuery(sp);
  const sortHref = (c: Column) => {
    const q = new URLSearchParams(fq);
    q.set("sort", c.key);
    q.set("dir", sortCol?.key === c.key && dir === "asc" ? "desc" : "asc");
    return `/reports/${key}?${q.toString()}`;
  };
  const exportHref = (format: string) => `/reports/${key}/export?${new URLSearchParams([...new URLSearchParams(fq), ["format", format]]).toString()}`;
  const val = (k: string) => first(sp[k]);

  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/reports" />
      <main className="wrap">
        <p className="muted small"><Link href="/reports">Back to reports</Link></p>
        <form method="get" className="card">
          <div className="row filters">
            {wants.has("range") && (
              <>
                <div className="field"><label htmlFor="f-from">From</label><input id="f-from" name="from" type="date" defaultValue={val("from")} /></div>
                <div className="field"><label htmlFor="f-to">To</label><input id="f-to" name="to" type="date" defaultValue={val("to")} /></div>
              </>
            )}
            {wants.has("asOf") && <div className="field"><label htmlFor="f-asof">As of</label><input id="f-asof" name="asOf" type="date" defaultValue={val("asOf")} /></div>}
            {wants.has("until") && <div className="field"><label htmlFor="f-until">Plan years ending by</label><input id="f-until" name="to" type="date" defaultValue={val("to")} /></div>}
            {lists && (
              <>
                <div className="field">
                  <label htmlFor="f-team">Team</label>
                  <select id="f-team" name="team" defaultValue={val("team")}><option value="">All</option>{lists.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                </div>
                <div className="field">
                  <label htmlFor="f-location">Location</label>
                  <select id="f-location" name="location" defaultValue={val("location")}><option value="">All</option>{lists.locations.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                </div>
                <div className="field">
                  <label htmlFor="f-manager">Manager</label>
                  <select id="f-manager" name="manager" defaultValue={val("manager")}><option value="">All</option>{managers.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select>
                </div>
              </>
            )}
            {wants.has("plan") && (
              <div className="field">
                <label htmlFor="f-plan">Plan</label>
                <select id="f-plan" name="plan" defaultValue={val("plan")}><option value="">All</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </div>
            )}
            {wants.has("q") && <div className="field"><label htmlFor="f-q">Search</label><input id="f-q" name="q" type="search" defaultValue={val("q")} /></div>}
            <button className="btn" type="submit">Show report</button>
          </div>
        </form>

        <div className="pagehead">
          <div className="stack">
            <h1>{report.title}</h1>
            <p className="muted small">{report.companyName}</p>
            <p className="muted small">{report.runLabel}</p>
            {report.filters.length > 0 && <p className="small">{report.filters.join(" | ")}</p>}
          </div>
          <div className="row">
            <a className="btn secondary" href={exportHref("xlsx")}>Download Excel</a>
            <a className="btn secondary" href={exportHref("csv")}>Download CSV</a>
          </div>
        </div>
        {report.notes.map((n, i) => <p key={i} className="notice" role="note">{n}</p>)}

        <div className="tablewrap">
          <table className="report-table">
            <caption className="sr-only">{report.title}</caption>
            <thead>
              <tr>
                {report.columns.map((c) => (
                  <th key={c.key} scope="col" className={isNum(c) ? "num" : undefined} aria-sort={sortCol?.key === c.key ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                    <Link href={sortHref(c)}>{c.label}{sortCol?.key === c.key ? (dir === "asc" ? " (up)" : " (down)") : ""}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={report.columns.length} className="muted">Nothing to show for these filters.</td></tr>}
              {rows.map((r, i) => (
                <tr key={i}>
                  {report.columns.map((c) => <td key={c.key} className={isNum(c) ? "num" : c.key === "details" || c.key === "note" ? "wrapcell" : undefined}>{show(c, r[c.key])}</td>)}
                </tr>
              ))}
            </tbody>
            {report.totals && rows.length > 0 && (
              <tfoot>
                <tr>{report.columns.map((c) => <td key={c.key} className={isNum(c) ? "num" : undefined}>{show(c, report.totals![c.key])}</td>)}</tr>
              </tfoot>
            )}
          </table>
        </div>
      </main>
    </div>
  );
}
