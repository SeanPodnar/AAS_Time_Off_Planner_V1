// Plain-words descriptions of a plan, shared by the plans pages.
import type { PlanRow } from "./plans";

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");


export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const CATEGORY_LABELS: Record<string, string> = {
  vacation: "Vacation", sick: "Sick", personal: "Personal", wellbeing: "Wellbeing", bereavement: "Bereavement", parental: "Parental", unpaid: "Unpaid", lieu: "Time in lieu", other: "Other",
};

const FREQ_WORDS: Record<string, string> = { annual: "once a year", semi_annual: "twice a year", quarterly: "every quarter", monthly: "every month" };
const LUMP_WORDS: Record<string, string> = { plan_year_start: "at the start of the plan year", hire_date: "on the start date", anniversary: "on each work anniversary" };

export function howEarned(p: Pick<PlanRow, "accrualMethod" | "lumpSumTiming" | "frequency" | "creditTiming" | "hoursWorkedRatio" | "unit">): string {
  switch (p.accrualMethod) {
    case "lump_sum": return `Given in full ${LUMP_WORDS[p.lumpSumTiming ?? ""] ?? ""}`.trim();
    case "periodic": return `Earned ${FREQ_WORDS[p.frequency ?? ""] ?? ""}, credited at the ${p.creditTiming === "end" ? "end" : "start"} of each period`;
    case "hours_worked": return `1 hour earned for every ${p.hoursWorkedRatio ?? "?"} hours worked`;
    default: return "Not tracked, no balance";
  }
}

export const APPROVAL_LABELS: Record<string, string> = { auto: "Automatic", manager: "Manager", admin: "HR admin" };
export const VISIBILITY_LABELS: Record<string, string> = { name: "Name and plan", out_of_office: "Out of office only", hidden: "Nothing" };

export type Tier = { years: number; amount: number };

/** Parses "5:20, 10:25" into tiers. Returns an error message when the text is not in that shape. */
export function parseTiers(raw: unknown): { ok: true; tiers: Tier[] } | { ok: false; error: string } {
  const bad = { ok: false as const, error: 'Use "years:amount" pairs, for example "5:20, 10:25".' };
  let tiers: Tier[];
  if (Array.isArray(raw)) {
    tiers = raw.map((t) => ({ years: Number((t as Tier)?.years), amount: Number((t as Tier)?.amount) }));
  } else if (blank(raw)) {
    tiers = [];
  } else {
    tiers = [];
    for (const part of String(raw).split(/[,\n;]/).map((s) => s.trim()).filter(Boolean)) {
      const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(part);
      if (!m) return bad;
      tiers.push({ years: Number(m[1]), amount: Number(m[2]) });
    }
  }
  for (const t of tiers) {
    if (!Number.isFinite(t.years) || !Number.isFinite(t.amount)) return bad;
    if (t.years <= 0 || t.years > 60) return { ok: false, error: "Years of service must be between 0 and 60." };
    if (t.amount < 0 || t.amount > 2000) return { ok: false, error: "Each tier amount must be between 0 and 2000." };
  }
  tiers.sort((a, b) => a.years - b.years);
  for (let i = 1; i < tiers.length; i++) if (tiers[i].years === tiers[i - 1].years) return { ok: false, error: "Each tier needs a different number of years." };
  return { ok: true, tiers };
}

export function formatTiers(tiers: Tier[]): string {
  return tiers.map((t) => `${t.years}:${t.amount}`).join(", ");
}

