import { listTenants } from "@/lib/tenants";
import { requirePlatformOwner } from "@/lib/session";
import { signOut } from "../login/actions";
import { meetsAA } from "@/lib/color";
import { CreateCompanyForm } from "./CreateCompanyForm";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const owner = await requirePlatformOwner();
  const tenants = await listTenants();
  const root = process.env.ROOT_DOMAIN ?? "localhost";
  return (
    <main className="wrap">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1>Companies</h1>
          <p className="muted">Signed in as {owner.fullName}. Each company&apos;s data stays separate; this list shows company details only.</p>
        </div>
        <form action={signOut}><button className="btn" type="submit">Sign out</button></form>
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
