// Reads report filters from a page or export URL. Both screens use the same names, so the
// export buttons can carry the page's filters unchanged.
import type { ReportFilter } from "@/lib/reports";

export type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function filterFrom(sp: SP): ReportFilter {
  const date = (k: string) => (DATE.test(one(sp[k])) ? one(sp[k]) : undefined);
  const text = (k: string) => one(sp[k]).trim() || undefined;
  return { from: date("from"), to: date("to"), asOf: date("asOf"), teamId: text("team"), locationId: text("location"), managerId: text("manager"), planId: text("plan"), q: text("q") };
}

/** The filter part of the query string (no sorting), for export links. */
export function filterQuery(sp: SP): string {
  const q = new URLSearchParams();
  for (const k of ["from", "to", "asOf", "team", "location", "manager", "plan", "q"]) if (one(sp[k]).trim()) q.set(k, one(sp[k]).trim());
  return q.toString();
}

export const first = one;
