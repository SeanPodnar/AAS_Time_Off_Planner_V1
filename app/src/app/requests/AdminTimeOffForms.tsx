"use client";

import { useActionState } from "react";
import { addTimeOffAction, adjustBalanceAction, type AdminFormState } from "./actions";
import { RequestFields, type PlanOption } from "./RequestFields";

/** HR books time off for someone. */
export function AddTimeOffForm({ personId, plans }: { personId: string; plans: PlanOption[] }) {
  const [state, action, pending] = useActionState(addTimeOffAction, {} as AdminFormState);
  const errors = state.errors ?? {};
  const v = state.values ?? {};
  if (plans.length === 0) return <p className="muted">No plans to book from.</p>;
  return (
    <form action={action} className="stack" key={JSON.stringify(state.values ?? {})}>
      <h3>Add time off</h3>
      <input type="hidden" name="personId" value={personId} />
      {errors.form && <p className="notice warn" role="alert">{errors.form}</p>}
      <RequestFields prefix="add" plans={plans} values={v} errors={errors} />
      <div className="field">
        <label htmlFor="add-reason">Reason</label>
        <input id="add-reason" name="reason" defaultValue={v.reason ?? ""} required maxLength={500} aria-invalid={errors.reason ? true : undefined} />
        {errors.reason && <span className="err">{errors.reason}</span>}
      </div>
      <div className="days">
        <label><input type="checkbox" name="approveNow" defaultChecked={!!v.approveNow} />Approve now</label>
        <label><input type="checkbox" name="allowNegative" defaultChecked={!!v.allowNegative} />Allow below the negative limit</label>
      </div>
      {errors.approveNow && <span className="err">{errors.approveNow}</span>}
      <button className="btn" type="submit" disabled={pending}>Add time off</button>
    </form>
  );
}

/** HR credits or debits a balance. */
export function AdjustBalanceForm({ personId, plans, today }: { personId: string; plans: PlanOption[]; today: string }) {
  const [state, action, pending] = useActionState(adjustBalanceAction, {} as AdminFormState);
  const errors = state.errors ?? {};
  const v = state.values ?? {};
  if (plans.length === 0) return null;
  const bad = (n: string) => (errors[n] ? { "aria-invalid": true as const } : {});
  return (
    <form action={action} className="stack" key={JSON.stringify(state.values ?? {})}>
      <h3>Adjust balance</h3>
      <p className="muted small">A positive amount adds time. A negative amount removes it.</p>
      <input type="hidden" name="personId" value={personId} />
      {errors.form && <p className="notice warn" role="alert">{errors.form}</p>}
      <div className="grid">
        <div className="field">
          <label htmlFor="adj-plan">Plan</label>
          <select id="adj-plan" name="planId" defaultValue={v.planId ?? plans[0].id} {...bad("planId")}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          {errors.planId && <span className="err">{errors.planId}</span>}
        </div>
        <div className="field">
          <label htmlFor="adj-amount">Amount</label>
          <input id="adj-amount" name="amount" type="number" step="0.01" defaultValue={v.amount ?? ""} required {...bad("amount")} />
          {errors.amount && <span className="err">{errors.amount}</span>}
        </div>
        <div className="field">
          <label htmlFor="adj-date">Applies from</label>
          <input id="adj-date" name="effectiveDate" type="date" defaultValue={v.effectiveDate ?? today} required {...bad("effectiveDate")} />
          {errors.effectiveDate && <span className="err">{errors.effectiveDate}</span>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="adj-reason">Reason</label>
        <input id="adj-reason" name="reason" defaultValue={v.reason ?? ""} required maxLength={500} {...bad("reason")} />
        {errors.reason && <span className="err">{errors.reason}</span>}
      </div>
      <button className="btn" type="submit" disabled={pending}>Adjust balance</button>
    </form>
  );
}
