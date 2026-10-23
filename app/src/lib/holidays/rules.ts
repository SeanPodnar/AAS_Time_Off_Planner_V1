// Public holidays by province, territory and (for the US) the federal list, generated from rules
// so every year works without new data. Pure functions, no database access.
//
// Canada: statutory (general) holidays under each province's or territory's employment standards
// law. Employers must give these. US: no state requires private employers to give holidays, so the
// default is the federal list, and each company removes the days it doesn't observe.
// All figures come from secondary sources and must be checked by the legal reviewer (PRD D7).
import { addDays, weekday, type ISODate } from "../accrual/dates";

export const HOLIDAY_RULES_VERIFIED = false;

type Rule =
  | { kind: "fixed"; m: number; d: number }
  | { kind: "nth"; m: number; wd: number; n: number } // n-th weekday of the month (wd 1 = Monday)
  | { kind: "last"; m: number; wd: number } // last weekday of the month
  | { kind: "before"; m: number; d: number; wd: number } // the weekday strictly before m/d (Victoria Day: Monday before May 25)
  | { kind: "easter"; offset: number }; // days from Easter Sunday (Good Friday -2, Easter Monday +1)

type Def = { key: string; name: string; rule: Rule; from?: number };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number): ISODate => `${y}-${pad(m)}-${pad(d)}`;

/** Easter Sunday (Gregorian, anonymous algorithm). */
export function easter(y: number): ISODate {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}

function dateOf(r: Rule, y: number): ISODate {
  switch (r.kind) {
    case "fixed": return ymd(y, r.m, r.d);
    case "easter": return addDays(easter(y), r.offset);
    case "nth": {
      let x = ymd(y, r.m, 1);
      while (weekday(x) !== r.wd) x = addDays(x, 1);
      return addDays(x, 7 * (r.n - 1));
    }
    case "last": {
      let x = addDays(ymd(r.m === 12 ? y + 1 : y, r.m === 12 ? 1 : r.m + 1, 1), -1);
      while (weekday(x) !== r.wd) x = addDays(x, -1);
      return x;
    }
    case "before": {
      let x = addDays(ymd(y, r.m, r.d), -1);
      while (weekday(x) !== r.wd) x = addDays(x, -1);
      return x;
    }
  }
}

const H = {
  newYear: { key: "new_year", name: "New Year's Day", rule: { kind: "fixed", m: 1, d: 1 } },
  family: { key: "family_day", name: "Family Day", rule: { kind: "nth", m: 2, wd: 1, n: 3 } },
  goodFriday: { key: "good_friday", name: "Good Friday", rule: { kind: "easter", offset: -2 } },
  victoria: { key: "victoria_day", name: "Victoria Day", rule: { kind: "before", m: 5, d: 25, wd: 1 } },
  canada: { key: "canada_day", name: "Canada Day", rule: { kind: "fixed", m: 7, d: 1 } },
  civicAug: { key: "civic_holiday", name: "Civic Holiday", rule: { kind: "nth", m: 8, wd: 1, n: 1 } },
  labour: { key: "labour_day", name: "Labour Day", rule: { kind: "nth", m: 9, wd: 1, n: 1 } },
  truth: { key: "truth_reconciliation", name: "National Day for Truth and Reconciliation", rule: { kind: "fixed", m: 9, d: 30 } },
  thanks: { key: "thanksgiving", name: "Thanksgiving", rule: { kind: "nth", m: 10, wd: 1, n: 2 } },
  remembrance: { key: "remembrance_day", name: "Remembrance Day", rule: { kind: "fixed", m: 11, d: 11 } },
  christmas: { key: "christmas", name: "Christmas Day", rule: { kind: "fixed", m: 12, d: 25 } },
  boxing: { key: "boxing_day", name: "Boxing Day", rule: { kind: "fixed", m: 12, d: 26 } },
  indigenous: { key: "indigenous_peoples_day", name: "National Indigenous Peoples Day", rule: { kind: "fixed", m: 6, d: 21 } },
} satisfies Record<string, Def>;
const named = (d: Def, name: string, key = d.key): Def => ({ ...d, name, key });

