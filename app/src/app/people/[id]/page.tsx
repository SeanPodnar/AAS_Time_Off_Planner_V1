import { notFound } from "next/navigation";
import { getPerson, getSettings, listPeople, listTeamsAndLocations } from "@/lib/people";
import { currentBalances } from "@/lib/accrual/post";
import { todayIn } from "@/lib/accrual/dates";
import { Balances } from "../../components/Balances";
import { listAssignments, listPlans } from "@/lib/plans";
import { requireAdmin } from "@/lib/session";
import { CompanyHeader, brandStyle } from "../../components/CompanyHeader";
import { PersonForm } from "../PersonForm";
import { setStatusAction } from "../actions";
import { assignPersonAction } from "../../plans/actions";

export const dynamic = "force-dynamic";

export default async function EditPersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; status?: string; error?: string; assigned?: string; assignError?: string }> }) {
  const { site, user, actor } = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const person = await getPerson(site.tenant.id, actor, id);
  if (!person) notFound();
  const [people, lists] = await Promise.all([listPeople(site.tenant.id, actor), listTeamsAndLocations(site.tenant.id)]);
  const [assignments, plans] = await Promise.all([listAssignments(site.tenant.id, actor, person.id), listPlans(site.tenant.id, actor)]);
  const settings = await getSettings(site.tenant.id, site.tenant.country);
  const today = todayIn(settings.timeZone);
  const { asOf, balances } = await currentBalances(site.tenant.id, settings.timeZone, person.id);
  const active = person.status === "active";
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/people" />
      <main className="wrap">
        <div className="pagehead">
          <div><h1>{person.fullName}</h1><p className="muted">{person.jobTitle ?? "No job title"} · {active ? "Active" : "Inactive"}</p></div>
          <form action={setStatusAction}>
            <input type="hidden" name="id" value={person.id} />
            <input type="hidden" name="status" value={active ? "inactive" : "active"} />
            <button className="btn secondary" type="submit">{active ? "Deactivate" : "Reactivate"}</button>
          </form>
        </div>
        {sp.saved && <p className="notice ok" role="status">Saved.</p>}
        {sp.status === "inactive" && <p className="notice ok" role="status">{person.fullName} is deactivated and signed out everywhere. Their records stay for reports.</p>}
        {sp.status === "active" && <p className="notice ok" role="status">{person.fullName} can sign in again.</p>}
        {sp.error && <p className="notice warn" role="alert">{sp.error}</p>}
        <PersonForm person={person} managers={people.map((p) => ({ id: p.id, name: p.fullName }))} teams={lists.teams} locations={lists.locations} />
        <section className="card">
          <h2>Plans</h2>
          {sp.assigned && <p className="notice ok" role="status">Plan assigned.</p>}
          {sp.assignError && <p className="notice warn" role="alert">{sp.assignError}</p>}
          <Balances asOf={asOf} balances={balances} showCompliance />
          {assignments.length === 0 ? <p className="muted">No plans yet.</p> : (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Plan</th><th>Level</th><th>From</th><th>Until</th></tr></thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.id}><td>{a.planName}</td><td>{a.levelName}</td><td>{a.effectiveFrom}</td><td>{a.current ? <span className="pill ok">Current</span> : a.effectiveTo}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {plans.some((p) => p.active) && (
            <form action={assignPersonAction}>
              <input type="hidden" name="personId" value={person.id} />
              <div className="row">
                <div className="field">
                  <label htmlFor="assign-plan">Plan and level</label>
                  <select id="assign-plan" name="planLevel" required>
                    {plans.filter((p) => p.active).map((p) => (
                      <optgroup key={p.id} label={p.name}>{p.levels.map((l) => <option key={l.id} value={`${p.id}:${l.id}`}>{p.name}, {l.name}</option>)}</optgroup>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="assign-from">From</label>
                  <input id="assign-from" name="effectiveFrom" type="date" defaultValue={today} required />
                </div>
                <button className="btn" type="submit">Assign</button>
              </div>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
