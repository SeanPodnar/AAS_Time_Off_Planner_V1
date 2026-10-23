"use client";

import { useActionState } from "react";
import { createCompany, type FormState } from "./actions";

const initial: FormState = {};

function Field(props: { name: string; label: string; state: FormState; hint?: string; children?: React.ReactNode; defaultValue?: string; maxLength?: number }) {
  const err = props.state.errors?.[props.name];
  const id = `f-${props.name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.children ?? (
        <input id={id} name={props.name} defaultValue={props.state.values?.[props.name] ?? props.defaultValue ?? ""} maxLength={props.maxLength}
          aria-invalid={err ? "true" : undefined} aria-describedby={err ? `${id}-err` : undefined} />
      )}
      {props.hint && !err && <span className="muted small">{props.hint}</span>}
      {err && <span className="err" id={`${id}-err`}>{err}</span>}
    </div>
  );
}

export function CreateCompanyForm() {
  const [state, action, pending] = useActionState(createCompany, initial);
  return (
    <form action={action} className="card" key={state.ok ?? "form"}>
      <h2>Add a company</h2>
      {state.ok && <p className="notice ok" role="status">{state.ok}</p>}
      {state.errors?.form && <p className="notice warn" role="alert">{state.errors.form}</p>}
      <div className="grid">
        <Field name="legalName" label="Full legal name" state={state} maxLength={200} hint="Used on reports, exports and the audit log." />
        <Field name="shortLabel" label="Short label" state={state} maxLength={24} hint="Up to 24 characters. Used in the company selector and notifications." />
        <Field name="subdomain" label="Sign-in address" state={state} maxLength={32} hint="For example northwind, giving northwind.<platform domain>." />
        <Field name="customDomain" label="Custom domain (optional)" state={state} hint="For example timeoff.northwind.ca" />
        <Field name="brandColor" label="Brand colour" state={state} defaultValue="#2f7fd8" />
        <Field name="country" label="Country" state={state}>
          <select id="f-country" name="country" defaultValue={state.values?.country ?? "CA"}>
            <option value="CA">Canada</option>
            <option value="US">United States</option>
          </select>
        </Field>
      </div>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Adding…" : "Add company"}</button>
    </form>
  );
}
