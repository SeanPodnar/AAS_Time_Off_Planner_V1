// Report catalogue and access. Reports are HR admin only (FR-70 to FR-79); every run is
// scoped to the company by withTenant, and every export is written to the audit log.
import { withTenant, writeAudit } from "../tenancy";
import { NotAllowed, type Actor } from "../people";
import type { Report, ReportFilter, RunContext } from "./types";
import { balanceSummary, complianceReport, liabilityHours, yearEndPreview } from "./balances";
import { absenceRate, approvalMetrics, auditReport, whosOut } from "./activity";
import { fileName, toCsv, toXlsx } from "./export";

export type { Report, ReportFilter } from "./types";

type Def = { key: string; title: string; description: string; filters: ("range" | "asOf" | "until" | "people" | "plan" | "q")[]; run: (ctx: RunContext, f: ReportFilter) => Promise<Report> };

export const REPORTS: Def[] = [
  { key: "whos-out", title: "Who's out", description: "Everyone off in a date range.", filters: ["range", "people", "plan"], run: whosOut },
  { key: "balances", title: "Balance summary", description: "Balances on a date, with what's booked and the plan year end projection.", filters: ["asOf", "people", "plan", "q"], run: balanceSummary },
  { key: "year-end", title: "Year-end forfeiture preview", description: "What each year end will forfeit, and what the law keeps.", filters: ["until", "people", "plan"], run: yearEndPreview },
  { key: "absence", title: "Absence rate and days lost", description: "Days off as a share of working days, by person.", filters: ["range", "people", "plan"], run: absenceRate },
  { key: "approvals", title: "Approval metrics", description: "Requests decided, time to decide and decline rate, by approver.", filters: ["range"], run: approvalMetrics },
  { key: "liability", title: "Untaken leave liability", description: "Unused vacation in hours, with totals by team and location.", filters: ["asOf", "people", "plan"], run: liabilityHours },
  { key: "compliance", title: "Compliance", description: "Vacation below a statutory minimum now or within 90 days, and overrides applied at year end.", filters: ["people", "plan"], run: complianceReport },
  { key: "audit", title: "Audit report", description: "Every recorded action in a date range.", filters: ["range", "q"], run: auditReport },
];

export type RunAs = { tenantId: string; timeZone: string; runByName: string; now?: Date };

async function context(actor: Actor, as: RunAs): Promise<RunContext> {
  if (actor.role !== "admin") throw new NotAllowed("Reports are for HR admins");
  const companyName = await withTenant(as.tenantId, async (tx) => (await tx`select current_tenant_legal_name() as n`)[0].n as string);
  return { tenantId: as.tenantId, companyName, timeZone: as.timeZone, runBy: as.runByName, now: as.now };
}

export function findReport(key: string) {
  return REPORTS.find((r) => r.key === key) ?? null;
}

/** Runs a report for an HR admin. */
export async function runReport(actor: Actor, as: RunAs, key: string, f: ReportFilter): Promise<Report | null> {
  const def = findReport(key);
  if (!def) return null;
  const ctx = await context(actor, as);
  return def.run(ctx, f);
}

/** Runs and exports a report, recording the export (with its filters) in the audit log. */
export async function exportReport(actor: Actor, as: RunAs, key: string, f: ReportFilter, format: "xlsx" | "csv") {
  const report = await runReport(actor, as, key, f);
  if (!report) return null;
  await withTenant(as.tenantId, (tx) => writeAudit(tx, `person:${actor.personId}`, "report.exported", { report: key, format, filters: report.filters, rows: report.rows.length }));
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: as.timeZone }).format(as.now ?? new Date());
  return format === "xlsx"
    ? { name: fileName(report, "xlsx", date), type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: toXlsx(report) }
    : { name: fileName(report, "csv", date), type: "text/csv; charset=utf-8", body: toCsv(report) };
}
