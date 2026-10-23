"use client";

import { useActionState, useEffect } from "react";
import { checkCode, confirmSetup, type MfaState } from "./actions";

function CodeField({ label, error }: { label: string; error?: string }) {
  return (
    <div className="field">
      <label htmlFor="code">{label}</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={20}
        aria-invalid={error ? "true" : undefined} aria-describedby={error ? "code-err" : undefined} />
      {error && <span className="err" id="code-err">{error}</span>}
    </div>
  );
}

export function SetupForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(confirmSetup, {} as MfaState);
  if (state.recoveryCodes) {
    return (
      <div className="card">
        <h2>Save your recovery codes</h2>
        <p>Each code works once if you lose your phone. Store them somewhere safe, like a password manager. They won&apos;t be shown again.</p>
        <ol className="codes">{state.recoveryCodes.map((c) => <li key={c}><code>{c}</code></li>)}</ol>
        <a className="btn" href={next}>I&apos;ve saved them, continue</a>
      </div>
    );
  }
  return (
    <form action={action} className="card">
      <CodeField label="Enter the 6-digit code your app shows" error={state.error} />
      <button className="btn" type="submit" disabled={pending}>{pending ? "Checking…" : "Turn on two-step sign-in"}</button>
    </form>
  );
}

export function VerifyForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(checkCode, {} as MfaState);
  useEffect(() => { if (state.done) window.location.assign(next); }, [state.done, next]);
  return (
    <form action={action} className="card">
      <CodeField label="6-digit code from your authenticator app, or a recovery code" error={state.error} />
      <button className="btn" type="submit" disabled={pending || state.done}>{pending ? "Checking…" : "Continue"}</button>
    </form>
  );
}
