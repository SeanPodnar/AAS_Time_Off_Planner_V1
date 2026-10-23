import Link from "next/link";
import { listPlans, starterTemplates } from "@/lib/plans";
import { APPROVAL_LABELS, CATEGORY_LABELS, VISIBILITY_LABELS, howEarned } from "@/lib/planText";
import { requireAdmin } from "@/lib/session";
import { CompanyHeader, brandStyle } from "../components/CompanyHeader";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const { site, user, actor } = await requireAdmin();
  const plans = await listPlans(site.tenant.id, actor);
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/plans" />
      <main className="wrap">
        <div className="pagehead">
          <div><h1>Plans</h1><p className="muted">{plans.length} {plans.length === 1 ? "plan" : "plans"}</p></div>
          <Link className="btn" href="/plans/new">Add plan</Link>
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Plan</th><th>Category</th><th>Unit</th><th>How it is earned</th><th>Levels</th><th>People</th><th>Approval</th><th>Coworkers see</th><th>Active</th></tr></thead>
            <tbody>
              {plans.length === 0 && <tr><td colSpan={9} className="muted">No plans yet. Add one or start from a template below.</td></tr>}
              {plans.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/plans/${p.id}`}>{p.name}</Link></td>
                  <td>{CATEGORY_LABELS[p.category]}</td>
                  <td>{p.unit === "hours" ? "Hours" : "Days"}</td>
                  <td>{howEarned(p)}</td>
                  <td>{p.accrualMethod === "none" ? <span className="muted">None</span> : p.levels.map((l) => <div key={l.id}>{l.name}: {l.annualAmount}</div>)}</td>
                  <td>{p.assignedCount}</td>
                  <td>{APPROVAL_LABELS[p.approvalMode]}</td>
                  <td>{VISIBILITY_LABELS[p.visibility]}</td>
                  <td>{p.active ? <span className="pill ok">Active</span> : <span className="pill">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <section className="card">
          <h2>Start from a template</h2>
          <p className="muted small">Opens the form filled in. Nothing is saved until you save it.</p>
          <div className="row">
            {starterTemplates.map((t) => <Link key={t.key} className="btn secondary" href={`/plans/new?template=${t.key}`}>{t.label}</Link>)}
          </div>
        </section>
      </main>
    </div>
  );
}
