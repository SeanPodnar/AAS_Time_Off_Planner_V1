import { notFound } from "next/navigation";
import { CompanyHeader, brandStyle } from "../components/CompanyHeader";
import { approvalCount, listApprovals, type ApprovalRow } from "@/lib/requests/service";
import { requestContext } from "../requests/context";
import { approveAction, declineAction } from "../requests/actions";
import { STEP_ROLE_LABELS, dateRange } from "../requests/format";

export const dynamic = "force-dynamic";

const KIND = { new: "New", change: "Change to approved time off", cancel: "Cancellation" } as const;
const DECIDED: Record<string, string> = { approved: "Approved.", declined: "Declined.", next: "Approved. It now goes to the next approver." };

function Item({ r, error }: { r: ApprovalRow; error?: string }) {
  return (
    <section className="card">
      <div className="pagehead">
        <div>
          <h2>{r.personName}</h2>
          <p className="muted">{r.planName} · {dateRange(r)} · {r.days} {r.days === 1 ? "day" : "days"}</p>
        </div>
        <div className="row"><span className="pill">{KIND[r.kind]}</span><span className="pill">{STEP_ROLE_LABELS[r.stepRole] ?? r.stepRole}</span></div>
      </div>
      {r.longRun && <p className="small">This joins up to {r.run} working days off.</p>}
      {r.comment && <p className="small"><span className="muted">Comment:</span> {r.comment}</p>}
      {!r.mine && <p className="small muted">Deciding on this is logged as an override.</p>}
      {error && <p className="notice warn" role="alert">{error}</p>}
      <form action={approveAction} className="stack">
        <input type="hidden" name="id" value={r.id} />
        <div className="field">
          <label htmlFor={`c-${r.id}`}>Comment (needed to decline)</label>
          <input id={`c-${r.id}`} name="comment" maxLength={1000} aria-invalid={error ? true : undefined} />
        </div>
        <div className="row">
          <button className="btn" type="submit">Approve</button>
          <button className="btn ghost" type="submit" formAction={declineAction}>Decline</button>
        </div>
      </form>
    </section>
  );
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ decided?: string; error?: string; errorId?: string }> }) {
  const { site, user, company, actor } = await requestContext();
  if (user.role !== "admin" && !user.isManager) notFound();
  const sp = await searchParams;
  const [items, count] = await Promise.all([listApprovals(company, actor), approvalCount(company, actor)]);
  const mine = items.filter((i) => i.mine);
  const others = items.filter((i) => !i.mine);
  const errorFor = (id: string) => (sp.errorId === id ? sp.error : undefined);
  const stray = sp.error && !items.some((i) => i.id === sp.errorId) ? sp.error : undefined;
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/approvals" approvals={count} />
      <main className="wrap">
        <h1>Approvals</h1>
        {sp.decided && DECIDED[sp.decided] && <p className="notice ok" role="status">{DECIDED[sp.decided]}</p>}
        {stray && <p className="notice warn" role="alert">{stray}</p>}
        {mine.length === 0 && <p className="muted">Nothing is waiting for you.</p>}
        {mine.map((r) => <Item key={r.id} r={r} error={errorFor(r.id)} />)}
        {others.length > 0 && (
          <>
            <h2>Other open requests (HR override)</h2>
            <p className="muted small">These are waiting on someone else. If you decide on one, it is logged as an override.</p>
            {others.map((r) => <Item key={r.id} r={r} error={errorFor(r.id)} />)}
          </>
        )}
      </main>
    </div>
  );
}
