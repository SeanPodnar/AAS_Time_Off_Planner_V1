"use client";

import { useActionState } from "react";
import { saveSettingsAction, type FormState } from "../people/actions";

export function SettingsForm({ timeZone, threshold, reminderAfterDays, escalateAfterDays, zones }: { timeZone: string; threshold: number; reminderAfterDays: number; escalateAfterDays: number; zones: string[] }) {
  const [state, action, pending] = useActionState(saveSettingsAction, {} as FormState);
  const v = (k: string, d: string) => (typeof state.values?.[k] === "string" ? (state.values[k] as string) : d);
  return (
    <form action={action} className="card">
      {state.saved && <p className="notice ok" role="status">Settings saved.</p>}
      <div className="grid">
        <div className="field">
          <label htmlFor="timeZone">Company time zone</label>
          <select id="timeZone" name="timeZone" defaultValue={v("timeZone", timeZone)}>{zones.map((z) => <option key={z}>{z}</option>)}</select>
          {state.errors?.timeZone ? <span className="err">{state.errors.timeZone}</span> : <span className="muted small">Sets &quot;today&quot;, approval deadlines and when year end runs.</span>}
        </div>
        <div className="field">
          <label htmlFor="secondApprovalThreshold">Second approval after this many working days in a row</label>
          <input id="secondApprovalThreshold" name="secondApprovalThreshold" type="number" min={1} max={60} defaultValue={v("secondApprovalThreshold", String(threshold))} />
          {state.errors?.secondApprovalThreshold ? <span className="err">{state.errors.secondApprovalThreshold}</span> : <span className="muted small">Longer absences also need the manager&apos;s manager. Each plan can turn this off.</span>}
        </div>
        <div className="field">
          <label htmlFor="reminderAfterDays">Remind the approver after (business days)</label>
          <input id="reminderAfterDays" name="reminderAfterDays" type="number" min={1} max={30} defaultValue={v("reminderAfterDays", String(reminderAfterDays))} aria-invalid={state.errors?.reminderAfterDays ? true : undefined} />
          {state.errors?.reminderAfterDays ? <span className="err">{state.errors.reminderAfterDays}</span> : <span className="muted small">Business days are Monday to Friday.</span>}
        </div>
        <div className="field">
          <label htmlFor="escalateAfterDays">Tell HR after (business days)</label>
          <input id="escalateAfterDays" name="escalateAfterDays" type="number" min={1} max={60} defaultValue={v("escalateAfterDays", String(escalateAfterDays))} aria-invalid={state.errors?.escalateAfterDays ? true : undefined} />
          {state.errors?.escalateAfterDays ? <span className="err">{state.errors.escalateAfterDays}</span> : <span className="muted small">Business days are Monday to Friday.</span>}
        </div>
      </div>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
    </form>
  );
}
