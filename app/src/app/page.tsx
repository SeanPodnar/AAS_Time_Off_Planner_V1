import Link from "next/link";
import { currentSite, requireCompanyUser } from "@/lib/session";
import { CompanyHeader, brandStyle } from "./components/CompanyHeader";
import { Balances } from "./components/Balances";
import { currentBalances } from "@/lib/accrual/post";
import { getSettings } from "@/lib/people";

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
  const settings = await getSettings(t.id, t.country);
  const { asOf, balances } = await currentBalances(t.id, settings.timeZone, user.personId);
  return (
    <div style={brandStyle(t)}>
      <CompanyHeader tenant={t} user={user} current="/" />
      <main className="wrap">
        <h1>{t.shortLabel} time off</h1>
        <h2>My balances</h2>
        <Balances asOf={asOf} balances={balances} />
        <p className="small muted">Requests arrive with the next roadmap item.</p>
      </main>
    </div>
  );
}
