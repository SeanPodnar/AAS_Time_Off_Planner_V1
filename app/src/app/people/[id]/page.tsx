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
import { companyFor } from "@/lib/requests/company";
import { approvalCount, listPersonRequests, requestablePlans } from "@/lib/requests/service";
import { RequestsTable } from "../../requests/RequestsTable";
import { AddTimeOffForm, AdjustBalanceForm } from "../../requests/AdminTimeOffForms";

export const dynamic = "force-dynamic";

export default async function EditPersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; status?: string; error?: string; assigned?: string; assignError?: string; added?: string; adjusted?: string; cancel?: string; cancelError?: string }> }) {
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
  const company = await companyFor(site);
  const [requests, bookable, approvals] = await Promise.all([listPersonRequests(company, actor, person.id), requestablePlans(company, actor, person.id), approvalCount(company, actor)]);
  const planOptions = bookable.map((p) => ({ id: p.id, name: p.name }));
  const trackedOptions = bookable.filter((p) => p.tracked).map((p) => ({ id: p.id, name: p.name }));
  const active = person.status === "active";
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/people" approvals={approvals} />
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
        <section className="card">
          <h2>Time off</h2>
          {sp.added && <p className="notice ok" role="status">{sp.added === "approved" ? "Time off added and approved." : "Time off added. It is waiting for approval."}</p>}
          {sp.adjusted && <p className="notice ok" role="status">Balance adjusted.</p>}
          {sp.cancel && <p className="notice ok" role="status">{sp.cancel === "cancelled" ? "Cancelled." : "Cancellation sent for approval."}</p>}
          {sp.cancelError && <p className="notice warn" role="alert">{sp.cancelError}</p>}
          <RequestsTable rows={requests} viewerId={user.personId} returnTo={`/people/${person.id}`} showEdit={false} empty="No requests yet." />
          <AddTimeOffForm personId={person.id} plans={planOptions} />
          <AdjustBalanceForm personId={person.id} plans={trackedOptions} today={today} />
        </section>
      </main>
    </div>
  );
}
