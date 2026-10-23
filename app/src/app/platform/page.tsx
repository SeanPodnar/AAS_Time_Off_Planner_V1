import { notFound } from "next/navigation";
import { listTenants } from "@/lib/tenants";
import { devPlatformEnabled } from "@/lib/flags";
import { meetsAA } from "@/lib/color";
import { CreateCompanyForm } from "./CreateCompanyForm";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  if (!devPlatformEnabled()) notFound();
  const tenants = await listTenants();
  const root = process.env.ROOT_DOMAIN ?? "localhost";
  return (
    <main className="wrap">
      <div>
        <h1>Companies</h1>
        <p className="muted">Development console. Sign-in for the platform owner arrives with the next roadmap item; until then this page only runs locally.</p>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Short label</th><th>Full legal name</th><th>Sign-in address</th><th>Custom domain</th><th>Country</th><th>Brand colour</th><th>Status</th></tr>
          </thead>
          <tbody>
            {tenants.length === 0 && (
              <tr><td colSpan={7} className="muted">No companies yet. Add the first one below.</td></tr>
            )}
            {tenants.map((t) => (
              <tr key={t.id}>
                <td><strong>{t.shortLabel}</strong></td>
                <td>{t.legalName}</td>
                <td><code>{t.subdomain}.{root}</code></td>
                <td>{t.customDomain ?? <span className="muted">None</span>}</td>
                <td>{t.country === "CA" ? "Canada" : "United States"}</td>
                <td><span className="swatch" style={{ background: t.brandColor }} />{t.brandColor}{!meetsAA(t.brandColor) && <span className="muted small"> (low contrast)</span>}</td>
                <td>{t.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CreateCompanyForm />
    </main>
  );
}
