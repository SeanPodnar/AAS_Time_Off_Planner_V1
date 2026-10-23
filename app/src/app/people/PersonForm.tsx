"use client";

import { useActionState } from "react";
import { savePersonAction, type FormState } from "./actions";
import { JURISDICTIONS, WEEKDAYS } from "@/lib/jurisdictions";
import type { PersonRow } from "@/lib/people";

type Option = { id: string; name: string };

export function PersonForm({ person, managers, teams, locations }: { person?: PersonRow; managers: Option[]; teams: string[]; locations: string[] }) {
  const [state, action, pending] = useActionState(savePersonAction, {} as FormState);
  const v = (k: string, fallback: string) => {
    const x = state.values?.[k];
    return typeof x === "string" ? x : fallback;
  };
  const err = (k: string) => state.errors?.[k];
  const days = (state.values?.workDays as string[] | undefined)?.map(Number) ?? person?.workDays ?? [1, 2, 3, 4, 5];
  const secondary = (state.values?.secondaryManagerIds as string[] | undefined) ?? person?.secondaryManagerIds ?? [];
  const others = managers.filter((m) => m.id !== person?.id);

  const field = (name: string, label: string, input: React.ReactNode, hint?: string) => (
    <div className="field">
      <label htmlFor={`f-${name}`}>{label}</label>
      {input}
      {hint && !err(name) && <span className="muted small">{hint}</span>}
      {err(name) && <span className="err" id={`f-${name}-err`}>{err(name)}</span>}
    </div>
  );
  const text = (name: string, fallback: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`f-${name}`} name={name} defaultValue={v(name, fallback)} aria-invalid={err(name) ? "true" : undefined}
      aria-describedby={err(name) ? `f-${name}-err` : undefined} {...props} />
  );

  return (
    <form action={action} className="card" key={JSON.stringify(state.values ?? {})}>
      {person && <input type="hidden" name="id" value={person.id} />}
      {err("form") && <p className="notice warn" role="alert">{err("form")}</p>}
      <div className="grid">
        {field("fullName", "Full name", text("fullName", person?.fullName ?? "", { required: true, maxLength: 200, autoComplete: "off" }))}
        {field("email", "Work email", text("email", person?.email ?? "", { required: true, type: "email", autoComplete: "off" }), "Used for sign-in and notifications.")}
        {field("jobTitle", "Job title", text("jobTitle", person?.jobTitle ?? "", { maxLength: 120 }))}
        {field("employeeNumber", "Employee number", text("employeeNumber", person?.employeeNumber ?? "", { maxLength: 40 }), "As in WorkLinks payroll.")}
        {field("hireDate", "Start date", text("hireDate", person?.hireDate ?? "", { type: "date", required: true }), "Used for proration and years of service.")}
        {field("jurisdiction", "Province or state", (
          <select id="f-jurisdiction" name="jurisdiction" defaultValue={v("jurisdiction", person?.jurisdiction ?? "")} required aria-invalid={err("jurisdiction") ? "true" : undefined}>
            <option value="">Choose…</option>
            <optgroup label="Canada">{JURISDICTIONS.filter((j) => j.country === "CA").map((j) => <option key={j.code} value={j.code}>{j.name}</option>)}</optgroup>
            <optgroup label="United States">{JURISDICTIONS.filter((j) => j.country === "US").map((j) => <option key={j.code} value={j.code}>{j.name}</option>)}</optgroup>
          </select>
        ), "Whose employment law applies: statutory minimums, holidays, carryover.")}
        {field("teamName", "Team", <>{text("teamName", person?.team ?? "", { list: "teams", maxLength: 80 })}<datalist id="teams">{teams.map((t) => <option key={t} value={t} />)}</datalist></>, "Pick one or type a new team.")}
        {field("locationName", "Location", <>{text("locationName", person?.location ?? "", { list: "locations", maxLength: 80 })}<datalist id="locations">{locations.map((t) => <option key={t} value={t} />)}</datalist></>)}
        {field("managerId", "Manager (approves time off)", (
          <select id="f-managerId" name="managerId" defaultValue={v("managerId", person?.managerId ?? "")} aria-invalid={err("managerId") ? "true" : undefined}>
            <option value="">No manager</option>
            {others.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        ), "Without a manager, requests go to HR.")}
        {field("role", "Role", (
          <select id="f-role" name="role" defaultValue={v("role", person?.role ?? "employee")} aria-invalid={err("role") ? "true" : undefined}>
            <option value="employee">Employee</option>
            <option value="admin">HR admin</option>
          </select>
        ), "Anyone with reports is a manager automatically. HR admins must set up two-step sign-in.")}
        {field("hoursPerDay", "Hours per working day", text("hoursPerDay", String(person?.hoursPerDay ?? 8), { type: "number", step: "0.25", min: "0.25", max: "24", required: true }))}
      </div>
      <fieldset>
        <legend>Work days</legend>
        <div className="days">
          {WEEKDAYS.map((d) => (
            <label key={d.n}><input type="checkbox" name="workDays" value={d.n} defaultChecked={days.includes(d.n)} />{d.short}</label>
          ))}
        </div>
        {err("workDays") ? <span className="err">{err("workDays")}</span> : <span className="muted small">Part-time staff: tick only the days they work. Time off is only counted on these days.</span>}
      </fieldset>
      {others.length > 0 && (
        <fieldset>
          <legend>Other managers (see time off and get notified; don&apos;t approve)</legend>
          <div className="days">
            {others.map((m) => (
              <label key={m.id}><input type="checkbox" name="secondaryManagerIds" value={m.id} defaultChecked={secondary.includes(m.id)} />{m.name}</label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="row">
        <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : person ? "Save changes" : "Add person"}</button>
        <a className="btn secondary" href={person ? `/people/${person.id}` : "/people"}>Cancel</a>
      </div>
    </form>
  );
}
