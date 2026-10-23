import { notFound } from "next/navigation";
import { getPlan } from "@/lib/plans";
import { requireAdmin } from "@/lib/session";
import { CompanyHeader, brandStyle } from "../../components/CompanyHeader";
import { PlanForm } from "../PlanForm";
import { assignAllAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditPlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; assigned?: string; error?: string }> }) {
  const { site, user, actor } = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const plan = await getPlan(site.tenant.id, actor, id);
  if (!plan) notFound();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/plans" />
      <main className="wrap">
        <div className="pagehead">
          <div><h1>{plan.name}</h1><p className="muted">{plan.assignedCount} {plan.assignedCount === 1 ? "person" : "people"} assigned · {plan.active ? "Active" : "Inactive"}</p></div>
        </div>
        {sp.saved && <p className="notice ok" role="status">Saved.</p>}
        {sp.assigned !== undefined && <p className="notice ok" role="status">Assigned to {sp.assigned} {sp.assigned === "1" ? "person" : "people"}.</p>}
        {sp.error && <p className="notice warn" role="alert">{sp.error}</p>}
        <PlanForm plan={plan} planId={plan.id} />
        {plan.active && (
          <form action={assignAllAction} className="card">
            <h2>Assign to everyone without this plan</h2>
            <p className="muted small">Active people who already have this plan are left as they are.</p>
            <input type="hidden" name="planId" value={plan.id} />
            <div className="row">
              <div className="field">
                <label htmlFor="all-level">Level</label>
                <select id="all-level" name="levelId" required>{plan.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
              </div>
              <div className="field">
                <label htmlFor="all-from">From</label>
                <input id="all-from" name="effectiveFrom" type="date" defaultValue={today} required />
              </div>
              <button className="btn" type="submit">Assign</button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
