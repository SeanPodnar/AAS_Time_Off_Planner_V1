import { notFound } from "next/navigation";
import { CompanyHeader, brandStyle } from "../../../components/CompanyHeader";
import { listMyRequests, requestablePlans } from "@/lib/requests/service";
import { approvalsBadge, requestContext } from "../../context";
import { RequestForm } from "../../RequestForm";

export const dynamic = "force-dynamic";

export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { site, user, company, actor } = await requestContext();
  const [mine, plans, approvals] = await Promise.all([listMyRequests(company, actor), requestablePlans(company, actor), approvalsBadge(company, actor)]);
  const r = mine.find((x) => x.id === id);
  if (!r || !r.canAmend) notFound();
  const single = r.startDate === r.endDate;
  const initial = {
    planId: r.planId, startDate: r.startDate, endDate: r.endDate, comment: r.comment ?? "",
    singlePart: single ? r.startPart : "full", startPart: single ? "full" : r.startPart, endPart: single ? "full" : r.endPart,
  };
  // A change to approved time off, or an edit of a pending change, keeps its plan.
  const fixed = r.status === "approved" || r.kind === "change";
  const options = plans.map((p) => ({ id: p.id, name: p.name }));
  if (!options.some((p) => p.id === r.planId)) options.push({ id: r.planId, name: r.planName });
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/" approvals={approvals} />
      <main className="wrap">
        <h1>Change your request</h1>
        <RequestForm plans={options} initial={initial} requestId={r.id} fixedPlan={fixed ? { id: r.planId, name: r.planName } : undefined} approvedNote={r.status === "approved"} />
      </main>
    </div>
  );
}
