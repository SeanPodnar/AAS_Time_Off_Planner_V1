import { notFound } from "next/navigation";
import { CompanyHeader, brandStyle } from "../components/CompanyHeader";
import { approvalCount, listApprovals, type ApprovalRow } from "@/lib/requests/service";
import { requestContext } from "../requests/context";
import { approveAction, declineAction, removeBackupAction, setBackupAction } from "../requests/actions";
import { backupData } from "../requests/backups";
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
      {r.coveringFor && <p className="small muted">You are covering as backup.</p>}
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

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ decided?: string; error?: string; errorId?: string; backup?: string; backupError?: string }> }) {
  const ctx = await requestContext();
  const { site, user, company, actor } = ctx;
  const sp = await searchParams;
  const [items, count, bk] = await Promise.all([listApprovals(company, actor), approvalCount(company, actor), backupData(ctx)]);
  // Managers and HR always have this page; anyone else only while they are someone's backup.
  const isBackup = bk.backups.some((b) => b.backupId === user.personId);
  if (user.role !== "admin" && !user.isManager && !isBackup && items.length === 0) notFound();
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
        <section className="card" id="backup">
          <h2>Away? Set a backup</h2>
          <p className="muted small">Your backup can approve in your place on the days you choose.</p>
          {sp.backup === "set" && <p className="notice ok" role="status">Backup saved.</p>}
          {sp.backup === "removed" && <p className="notice ok" role="status">Backup removed.</p>}
          {sp.backupError && <p className="notice warn" role="alert">{sp.backupError}</p>}
          <form action={setBackupAction} className="stack">
            <div className="grid">
              {user.role === "admin" ? (
                <div className="field">
                  <label htmlFor="bk-approver">Approver</label>
                  <select id="bk-approver" name="approverId" defaultValue={user.personId}>
                    {bk.people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                  </select>
                </div>
              ) : <input type="hidden" name="approverId" value={user.personId} />}
              <div className="field">
                <label htmlFor="bk-backup">Backup person</label>
                <select id="bk-backup" name="backupId" required defaultValue="">
                  <option value="" disabled>Choose a person</option>
                  {bk.choices.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="bk-start">First day</label>
                <input id="bk-start" name="startDate" type="date" required />
              </div>
              <div className="field">
                <label htmlFor="bk-end">Last day</label>
                <input id="bk-end" name="endDate" type="date" required />
              </div>
            </div>
            <button className="btn" type="submit">Set backup</button>
          </form>
          {bk.backups.length > 0 && (
            <>
              <h3>Current and future backups</h3>
              <ul className="tight">
                {bk.backups.map((b) => (
                  <li key={b.id}>
                    <form action={removeBackupAction} className="row">
                      <input type="hidden" name="id" value={b.id} />
                      <span className="small">{b.approverName} is covered by {b.backupName}, {b.startDate === b.endDate ? b.startDate : `${b.startDate} to ${b.endDate}`}</span>
                      {(b.approverId === user.personId || user.role === "admin") && <button className="btn ghost small" type="submit">Remove</button>}
                    </form>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
