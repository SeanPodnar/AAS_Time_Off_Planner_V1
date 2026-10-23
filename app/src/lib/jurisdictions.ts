// Provinces, territories and states, as used for statutory rules and holidays. Codes are "CA-ON", "US-CA".
export const PROVINCES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island",
  QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};
export const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export const JURISDICTIONS: { code: string; name: string; country: "CA" | "US" }[] = [
  ...Object.entries(PROVINCES).map(([k, name]) => ({ code: `CA-${k}`, name, country: "CA" as const })),
  ...Object.entries(STATES).map(([k, name]) => ({ code: `US-${k}`, name, country: "US" as const })),
].sort((a, b) => a.name.localeCompare(b.name));

export const isJurisdiction = (code: string) => JURISDICTIONS.some((j) => j.code === code);
export const jurisdictionName = (code: string) => JURISDICTIONS.find((j) => j.code === code)?.name ?? code;

export const DEFAULT_TIME_ZONE: Record<"CA" | "US", string> = { CA: "America/Toronto", US: "America/New_York" };

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return /^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/.test(tz) || tz === "UTC";
  } catch {
    return false;
  }
}

/** Time zones offered in settings: Canada and the US first, then the rest. */
export function timeZoneChoices(): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["America/Toronto", "America/New_York"];
  const first = ["America/St_Johns", "America/Halifax", "America/Toronto", "America/Winnipeg", "America/Regina", "America/Edmonton",
    "America/Vancouver", "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles",
    "America/Anchorage", "Pacific/Honolulu"];
  return [...first, ...all.filter((z) => !first.includes(z))];
}

export const WEEKDAYS = [
  { n: 1, short: "Mon" }, { n: 2, short: "Tue" }, { n: 3, short: "Wed" }, { n: 4, short: "Thu" },
  { n: 5, short: "Fri" }, { n: 6, short: "Sat" }, { n: 7, short: "Sun" },
];
