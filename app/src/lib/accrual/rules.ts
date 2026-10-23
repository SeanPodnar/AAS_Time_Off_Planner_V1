// Statutory rules: minimum vacation by years of service, and whether earned vacation may be forfeited.
// Rules come from the jurisdiction_rules table (reference data, versioned by effective_from).
import { yearsBetween, type ISODate } from "./dates";

export type JurisdictionRule = {
  jurisdiction: string;
  category: "vacation" | "sick";
  ruleKind: "min_entitlement" | "no_forfeit" | "forfeit_conditional";
  minYears: number;
  amount: number | null;
  amountUnit: "weeks" | "days" | "hours" | null;
  effectiveFrom: ISODate;
  verified: boolean;
  source: string | null;
  notes: string | null;
};

const current = (rules: JurisdictionRule[], at: ISODate) => rules.filter((r) => r.effectiveFrom <= at);

/**
 * Statutory minimum vacation, in days per year, for someone in `jurisdiction` with `hireDate`,
 * as of `at`. Weeks convert to days using the person's work days per week (part-time staff get
 * proportionally fewer days). Returns null when the jurisdiction sets no minimum.
 */
export function statutoryMinimumDays(rules: JurisdictionRule[], jurisdiction: string, hireDate: ISODate, at: ISODate, workDaysPerWeek: number): { days: number; rule: JurisdictionRule } | null {
  const years = yearsBetween(hireDate, at);
  const tiers = current(rules, at)
    .filter((r) => r.jurisdiction === jurisdiction && r.category === "vacation" && r.ruleKind === "min_entitlement" && r.minYears <= years && r.amount !== null)
    .sort((a, b) => b.minYears - a.minYears || b.effectiveFrom.localeCompare(a.effectiveFrom));
  const rule = tiers[0];
  if (!rule) return null;
  const days = rule.amountUnit === "weeks" ? rule.amount! * workDaysPerWeek : rule.amount!;
  return { days, rule };
}

/** The next service anniversary at which the minimum rises, if any. */
export function nextMinimumStep(rules: JurisdictionRule[], jurisdiction: string, hireDate: ISODate, at: ISODate) {
  const years = yearsBetween(hireDate, at);
  const steps = current(rules, at)
    .filter((r) => r.jurisdiction === jurisdiction && r.category === "vacation" && r.ruleKind === "min_entitlement" && r.minYears > years)
    .sort((a, b) => a.minYears - b.minYears);
  return steps[0] ?? null;
}

export function forfeitRule(rules: JurisdictionRule[], jurisdiction: string, category: string, at: ISODate): JurisdictionRule | null {
  if (category !== "vacation") return null;
  return current(rules, at).find((r) => r.jurisdiction === jurisdiction && r.category === "vacation" && r.ruleKind !== "min_entitlement") ?? null;
}
