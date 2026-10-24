// Minimal iCalendar (RFC 5545) writer for all-day time off events. Works with Google Calendar,
// Outlook and Apple Calendar subscriptions.
import { addDays, type ISODate } from "../accrual/dates";

export type IcsEvent = { uid: string; start: ISODate; endInclusive: ISODate; summary: string; busy: "busy" | "free" | "out_of_office" };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const date = (d: ISODate) => d.replace(/-/g, "");
const stamp = (t: Date) => t.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Folds a content line to 75 octets, continuing lines with a leading space. */
export function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0, limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // don't split a UTF-8 character
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuation lines start with a space
  }
  return parts.join("\r\n ");
}

export function buildIcs(name: string, events: IcsEvent[], now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AAS Time Off Planner//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`, "X-PUBLISHED-TTL:PT1H", "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT", `UID:${esc(e.uid)}`, `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${date(e.start)}`, `DTEND;VALUE=DATE:${date(addDays(e.endInclusive, 1))}`,
      `SUMMARY:${esc(e.summary)}`, `TRANSP:${e.busy === "free" ? "TRANSPARENT" : "OPAQUE"}`,
      `X-MICROSOFT-CDO-BUSYSTATUS:${e.busy === "free" ? "FREE" : e.busy === "busy" ? "BUSY" : "OOF"}`,
      "X-MICROSOFT-CDO-ALLDAYEVENT:TRUE", "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
