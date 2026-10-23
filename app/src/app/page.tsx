import Link from "next/link";
import { currentSite, requireCompanyUser } from "@/lib/session";
import { CompanyHeader, brandStyle } from "./components/CompanyHeader";

export const dynamic = "force-dynamic";

export default async function Home() {
  const site = await currentSite();
  if (site.kind === "platform") {
    return (
      <main className="wrap">
        <h1>AAS Time Off Planner</h1>
        <p className="muted">Open your company&apos;s sign-in address to continue.</p>
        <p className="small"><Link href="/platform">Platform console</Link></p>
      </main>
    );
  }

  const { user } = await requireCompanyUser();
  const t = site.tenant;
  return (
    <div style={brandStyle(t)}>
      <CompanyHeader tenant={t} user={user} current="/" />
      <main className="wrap">
        <h1>{t.shortLabel} time off</h1>
        <p className="muted">You&apos;re signed in. Balances and requests arrive with the next roadmap items.</p>
      </main>
    </div>
  );
}
