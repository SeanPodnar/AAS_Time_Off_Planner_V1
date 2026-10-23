import type { ReactNode } from "react";

export type PlanOption = { id: string; name: string };

/** The plan, date and half day fields shared by the request form and HR's "Add time off" form. */
export function RequestFields({ prefix, plans, values, errors, fixedPlan }: {
  prefix: string; plans: PlanOption[]; values: Record<string, string>; errors: Record<string, string>; fixedPlan?: PlanOption;
}) {
  const id = (n: string) => `${prefix}-${n}`;
  const field = (name: string, label: string, input: ReactNode, hint?: string) => (
    <div className="field">
      <label htmlFor={id(name)}>{label}</label>
      {input}
      {hint && !errors[name] && <span className="muted small">{hint}</span>}
      {errors[name] && <span className="err" id={`${id(name)}-err`}>{errors[name]}</span>}
    </div>
  );
  const bad = (n: string) => (errors[n] ? { "aria-invalid": true as const, "aria-describedby": `${id(n)}-err` } : {});
  const v = (n: string, d = "") => values[n] ?? d;
  return (
    <>
      <div className="grid">
        {fixedPlan ? (
          <div className="field">
            <label>Plan</label>
            <p>{fixedPlan.name}</p>
            <input type="hidden" name="planId" value={fixedPlan.id} />
            <span className="muted small">A change keeps the same plan.</span>
            {errors.planId && <span className="err">{errors.planId}</span>}
          </div>
        ) : field("planId", "Plan", (
          <select id={id("planId")} name="planId" defaultValue={v("planId", plans[0]?.id ?? "")} required {...bad("planId")}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ))}
        {field("startDate", "First day", <input id={id("startDate")} name="startDate" type="date" defaultValue={v("startDate")} required {...bad("startDate")} />)}
        {field("endDate", "Last day", <input id={id("endDate")} name="endDate" type="date" defaultValue={v("endDate")} {...bad("endDate")} />, "Leave empty for a single day.")}
      </div>
      <fieldset>
        <legend>Part days</legend>
        <div className="grid">
          {field("singlePart", "For a single day", (
            <select id={id("singlePart")} name="singlePart" defaultValue={v("singlePart", "full")}>
              <option value="full">Full day</option><option value="am">Morning only</option><option value="pm">Afternoon only</option>
            </select>
          ), "Used when the first and last day are the same.")}
          {field("startPart", "Half day on the first day", (
            <select id={id("startPart")} name="startPart" defaultValue={v("startPart", "full")} {...bad("startPart")}>
              <option value="full">None</option><option value="pm">Afternoon only</option>
            </select>
          ), "Used for longer time off.")}
          {field("endPart", "Half day on the last day", (
            <select id={id("endPart")} name="endPart" defaultValue={v("endPart", "full")} {...bad("endPart")}>
              <option value="full">None</option><option value="am">Morning only</option>
            </select>
          ), "Used for longer time off.")}
        </div>
      </fieldset>
      {field("comment", "Comment (optional)", <textarea id={id("comment")} name="comment" rows={2} maxLength={1000} defaultValue={v("comment")} {...bad("comment")} />)}
    </>
  );
}
