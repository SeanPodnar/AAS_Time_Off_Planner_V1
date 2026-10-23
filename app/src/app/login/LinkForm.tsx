"use client";

import { useActionState } from "react";
import { requestLink, type LinkState } from "./actions";

export function LinkForm() {
  const [state, action, pending] = useActionState(requestLink, {} as LinkState);
  if (state.status === "sent") {
    return (
      <div className="card" role="status">
        <h2>Check your email</h2>
        <p>If <strong>{state.email}</strong> belongs to someone here, a sign-in link is on its way. It works once and expires in 15 minutes.</p>
      </div>
    );
  }
  return (
    <form action={action} className="card">
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email ?? ""}
          aria-invalid={state.status === "invalid_email" ? "true" : undefined} />
        {state.status === "invalid_email" && <span className="err">Enter a full email address, like name@company.com.</span>}
        {state.status === "rate_limited" && <span className="err">Too many links requested. Wait 15 minutes, then try again.</span>}
      </div>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Sending…" : "Email me a sign-in link"}</button>
      <p className="muted small">Google and Microsoft 365 sign-in are coming next.</p>
    </form>
  );
}
