import type { RequestRow } from "@/lib/requests/service";

export const fmtNum = (x: number) => String(Math.round(x * 1000) / 1000);
export const unitWord = (unit: "days" | "hours", n: number) => (unit === "days" ? (n === 1 ? "day" : "days") : n === 1 ? "hour" : "hours");
export const amountText = (n: number, unit: "days" | "hours") => `${fmtNum(n)} ${unitWord(unit, n)}`;

type Dates = Pick<RequestRow, "startDate" | "endDate" | "startPart" | "endPart">;
const partNote = (p: string) => (p === "pm" ? " (afternoon)" : p === "am" ? " (morning)" : "");

/** "2026-11-02 (afternoon) to 2026-11-04 (morning)". A single day shows its half day once. */
export function dateRange(r: Dates) {
  if (r.startDate === r.endDate) return `${r.startDate}${partNote(r.startPart)}`;
  return `${r.startDate}${r.startPart === "pm" ? partNote("pm") : ""} to ${r.endDate}${r.endPart === "am" ? partNote("am") : ""}`;
}

export const STATUS_LABELS: Record<string, [string, string]> = {
  pending: ["Pending", "pill"],
  approved: ["Approved", "pill ok"],
  declined: ["Declined", "pill bad"],
  cancelled: ["Cancelled", "pill"],
  superseded: ["Replaced", "pill"],
};

export const STEP_ROLE_LABELS: Record<string, string> = { manager: "Manager", next_manager: "Second approval", admin: "HR" };
export const STEP_STATUS_LABELS: Record<string, string> = { pending: "waiting for a decision", waiting: "not yet", approved: "approved", declined: "declined", cancelled: "closed" };

/** Only same-site paths we build ourselves may be used as a return target. */
export function safeReturn(v: unknown): string {
  const s = String(v ?? "");
  return s === "/" || /^\/people\/[0-9a-f-]{36}$/i.test(s) ? s : "/";
}
