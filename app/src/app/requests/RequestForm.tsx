"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestFormAction, type RequestFormState } from "./actions";
import { RequestFields, type PlanOption } from "./RequestFields";
import { amountText } from "./format";
import type { Summary } from "@/lib/requests/service";

function SummaryCard({ s }: { s: Summary }) {
  const auto = s.approvers.length === 1 && s.approvers[0] === "Approved automatically";
  return (
    <section className="card" aria-live="polite">
      <h2>Summary</h2>
      <p>Days counted: <strong>{s.days}</strong></p>
      <p>Amount: <strong>{amountText(s.amount, s.unit)}</strong></p>
      {s.tracked && s.availableBefore !== null && s.availableAfter !== null && (
        <p>Available before: {amountText(s.availableBefore, s.unit)}. Available after: <strong>{amountText(s.availableAfter, s.unit)}</strong>.</p>
      )}
      <p>{auto ? "This is approved automatically." : <>Approvers: {s.approvers.join(", then ")}</>}</p>
      {s.secondApproval && <p className="notice warn">This needs a second approval because it joins up to {s.run} working days off.</p>}
      {s.teamOff.length > 0 && (
        <div>
          <p>Teammates off at the same time:</p>
          <ul className="tight">
            {s.teamOff.map((t) => <li key={`${t.name}-${t.from}`}>{t.name}{t.label ? ` (${t.label})` : ""}, {t.from === t.to ? t.from : `${t.from} to ${t.to}`}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

/** New request and edit form. Check and the main button are both submit buttons, so it works without JavaScript. */
export function RequestForm({ plans, initial, requestId, fixedPlan, approvedNote }: {
  plans: PlanOption[]; initial: Record<string, string>; requestId?: string; fixedPlan?: PlanOption; approvedNote?: boolean;
}) {
  const [state, action, pending] = useActionState(requestFormAction, {} as RequestFormState);
  const errors = state.errors ?? {};
  const fieldErrors = Object.keys(errors).filter((k) => k !== "form");
  return (
    <form action={action} className="card" key={JSON.stringify(state.values ?? {})}>
      {requestId && <input type="hidden" name="id" value={requestId} />}
      {approvedNote && <p className="notice ok">Your current dates stay booked until the change is approved.</p>}
      {errors.form && <p className="notice warn" role="alert">{errors.form}</p>}
      {fieldErrors.length > 0 && !errors.form && <p className="notice warn" role="alert">Please fix the messages below.</p>}
      <RequestFields prefix="rq" plans={plans} values={state.values ?? initial} errors={errors} fixedPlan={fixedPlan} />
      {state.summary && <SummaryCard s={state.summary} />}
      <div className="row">
        <button className="btn secondary" type="submit" name="intent" value="check" disabled={pending}>Check</button>
        <button className="btn" type="submit" name="intent" value="send" disabled={pending}>{requestId ? "Save changes" : "Send request"}</button>
        <Link className="btn ghost" href="/">Back</Link>
      </div>
    </form>
  );
}
