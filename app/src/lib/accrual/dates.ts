// Calendar-date helpers. Leave works in whole calendar dates ("2026-06-10"), never timestamps,
// so everything here is plain YYYY-MM-DD arithmetic in UTC with no time-of-day.

export type ISODate = string;

export function toDate(d: ISODate): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Not a date: ${d}`);
  return new Date(`${d}T00:00:00Z`);
}
export const iso = (d: Date): ISODate => d.toISOString().slice(0, 10);
export const ymd = (d: ISODate) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) });

export function addDays(d: ISODate, n: number): ISODate {
  const x = toDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
}

/** Adds months, clamping the day to the end of the target month (Jan 31 + 1 month = Feb 28). */
export function addMonths(d: ISODate, n: number): ISODate {
  const { y, m, d: day } = ymd(d);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12), tm = (total % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}
export const addYears = (d: ISODate, n: number) => addMonths(d, n * 12);

export const maxDate = (...ds: ISODate[]) => ds.reduce((a, b) => (b > a ? b : a));
export const minDate = (...ds: ISODate[]) => ds.reduce((a, b) => (b < a ? b : a));

/** ISO weekday, 1 = Monday ... 7 = Sunday. */
export function weekday(d: ISODate): number {
  const w = toDate(d).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Completed years between start and at (the anniversary day counts as complete). */
export function yearsBetween(start: ISODate, at: ISODate): number {
  const a = ymd(start), b = ymd(at);
  let y = b.y - a.y;
  if (b.m < a.m || (b.m === a.m && b.d < a.d)) y -= 1;
  return Math.max(0, y);
}

/**
 * Whole months from `from` up to `end` (exclusive), counting `from`'s own month only when it starts
 * on or before the 15th. This is the plan's first-year proration rule.
 * Example: from 2026-06-10 to 2027-01-01 = 7 months; from 2026-06-20 = 6 months.
 */
export function monthsRemaining(from: ISODate, end: ISODate): number {
  const a = ymd(from), b = ymd(end);
  let months = (b.y * 12 + b.m) - (a.y * 12 + a.m);
  if (b.d > 1) months += 1; // end inside a month: that month is partly before the end
  if (a.d > 15) months -= 1;
  return Math.max(0, months);
}

/** Today's date in a time zone ("today" for a company is its own calendar day). */
export function todayIn(timeZone: string, now = new Date()): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
