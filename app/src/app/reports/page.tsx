import Link from "next/link";
import { REPORTS } from "@/lib/reports";
import { requireAdmin } from "@/lib/session";
import { CompanyHeader, brandStyle } from "../components/CompanyHeader";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const { site, user } = await requireAdmin();
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/reports" />
      <main className="wrap">
        <h1>Reports</h1>
        <p className="muted">Open a report to choose its filters, then view it here or download it as Excel or CSV.</p>
        <div className="grid">
          {REPORTS.map((r) => (
            <div key={r.key} className="card">
              <h2><Link href={`/reports/${r.key}`}>{r.title}</Link></h2>
              <p className="muted small">{r.description}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
