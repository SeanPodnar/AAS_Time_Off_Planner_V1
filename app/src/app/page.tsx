import Link from "next/link";
import { currentSite, requireCompanyUser } from "@/lib/session";
import { CompanyHeader, brandStyle } from "./components/CompanyHeader";
import { Balances } from "./components/Balances";
import { currentBalances } from "@/lib/accrual/post";
import { getSettings } from "@/lib/people";
import { companyFor } from "@/lib/requests/company";
import { listMyRequests } from "@/lib/requests/service";
import { approvalsBadge } from "./requests/context";
import { RequestsTable } from "./requests/RequestsTable";

const REQUESTED: Record<string, string> = {
  "1": "Your request was sent for approval.",
  approved: "Your request is approved.",
  updated: "Your request was updated and sent back for approval.",
  change: "Your change was sent for approval. Your current dates stay booked until it is approved.",
};
const CANCELLED: Record<string, string> = {
  cancelled: "Your request was cancelled.",
  pending_cancellation: "Your cancellation was sent for approval. The time stays booked until it is approved.",
};

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ requested?: string; cancel?: string; cancelError?: string; all?: string }> }) {
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
  const sp = await searchParams;
  const company = await companyFor(site);
  const actor = { personId: user.personId, role: user.role };
  const [mine, approvals] = await Promise.all([listMyRequests(company, actor), approvalsBadge(company, actor)]);
  const showAll = sp.all === "1";
  const rows = showAll ? mine : mine.filter((r) => r.status !== "superseded");
  const hasPast = mine.some((r) => r.status === "superseded");
  return (
    <div style={brandStyle(t)}>
      <CompanyHeader tenant={t} user={user} current="/" approvals={approvals} />
      <main className="wrap">
        <div className="pagehead">
          <h1>{t.shortLabel} time off</h1>
          <Link className="btn" href="/requests/new">Request time off</Link>
        </div>
        {sp.requested && REQUESTED[sp.requested] && <p className="notice ok" role="status">{REQUESTED[sp.requested]}</p>}
        {sp.cancel && CANCELLED[sp.cancel] && <p className="notice ok" role="status">{CANCELLED[sp.cancel]}</p>}
        {sp.cancelError && <p className="notice warn" role="alert">{sp.cancelError}</p>}
        <h2>My balances</h2>
        <Balances asOf={asOf} balances={balances} />
        <div className="pagehead">
          <h2>My requests</h2>
          {hasPast && <Link className="small" href={showAll ? "/" : "/?all=1"}>{showAll ? "Hide past changes" : "Show past changes"}</Link>}
        </div>
        <RequestsTable rows={rows} viewerId={user.personId} returnTo="/" />
      </main>
    </div>
  );
}
