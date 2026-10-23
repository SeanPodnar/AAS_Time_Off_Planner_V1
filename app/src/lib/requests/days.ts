// Pure date logic for requests: which days a request covers, how many days it counts,
// and the run of joined-up time off used for the second approval rule. No database access.
import { addDays, weekday, type ISODate } from "../accrual/dates";

export type Part = "full" | "am" | "pm";
export type DayPart = { day: ISODate; part: Part };
export type Schedule = { workDays: number[]; holidays: Set<ISODate> };

export const isWorkingDay = (s: Schedule, d: ISODate) => s.workDays.includes(weekday(d)) && !s.holidays.has(d);
export const partValue = (p: Part) => (p === "full" ? 1 : 0.5);

/**
 * The days a request counts. Working-day plans skip non-working days and holidays;
 * calendar-day plans count every date. Half days apply to the first and last date only.
 */
export function requestDays(s: Schedule, start: ISODate, end: ISODate, startPart: Part, endPart: Part, counts: "working_days" | "calendar_days"): DayPart[] {
  const out: DayPart[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (counts === "working_days" && !isWorkingDay(s, d)) continue;
    const part: Part = d === start ? startPart : d === end ? endPart : "full";
    out.push({ day: d, part });
  }
  return out;
}

export const totalDays = (days: DayPart[]) => days.reduce((a, d) => a + partValue(d.part), 0);

/** Two parts can share a date only if one is the morning and the other the afternoon. */
export function partsClash(a: Part, b: Part) {
  return a === "full" || b === "full" || a === b;
}

/**
 * Working days in the run that contains `mine`: the request's own working days plus every
 * other booked working day joined to them with no free working day in between.
 * Weekends and holidays do not break a run. Each working date with any time off counts as one.
 * Example: a Friday wellbeing day plus the next two weeks of vacation is 11.
 */
export function runLength(s: Schedule, mine: ISODate[], others: ISODate[]): number {
  const booked = new Set([...mine, ...others].filter((d) => isWorkingDay(s, d)));
  const own = mine.filter((d) => isWorkingDay(s, d)).sort();
  if (own.length === 0) return 0;
  // Walk outwards from the request over non-working days and booked days.
  const step = (from: ISODate, dir: 1 | -1) => {
    let d = from, edge = from;
    for (let i = 0; i < 800; i++) {
      d = addDays(d, dir);
      if (booked.has(d)) edge = d;
      else if (isWorkingDay(s, d)) break;
    }
    return edge;
  };
  const first = step(own[0], -1), last = step(own[own.length - 1], 1);
  let n = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) if (booked.has(d)) n++;
  return n;
}
