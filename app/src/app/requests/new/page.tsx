import Link from "next/link";
import { CompanyHeader, brandStyle } from "../../components/CompanyHeader";
import { requestablePlans } from "@/lib/requests/service";
import { approvalsBadge, requestContext } from "../context";
import { RequestForm } from "../RequestForm";

export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  const { site, user, company, actor } = await requestContext();
  const [plans, approvals] = await Promise.all([requestablePlans(company, actor), approvalsBadge(company, actor)]);
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/" approvals={approvals} />
      <main className="wrap">
        <h1>Request time off</h1>
        {plans.length === 0 ? (
          <p className="muted">You have no plans to book from yet. <Link href="/">Back to my time off</Link></p>
        ) : (
          <RequestForm plans={plans.map((p) => ({ id: p.id, name: p.name }))} initial={{}} />
        )}
      </main>
    </div>
  );
}
