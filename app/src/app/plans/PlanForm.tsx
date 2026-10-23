"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { savePlanAction, type PlanFormState } from "./actions";
import { CATEGORY_LABELS, MONTHS, formatTiers } from "@/lib/planText";
import type { PlanInput } from "@/lib/plans";

type Row = { key: number; id: string; name: string; amount: string; tiers: string };

const bs = (b: boolean) => (b ? "true" : "false");

export function PlanForm({ plan, planId }: { plan: PlanInput; planId?: string }) {
  const [state, action, pending] = useActionState(savePlanAction, {} as PlanFormState);
  const v = (k: string, fallback: string | number | boolean | null) => {
    const x = state.values?.[k];
    if (typeof x === "string") return x;
    return fallback === null || fallback === undefined ? "" : String(fallback);
  };
  const checked = (k: string, fallback: boolean) => v(k, bs(fallback)) === "true";
  const err = (k: string) => state.errors?.[k];

  const [rows, setRows] = useState<Row[]>(() => {
    const rs: Row[] = plan.levels.map((l, i) => ({ key: i, id: l.id ?? "", name: l.name, amount: String(l.annualAmount), tiers: formatTiers(l.tenureTiers) }));
    // One empty row, so the form works without JavaScript too.
    rs.push({ key: rs.length, id: "", name: "", amount: "", tiers: "" });
    return rs;
  });
  const [nextKey, setNextKey] = useState(100);
  const edit = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const unit = v("unit", plan.unit);

    const field = (name: string, label: string, input: React.ReactNode, hint?: string) => (
      <div className="field">
        <label htmlFor={`f-${name}`}>{label}</label>
        {input}
        {hint && !err(name) && <span className="muted small">{hint}</span>}
        {err(name) && <span className="err" id={`f-${name}-err`}>{err(name)}</span>}
      </div>
    );
    const text = (name: string, fallback: string | number | null, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
      <input id={`f-${name}`} name={name} defaultValue={v(name, fallback)} aria-invalid={err(name) ? "true" : undefined}
        aria-describedby={err(name) ? `f-${name}-err` : undefined} {...props} />
    );
    const select = (name: string, fallback: string | null, options: [string, string][], blankLabel?: string) => (
      <select id={`f-${name}`} name={name} defaultValue={v(name, fallback)} aria-invalid={err(name) ? "true" : undefined}>
        {blankLabel !== undefined && <option value="">{blankLabel}</option>}
        {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    );
    const check = (name: string, label: string, fallback: boolean, hint?: string) => (
      <div className="field">
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 500, color: "var(--ink)" }}>
          <input type="checkbox" name={name} defaultChecked={checked(name, fallback)} style={{ width: "auto" }} />{label}
        </label>
        {hint && <span className="muted small">{hint}</span>}
      </div>
    );
    const monthOptions: [string, string][] = MONTHS.map((m, i) => [String(i + 1), m]);

    return (
      <form action={action} className="card" key={JSON.stringify(state.values ?? {})}>
        {planId && <input type="hidden" name="id" value={planId} />}
        {err("form") && <p className="notice warn" role="alert">{err("form")}</p>}
        {Object.keys(state.errors ?? {}).length > 0 && <p className="notice warn" role="alert">Some settings need a change. See the messages below.</p>}

        <fieldset>
          <legend>Basics</legend>
          <div className="grid">
            {field("name", "Plan name", text("name", plan.name, { required: true, maxLength: 80 }))}
            {field("category", "Category", select("category", plan.category, Object.entries(CATEGORY_LABELS), "Choose…"))}
            {field("unit", "Counted in", select("unit", plan.unit, [["days", "Days"], ["hours", "Hours"]]))}
          </div>
          {check("active", "Plan is active", plan.active, "Inactive plans can't be given to more people. Existing assignments stay.")}
        </fieldset>

        <fieldset>
          <legend>How time is earned</legend>
          <div className="grid">
            {field("accrualMethod", "Method", select("accrualMethod", plan.accrualMethod, [
              ["lump_sum", "Given in full (lump sum)"], ["periodic", "Earned over time"], ["hours_worked", "Earned by hours worked"], ["none", "Not tracked (no balance)"],
            ], "Choose…"))}
            {field("lumpSumTiming", "When it is given", select("lumpSumTiming", plan.lumpSumTiming, [
              ["plan_year_start", "Start of plan year"], ["hire_date", "Start date"], ["anniversary", "Work anniversary"],
            ], "Choose…"), "Used for lump sum plans.")}
            {field("frequency", "How often", select("frequency", plan.frequency, [
              ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["semi_annual", "Twice a year"], ["annual", "Once a year"],
            ], "Choose…"), "Used for plans earned over time.")}
            {field("creditTiming", "Credited at", select("creditTiming", plan.creditTiming, [["start", "Start of each period"], ["end", "End of each period"]]), "Used for plans earned over time.")}
            {field("hoursWorkedRatio", "Hours worked for 1 hour off", text("hoursWorkedRatio", plan.hoursWorkedRatio, { type: "number", step: "0.01", min: "0" }), "Used for hours worked plans. These plans count in hours.")}
            {field("rounding", "Rounding", select("rounding", plan.rounding, [["nearest", "To the nearest"], ["up", "Up"], ["down", "Down"]]))}
          </div>
          {check("tenureEnabled", "Give more time for years of service", plan.tenureEnabled, "Add tiers to each level, like 5:20 for 20 a year after 5 years.")}
        </fieldset>

        <fieldset>
          <legend>Plan year and first year</legend>
          <div className="grid">
            {field("planYearStartMonth", "Plan year starts in", select("planYearStartMonth", String(plan.planYearStartMonth), monthOptions))}
            {field("planYearStartDay", "Day of month", text("planYearStartDay", plan.planYearStartDay, { type: "number", min: "1", max: "28" }), "1 to 28.")}
          </div>
          {check("firstYearProration", "Prorate in the first year", plan.firstYearProration, "New hires get a share based on when they start.")}
        </fieldset>

        <fieldset>
          <legend>Year end</legend>
          <div className="grid">
            {field("carryover", "Unused time at year end", select("carryover", plan.carryover, [
              ["none", "Lost"], ["capped", "Carries over up to a limit"], ["unlimited", "All carries over"], ["max_balance", "Carries over up to the maximum balance"],
            ]))}
            {field("carryoverCap", `Most that carries over (${unit})`, text("carryoverCap", plan.carryoverCap, { type: "number", step: "0.01", min: "0" }), "Needed when the rule is a limit.")}
            {field("carryoverExpiryMonth", "Carried time expires in", select("carryoverExpiryMonth", plan.carryoverExpiryMonth === null ? null : String(plan.carryoverExpiryMonth), monthOptions, "Never"))}
            {field("carryoverExpiryDay", "Expiry day", text("carryoverExpiryDay", plan.carryoverExpiryDay, { type: "number", min: "1", max: "31" }), "Leave empty if it never expires.")}
            {field("maxBalance", `Maximum balance (${unit})`, text("maxBalance", plan.maxBalance, { type: "number", step: "0.01", min: "0" }), "Needed for the maximum balance rule. Otherwise optional.")}
          </div>
          {check("payoutUnused", "Pay out unused time", plan.payoutUnused)}
        </fieldset>

        <fieldset>
          <legend>Approvals</legend>
          <div className="grid">
            {field("approvalMode", "Who approves", select("approvalMode", plan.approvalMode, [["auto", "Nobody (automatic)"], ["manager", "Manager"], ["admin", "HR admin"]]))}
            {field("negativeLimit", `Can go below zero by (${unit})`, text("negativeLimit", plan.negativeLimit, { type: "number", step: "0.01", min: "0" }))}
            {field("waitingPeriodDays", "Waiting period (days)", text("waitingPeriodDays", plan.waitingPeriodDays, { type: "number", min: "0", max: "730" }), "Days after the start date before time can be booked.")}
          </div>
          {check("secondApproval", "Long requests need a second approver", plan.secondApproval, "The length is set in Settings.")}
        </fieldset>

        <fieldset>
          <legend>Privacy and calendars</legend>
          <div className="grid">
            {field("visibility", "Coworkers see", select("visibility", plan.visibility, [["name", "Name and plan"], ["out_of_office", "Out of office only"], ["hidden", "Nothing"]]))}
            {field("calendarStatus", "Calendar shows as", select("calendarStatus", plan.calendarStatus, [["out_of_office", "Out of office"], ["busy", "Busy"], ["free", "Free"]]))}
            {field("counts", "Counts", select("counts", plan.counts, [["working_days", "Working days"], ["calendar_days", "Calendar days"]]))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Levels</legend>
          <p className="muted small">A level is an amount per year, like Standard 15 or Senior 20. Plans that are not tracked need one level with 0.</p>
          {err("levels") && <p className="err" role="alert">{err("levels")}</p>}
          {rows.map((r, i) => {
            const e = (f: string) => state.errors?.[`levels.${i}.${f}`];
            return (
              <div className="grid" key={r.key} style={{ alignItems: "end", marginBottom: 8 }}>
                <input type="hidden" name="levelId" value={r.id} />
                <div className="field">
                  <label htmlFor={`l-name-${r.key}`}>Level name</label>
                  <input id={`l-name-${r.key}`} name="levelName" value={r.name} maxLength={60} onChange={(ev) => edit(r.key, { name: ev.target.value })} aria-invalid={e("name") ? "true" : undefined} />
                  {e("name") && <span className="err">{e("name")}</span>}
                </div>
                <div className="field">
                  <label htmlFor={`l-amt-${r.key}`}>{unit === "hours" ? "Hours" : "Days"} per year</label>
                  <input id={`l-amt-${r.key}`} name="levelAmount" type="number" step="0.01" min="0" max="2000" value={r.amount} onChange={(ev) => edit(r.key, { amount: ev.target.value })} aria-invalid={e("annualAmount") ? "true" : undefined} />
                  {e("annualAmount") && <span className="err">{e("annualAmount")}</span>}
                </div>
                <div className="field">
                  <label htmlFor={`l-tiers-${r.key}`}>Years of service (optional)</label>
                  <input id={`l-tiers-${r.key}`} name="levelTiers" value={r.tiers} placeholder="5:20, 10:25" onChange={(ev) => edit(r.key, { tiers: ev.target.value })} aria-invalid={e("tenureTiers") ? "true" : undefined} />
                  {e("tenureTiers") ? <span className="err">{e("tenureTiers")}</span> : <span className="muted small">years:amount, years:amount</span>}
                </div>
                <div><button type="button" className="btn secondary" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Remove</button></div>
              </div>
            );
          })}
          <div><button type="button" className="btn secondary" onClick={() => { setRows((rs) => [...rs, { key: nextKey, id: "", name: "", amount: "", tiers: "" }]); setNextKey(nextKey + 1); }}>Add level</button></div>
        </fieldset>

        <div className="row">
          <button className="btn" type="submit" disabled={pending}>{pending ? "Saving..." : planId ? "Save changes" : "Add plan"}</button>
          <Link className="btn secondary" href="/plans">Cancel</Link>
        </div>
      </form>
    );
}
