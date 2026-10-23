import Link from "next/link";
import { listPeople } from "@/lib/people";
import { jurisdictionName } from "@/lib/jurisdictions";
import { requireAdmin } from "@/lib/session";
import { CompanyHeader, brandStyle } from "../components/CompanyHeader";

export const dynamic = "force-dynamic";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { site, user, actor } = await requireAdmin();
  const sp = await searchParams;
  const status = sp.status === "inactive" || sp.status === "all" ? sp.status : "active";
  const q = (sp.q ?? "").slice(0, 100);
  const people = await listPeople(site.tenant.id, actor, { q, status });
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/people" />
      <main className="wrap">
        <div className="pagehead">
          <div><h1>People</h1><p className="muted">{people.length} {status === "all" ? "" : status} {people.length === 1 ? "person" : "people"}{q ? ` matching "${q}"` : ""}</p></div>
          <div className="row"><Link className="btn secondary" href="/people/import">Import</Link><Link className="btn" href="/people/new">Add person</Link></div>
        </div>
        <form className="row" role="search" method="get">
          <input name="q" defaultValue={q} placeholder="Search name, email, team, location or manager" aria-label="Search people" style={{ maxWidth: 360 }} />
          <select name="status" defaultValue={status} aria-label="Status" style={{ width: "auto" }}>
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
          </select>
          <button className="btn secondary" type="submit">Search</button>
        </form>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Name</th><th>Team</th><th>Location</th><th>Province or state</th><th>Manager</th><th>Work days</th><th>Role</th></tr></thead>
            <tbody>
              {people.length === 0 && <tr><td colSpan={7} className="muted">No one matches. Try a different search or status.</td></tr>}
              {people.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/people/${p.id}`}>{p.fullName}</Link><div className="muted small">{p.email}</div></td>
                  <td>{p.team ?? <span className="muted">None</span>}</td>
                  <td>{p.location ?? <span className="muted">None</span>}</td>
                  <td>{jurisdictionName(p.jurisdiction)}</td>
                  <td>{p.managerName ?? <span className="muted">None</span>}</td>
                  <td>{p.workDays.length === 5 && p.workDays.join() === "1,2,3,4,5" ? "Mon to Fri" : `${p.workDays.length} days`}{p.hoursPerDay !== 8 ? `, ${p.hoursPerDay} h` : ""}</td>
                  <td>{p.role === "admin" ? <span className="pill ok">HR admin</span> : "Employee"}{p.status === "inactive" && <> <span className="pill">Inactive</span></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
