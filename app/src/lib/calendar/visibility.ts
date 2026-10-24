// Who sees what about someone else's time off (FR-60, FR-61). Pure rules, no database access,
// so every combination is tested directly.
//
//   self      their own time off: plan names, pending and approved
//   hr        HR admins: everyone's plan names, pending and approved
//   manager   primary manager (any level up the chain) or secondary manager: plan names, pending and approved
//   coworker  everyone else: approved only, and only what the plan allows
//             (plan name, "Out of office", or nothing at all for hidden plans)
//
// Calendar feeds can be forwarded or shared, so they never show more than a coworker sees,
// except a person's own feed, which shows their own plan names unless the plan is private.

export type Relation = "self" | "hr" | "manager" | "coworker";
export type Visibility = "name" | "out_of_office" | "hidden";
export type Status = "pending" | "approved";

export const OUT_OF_OFFICE = "Out of office";

/** The label a viewer sees for one booking, or null if they must not see it at all. */
export function labelFor(rel: Relation, planName: string, visibility: Visibility, status: Status): string | null {
  if (rel === "self" || rel === "hr" || rel === "manager") return planName;
  if (status !== "approved") return null;
  if (visibility === "name") return planName;
  if (visibility === "out_of_office") return OUT_OF_OFFICE;
  return null;
}

/** The label in a calendar feed. `own` is true for a person's own "me" feed. */
export function feedLabelFor(own: boolean, planName: string, visibility: Visibility, status: Status): string | null {
  if (own) return visibility === "name" ? planName : OUT_OF_OFFICE;
  return labelFor("coworker", planName, visibility, status);
}

/** Whether a viewer may filter by this plan without learning anything they can't see. */
export function canFilterByPlan(rel: Relation, visibility: Visibility) {
  return rel !== "coworker" || visibility === "name";
}
