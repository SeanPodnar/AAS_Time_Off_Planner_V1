import { requireAdmin } from "@/lib/session";
import { CompanyHeader, brandStyle } from "../../components/CompanyHeader";
import { ImportFlow } from "./ImportFlow";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const { site, user } = await requireAdmin();
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/people" />
      <main className="wrap">
        <div><h1>Import people</h1><p className="muted">Add or update many people at once from a spreadsheet. You&apos;ll see a preview before anything is saved. Opening balances can be imported once plans are set up.</p></div>
        <ImportFlow />
      </main>
    </div>
  );
}
