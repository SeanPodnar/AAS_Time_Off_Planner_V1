"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmAction, uploadAction, type ImportState } from "./actions";

const LABEL = { create: "New", update: "Update", unchanged: "No change", error: "Problem" } as const;

export function ImportFlow() {
  const [up, upload, uploading] = useActionState(uploadAction, {} as ImportState);
  const [done, confirm, confirming] = useActionState(confirmAction, {} as ImportState);
  const state = done.done || done.error ? done : up;

  if (state.done) {
    const d = state.done;
    return (
      <div className="card" role="status">
        <h2>Import complete</h2>
        <p>{d.create} added, {d.update} updated, {d.unchanged} unchanged from {state.filename}.</p>
        <div className="row"><Link className="btn" href="/people">Back to People</Link><button className="btn secondary" type="button" onClick={() => window.location.assign("/people/import")}>Import another file</button></div>
      </div>
    );
  }

  const preview = state.preview;
  const blocked = (preview?.counts.error ?? 0) > 0;
  return (
    <>
      <form action={upload} className="card">
        <div className="field">
          <label htmlFor="file">File (.csv or .xlsx, up to 2 MB and 1,000 people)</label>
          <input id="file" name="file" type="file" accept=".csv,.xlsx" required />
          <span className="muted small">People are matched by email. New emails are added; existing people are updated, but only for the columns in your file. A blank cell in a column clears that value.</span>
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={uploading}>{uploading ? "Checking…" : "Check file"}</button>
          {/* A file download, not a page, so a plain link. */}
          <a className="btn secondary" href="/people/import/template" download>Download template (.csv)</a>
        </div>
      </form>
      {state.error && <p className="notice warn" role="alert">{state.error}</p>}
      {preview && (
        <section className="card">
          <div className="pagehead">
            <div>
              <h2>Preview: {state.filename ?? up.filename}</h2>
              <p className="muted">{preview.counts.create} new · {preview.counts.update} updates · {preview.counts.unchanged} no change · {preview.counts.error} with problems</p>
            </div>
            {!blocked && state.batchId && (
              <form action={confirm}>
                <input type="hidden" name="batchId" value={state.batchId} />
                <input type="hidden" name="filename" value={state.filename ?? ""} />
                <button className="btn" type="submit" disabled={confirming}>{confirming ? "Importing…" : `Import ${preview.counts.create + preview.counts.update} changes`}</button>
              </form>
            )}
          </div>
          {blocked && <p className="notice warn">Nothing has been saved. Fix the rows marked Problem in your file and check it again.</p>}
          {preview.unknownColumns.length > 0 && <p className="muted small">Ignored columns: {preview.unknownColumns.join(", ")}</p>}
          <div className="tablewrap">
            <table>
              <thead><tr><th>Line</th><th>Person</th><th>Result</th><th>Details</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.fullName || <span className="muted">(no name)</span>}<div className="muted small">{r.email || "(no email)"}</div></td>
                    <td><span className={`pill ${r.action === "error" ? "bad" : r.action === "unchanged" ? "" : "ok"}`}>{LABEL[r.action]}</span></td>
                    <td style={{ whiteSpace: "normal", minWidth: 280 }}>
                      {r.errors.length > 0 && <ul className="tight err">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
                      {r.changes.length > 0 && <ul className="tight">{r.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
