import Link from "next/link";
import type { RequestRow } from "@/lib/requests/service";
import { cancelRequestAction } from "./actions";
import { STATUS_LABELS, STEP_STATUS_LABELS, dateRange } from "./format";

/** A table of requests with approval progress and Edit / Withdraw / Cancel actions. */
export function RequestsTable({ rows, viewerId, returnTo, showEdit = true, empty = "No requests yet." }: {
  rows: RequestRow[]; viewerId: string; returnTo: string; showEdit?: boolean; empty?: string;
}) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>Plan</th><th>Dates</th><th>Days</th><th>Status</th><th>Approval</th><th>Actions</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const [label, cls] = STATUS_LABELS[r.status] ?? [r.status, "pill"];
            const others = r.personId !== viewerId;
            return (
              <tr key={r.id}>
                <td>
                  {r.planName}
                  {r.kind !== "new" && <div className="small muted">{r.kind === "change" ? "Change" : "Cancellation"}</div>}
                  {r.openFollowUp && <div className="small muted">{r.openFollowUp === "change" ? "A change is waiting" : "A cancellation is waiting"}</div>}
                </td>
                <td>{dateRange(r)}</td>
                <td>{r.days}</td>
                <td><span className={cls}>{label}</span></td>
                <td className="wrapcell">
                  {r.steps.length === 0 ? <span className="muted small">None needed</span> : (
                    <ul className="tight small">
                      {r.steps.map((s) => <li key={s.stepNo}>{s.approverName}: {STEP_STATUS_LABELS[s.status] ?? s.status}</li>)}
                    </ul>
                  )}
                </td>
                <td>
                  <div className="row">
                    {showEdit && r.canAmend && <Link className="btn secondary small" href={`/requests/${r.id}/edit`}>Edit</Link>}
                    {r.canCancel && (
                      <form action={cancelRequestAction} className="row">
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        {others && <input name="reason" placeholder="Reason" aria-label="Reason" required style={{ width: 140 }} />}
                        <button className="btn ghost small" type="submit">{r.status === "pending" ? "Withdraw" : "Cancel"}</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