export const CANADA: Record<string, Def[]> = {
  "CA-AB": [H.newYear, H.family, H.goodFriday, H.victoria, H.canada, H.labour, H.thanks, H.remembrance, H.christmas],
  "CA-BC": [H.newYear, H.family, H.goodFriday, H.victoria, H.canada, named(H.civicAug, "British Columbia Day", "bc_day"), H.labour, { ...H.truth, from: 2023 }, H.thanks, H.remembrance, H.christmas],
  "CA-MB": [H.newYear, named(H.family, "Louis Riel Day", "louis_riel_day"), H.goodFriday, H.victoria, H.canada, H.labour, { ...H.truth, from: 2024 }, H.thanks, H.christmas],
  "CA-NB": [H.newYear, H.family, H.goodFriday, H.canada, named(H.civicAug, "New Brunswick Day", "nb_day"), H.labour, H.remembrance, H.christmas],
  "CA-NL": [H.newYear, H.goodFriday, named(H.canada, "Memorial Day"), H.labour, H.remembrance, H.christmas],
  "CA-NS": [H.newYear, named(H.family, "Heritage Day", "heritage_day"), H.goodFriday, H.canada, H.labour, H.christmas],
  "CA-NT": [H.newYear, H.goodFriday, H.victoria, H.indigenous, H.canada, H.civicAug, H.labour, { ...H.truth, from: 2022 }, H.thanks, H.remembrance, H.christmas],
  "CA-NU": [H.newYear, H.goodFriday, H.victoria, H.canada, { key: "nunavut_day", name: "Nunavut Day", rule: { kind: "fixed", m: 7, d: 9 } }, H.civicAug, H.labour, { ...H.truth, from: 2022 }, H.thanks, H.remembrance, H.christmas],
  "CA-ON": [H.newYear, H.family, H.goodFriday, H.victoria, H.canada, H.labour, H.thanks, H.christmas, H.boxing],
  "CA-PE": [H.newYear, named(H.family, "Islander Day", "islander_day"), H.goodFriday, H.canada, H.labour, { ...H.truth, from: 2022 }, H.remembrance, H.christmas],
  // Quebec: the employer may give Easter Monday instead of Good Friday (swap it in company holidays).
  "CA-QC": [H.newYear, H.goodFriday, named(H.victoria, "National Patriots' Day", "patriots_day"), { key: "st_jean_baptiste", name: "Saint-Jean-Baptiste Day", rule: { kind: "fixed", m: 6, d: 24 } }, H.canada, H.labour, H.thanks, H.christmas],
  "CA-SK": [H.newYear, H.family, H.goodFriday, H.victoria, H.canada, named(H.civicAug, "Saskatchewan Day", "sk_day"), H.labour, H.thanks, H.remembrance, H.christmas],
  "CA-YT": [H.newYear, H.goodFriday, H.victoria, H.indigenous, H.canada, { key: "discovery_day", name: "Discovery Day", rule: { kind: "nth", m: 8, wd: 1, n: 3 } }, H.labour, { ...H.truth, from: 2023 }, H.thanks, H.remembrance, H.christmas],
};

export const US_FEDERAL: Def[] = [
  H.newYear,
  { key: "mlk_day", name: "Martin Luther King Jr. Day", rule: { kind: "nth", m: 1, wd: 1, n: 3 } },
  { key: "presidents_day", name: "Presidents' Day", rule: { kind: "nth", m: 2, wd: 1, n: 3 } },
  { key: "memorial_day", name: "Memorial Day", rule: { kind: "last", m: 5, wd: 1 } },
  { key: "juneteenth", name: "Juneteenth", rule: { kind: "fixed", m: 6, d: 19 }, from: 2021 },
  { key: "independence_day", name: "Independence Day", rule: { kind: "fixed", m: 7, d: 4 } },
  named(H.labour, "Labor Day"),
  { key: "columbus_day", name: "Columbus Day", rule: { kind: "nth", m: 10, wd: 1, n: 2 } },
  { key: "veterans_day", name: "Veterans Day", rule: { kind: "fixed", m: 11, d: 11 } },
  { key: "us_thanksgiving", name: "Thanksgiving Day", rule: { kind: "nth", m: 11, wd: 4, n: 4 } },
  H.christmas,
];

export type Holiday = { date: ISODate; key: string; name: string; statutory: boolean; observedFor?: ISODate };

/**
 * Holidays for a jurisdiction in a year. When a holiday falls on a weekend, the observed weekday
 * is added too: in Canada the next free weekday (Christmas on Saturday is observed Monday, Boxing
 * Day then Tuesday); for US federal holidays Saturday moves to Friday and Sunday to Monday.
 * Whether a person gets the observed day depends on their own work days, which the caller decides.
 */
export function holidaysFor(jurisdiction: string, year: number): Holiday[] {
  const ca = jurisdiction.startsWith("CA-");
  const defs = (ca ? CANADA[jurisdiction] : US_FEDERAL) ?? [];
  const base = defs.filter((x) => !x.from || year >= x.from).map((x) => ({ date: dateOf(x.rule, year), key: x.key, name: x.name, statutory: ca }));
  base.sort((a, b) => a.date.localeCompare(b.date));
  const taken = new Set(base.map((h) => h.date));
  const out: Holiday[] = [...base];
  for (const h of base) {
    const wd = weekday(h.date);
    if (wd < 6) continue;
    let obs: ISODate;
    if (ca) {
      // Canada Day on a Sunday is July 2 by law; other weekend holidays move to the next free weekday.
      obs = addDays(h.date, wd === 6 ? 2 : 1);
      while (taken.has(obs) || weekday(obs) > 5) obs = addDays(obs, 1);
    } else {
      obs = addDays(h.date, wd === 6 ? -1 : 1);
    }
    taken.add(obs);
    out.push({ date: obs, key: `${h.key}_observed`, name: `${h.name} (observed)`, statutory: h.statutory, observedFor: h.date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
