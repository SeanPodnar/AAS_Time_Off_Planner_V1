// Company holiday calendars: the jurisdiction's default holidays, plus days the company adds,
// minus defaults it skips. Used by the request service to leave holidays out of day counts.
import { z } from "zod";
import type postgres from "postgres";
import { withTenant, writeAudit } from "../tenancy";
import { NotAllowed, type Actor } from "../people";
import { ymd, type ISODate } from "../accrual/dates";
import { HOLIDAY_RULES_VERIFIED, holidaysFor } from "./rules";

export { HOLIDAY_RULES_VERIFIED };
type Tx = postgres.TransactionSql;
const d = (v: unknown): ISODate => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Holiday dates for one jurisdiction between two dates (inclusive), with this company's changes. */
export async function holidayDates(tx: Tx, jurisdiction: string, from: ISODate, to: ISODate): Promise<Set<ISODate>> {
  const out = new Set<ISODate>();
  for (let y = ymd(from).y; y <= ymd(to).y; y++) for (const h of holidaysFor(jurisdiction, y)) if (h.date >= from && h.date <= to) out.add(h.date);
  const changes = await tx`select day, action from company_holidays where day between ${from} and ${to} and (jurisdiction is null or jurisdiction = ${jurisdiction})`;
  for (const c of changes) if (c.action === "skip") out.delete(d(c.day));
  for (const c of changes) if (c.action === "add") out.add(d(c.day));
  return out;
}

export type CalendarDay = { date: ISODate; name: string; source: "statutory" | "federal" | "company"; skipped: boolean; changeId: string | null; jurisdiction: string | null };

/** The year's calendar for one jurisdiction, as HR sees it: defaults (marked if skipped) and company days. */
export async function holidayCalendar(tenantId: string, actor: Actor, jurisdiction: string, year: number): Promise<CalendarDay[]> {
  if (actor.role !== "admin") throw new NotAllowed("HR admin only");
  return withTenant(tenantId, async (tx) => {
    const from = `${year}-01-01`, to = `${year}-12-31`;
    const changes = await tx`select id, day, action, name, jurisdiction from company_holidays where day between ${from} and ${to} and (jurisdiction is null or jurisdiction = ${jurisdiction}) order by day`;
    const out: CalendarDay[] = holidaysFor(jurisdiction, year).map((h) => {
      const skip = changes.find((c) => c.action === "skip" && d(c.day) === h.date);
      return { date: h.date, name: h.name, source: h.statutory ? "statutory" : "federal", skipped: !!skip, changeId: skip?.id ?? null, jurisdiction: skip?.jurisdiction ?? null };
    });
    for (const c of changes.filter((x) => x.action === "add")) out.push({ date: d(c.day), name: c.name, source: "company", skipped: false, changeId: c.id, jurisdiction: c.jurisdiction });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  });
}

const changeInput = z.object({
  day: z.string().refine(validDate, "Enter a date."),
  name: z.string().trim().min(1, "Enter a name.").max(80, "Keep the name to 80 characters or fewer."),
  jurisdiction: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().regex(/^(CA|US)-[A-Z]{2}$/, "Choose a province or state.").nullable()),
  reason: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(500).nullable()).default(null),
});

type Result = { ok: true; id: string } | { ok: false; errors: Record<string, string> };
const errorsOf = (e: z.ZodError) => { const o: Record<string, string> = {}; for (const i of e.issues) o[String(i.path[0] ?? "form")] ??= i.message; return o; };

/** Adds a company day off (for everyone, or one province or state). */
export async function addCompanyHoliday(tenantId: string, actor: Actor, raw: unknown): Promise<Result> {
  if (actor.role !== "admin") throw new NotAllowed("HR admin only");
  const p = changeInput.safeParse(raw ?? {});
  if (!p.success) return { ok: false, errors: errorsOf(p.error) };
  return save(tenantId, actor, "add", p.data);
}

/**
 * Stops observing a default holiday. Canadian statutory holidays need a reason: the law still
 * requires the day off with pay or a substitute day, so HR should add the substitute day too.
 */
export async function skipHoliday(tenantId: string, actor: Actor, raw: unknown): Promise<Result> {
  if (actor.role !== "admin") throw new NotAllowed("HR admin only");
  const p = changeInput.safeParse(raw ?? {});
  if (!p.success) return { ok: false, errors: errorsOf(p.error) };
  const j = p.data.jurisdiction;
  const year = ymd(p.data.day).y;
  const juris = j ? [j] : [];
  if (!j) {
    const rows = await withTenant(tenantId, (tx) => tx`select distinct jurisdiction from people where status = 'active'`);
    juris.push(...rows.map((r) => r.jurisdiction as string));
  }
  const statutory = juris.some((x) => holidaysFor(x, year).some((h) => h.date === p.data.day && h.statutory));
  const isDefault = juris.some((x) => holidaysFor(x, year).some((h) => h.date === p.data.day));
  if (!isDefault) return { ok: false, errors: { day: "That date isn't a default holiday here." } };
  if (statutory && !p.data.reason) return { ok: false, errors: { reason: "This is a statutory holiday. Give the reason and add the substitute day off." } };
  return save(tenantId, actor, "skip", p.data);
}

async function save(tenantId: string, actor: Actor, action: "add" | "skip", c: z.output<typeof changeInput>): Promise<Result> {
  try {
    return await withTenant(tenantId, async (tx): Promise<Result> => {
      const [row] = await tx`insert into company_holidays (tenant_id, day, action, name, jurisdiction, reason, created_by)
                             values (${tenantId}, ${c.day}, ${action}, ${c.name}, ${c.jurisdiction}, ${c.reason}, ${actor.personId}) returning id`;
      await writeAudit(tx, `person:${actor.personId}`, `holiday.${action === "add" ? "added" : "skipped"}`, { id: row.id, ...c });
      return { ok: true, id: row.id };
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { ok: false, errors: { day: action === "add" ? "That day is already a company holiday." : "That holiday is already skipped." } };
    throw e;
  }
}

/** Undoes an added day or a skip. Requests already booked keep their day counts. */
export async function removeHolidayChange(tenantId: string, actor: Actor, id: string): Promise<{ ok: boolean }> {
  if (actor.role !== "admin") throw new NotAllowed("HR admin only");
  if (!UUID.test(id)) return { ok: false };
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx`delete from company_holidays where id = ${id} returning day, action, name`;
    if (row) await writeAudit(tx, `person:${actor.personId}`, "holiday.change_removed", { id, day: d(row.day), action: row.action, name: row.name });
    return { ok: !!row };
  });
}
