// Shared shape for every report (FR-70 to FR-79). A report is a title, the filters used, a run
// label, typed columns with units, rows and an optional totals row. The screen, XLSX and CSV
// are all drawn from the same object, so they always agree.
import type { ISODate } from "../accrual/dates";

export type ColumnType = "text" | "number" | "date" | "percent";
export type Column = { key: string; label: string; type: ColumnType; decimals?: number };
export type Cell = string | number | null;
export type Row = Record<string, Cell>;

export type Report = {
  key: string;
  title: string;
  companyName: string;
  /** "Run on 24 Oct 2026, 09:15 EDT by Priya Shah" */
  runLabel: string;
  /** Filters in plain words, e.g. ["From 1 Oct 2026 to 31 Oct 2026", "Team: Sales"]. */
  filters: string[];
  columns: Column[];
  rows: Row[];
  totals: Row | null;
  notes: string[];
};

/** Filters every report understands. Reports ignore the ones that don't apply. */
export type ReportFilter = {
  from?: ISODate; to?: ISODate; asOf?: ISODate;
  teamId?: string; locationId?: string; managerId?: string; planId?: string; q?: string;
};

export type RunContext = { tenantId: string; companyName: string; timeZone: string; runBy: string; now?: Date };

const fmtDate = (d: ISODate) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(/\./g, "");
export const formatDate = fmtDate;

export function runLabel(ctx: RunContext): string {
  const now = ctx.now ?? new Date();
  const when = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }).format(now).replace(/\./g, "");
  return `Run on ${when} by ${ctx.runBy}`;
}

/** Sums the number columns named in `keys` into a totals row labelled in the first column. */
export function totalsRow(columns: Column[], rows: Row[], keys: string[], label = "Total"): Row {
  const out: Row = {};
  columns.forEach((c, i) => {
    if (i === 0) out[c.key] = label;
    else if (keys.includes(c.key)) out[c.key] = Math.round(rows.reduce((a, r) => a + (typeof r[c.key] === "number" ? (r[c.key] as number) : 0), 0) * 1000) / 1000;
    else out[c.key] = null;
  });
  return out;
}
