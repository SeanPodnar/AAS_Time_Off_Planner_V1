// People management for HR admins. Every function runs inside withTenant, so it can only
// see and change the current company's people, and every change is written to the audit log.
import { z } from "zod";
import type postgres from "postgres";
import { withTenant, writeAudit } from "./tenancy";
import { fieldErrors } from "./validation";
import { DEFAULT_TIME_ZONE, isJurisdiction, isTimeZone } from "./jurisdictions";

export type Actor = { personId: string; role: "employee" | "admin" };

export class NotAllowed extends Error {}
function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new NotAllowed("HR admin only");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optionalId = z.string().trim().transform((s) => (s === "" ? null : s)).refine((s) => s === null || UUID.test(s), "Choose from the list.").nullable().default(null);
const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `Keep ${label} to ${max} characters or fewer.`).transform((s) => (s === "" ? null : s)).nullable().default(null);

export const personInput = z.object({
  fullName: z.string().trim().min(1, "Enter the person's name.").max(200, "Keep the name to 200 characters or fewer."),
  email: z.string().trim().toLowerCase().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a work email like name@company.com."),
  jobTitle: optionalText(120, "the job title"),
  employeeNumber: optionalText(40, "the employee number"),
  jurisdiction: z.string().refine(isJurisdiction, "Choose the province or state whose employment law applies."),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the start date."),
  managerId: optionalId,
  secondaryManagerIds: z.array(z.string().refine((s) => UUID.test(s))).default([]),
  teamName: optionalText(80, "the team name"),
  locationName: optionalText(80, "the location name"),
  role: z.enum(["employee", "admin"]),
  hoursPerDay: z.coerce.number({ message: "Enter hours per day, for example 7.5." }).gt(0, "Hours per day must be more than 0.").max(24, "Hours per day can't be more than 24."),
  workDays: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Choose at least one work day."),
});
export type PersonInput = z.infer<typeof personInput>;

export type PersonRow = {
  id: string; fullName: string; email: string; jobTitle: string | null; employeeNumber: string | null;
  jurisdiction: string; hireDate: string; managerId: string | null; managerName: string | null;
  secondaryManagerIds: string[]; team: string | null; location: string | null;
  role: "employee" | "admin"; status: "active" | "inactive"; hoursPerDay: number; workDays: number[];
};

function toRow(r: Record<string, unknown>): PersonRow {
  return {
    id: r.id as string, fullName: r.full_name as string, email: r.email as string, jobTitle: r.job_title as string | null,
    employeeNumber: r.employee_number as string | null, jurisdiction: r.jurisdiction as string,
    hireDate: (r.hire_date instanceof Date ? r.hire_date.toISOString() : String(r.hire_date)).slice(0, 10),
    managerId: r.manager_id as string | null, managerName: (r.manager_name as string | null) ?? null,
    secondaryManagerIds: (r.secondary_ids as string[] | null) ?? [], team: r.team as string | null, location: r.location as string | null,
    role: r.role as PersonRow["role"], status: r.status as PersonRow["status"],
    hoursPerDay: Number(r.hours_per_day), workDays: (r.work_days as number[]).map(Number),
  };
}

const SELECT = (tx: postgres.TransactionSql) => tx`
  select p.id, p.full_name, p.email, p.job_title, p.employee_number, p.jurisdiction, p.hire_date::text as hire_date,
         p.manager_id, m.full_name as manager_name, t.name as team, l.name as location, p.role, p.status,
         p.hours_per_day, p.work_days,
         coalesce((select array_agg(pm.manager_id) from person_managers pm where pm.person_id = p.id), '{}') as secondary_ids
    from people p
    left join people m on m.id = p.manager_id
    left join teams t on t.id = p.team_id
    left join locations l on l.id = p.location_id`;

export type ListFilter = { q?: string; status?: "active" | "inactive" | "all" };

export async function listPeople(tenantId: string, actor: Actor, f: ListFilter = {}): Promise<PersonRow[]> {
  assertAdmin(actor);
  const q = (f.q ?? "").trim().toLowerCase();
  const status = f.status ?? "active";
  return withTenant(tenantId, async (tx) => {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await tx`
      ${SELECT(tx)}
       where (${status} = 'all' or p.status = ${status})
         and (${q} = '' or lower(p.full_name) like ${like} or lower(p.email) like ${like}
              or lower(coalesce(t.name, '')) like ${like} or lower(coalesce(l.name, '')) like ${like}
              or lower(coalesce(m.full_name, '')) like ${like} or lower(coalesce(p.job_title, '')) like ${like})
       order by lower(p.full_name)`;
    return rows.map(toRow);
  });
}

export async function getPerson(tenantId: string, actor: Actor, id: string): Promise<PersonRow | null> {
  assertAdmin(actor);
  if (!UUID.test(id)) return null;
  return withTenant(tenantId, async (tx) => {
    const [r] = await tx`${SELECT(tx)} where p.id = ${id}`;
    return r ? toRow(r) : null;
  });
}

export async function listTeamsAndLocations(tenantId: string) {
  return withTenant(tenantId, async (tx) => ({
    teams: (await tx`select name from teams order by lower(name)`).map((r) => r.name as string),
    locations: (await tx`select name from locations order by lower(name)`).map((r) => r.name as string),
  }));
}

async function idForName(tx: postgres.TransactionSql, table: "teams" | "locations", name: string | null): Promise<string | null> {
  if (!name) return null;
  const [found] = await tx`select id from ${tx(table)} where lower(btrim(name)) = lower(btrim(${name}))`;
  if (found) return found.id;
  const [made] = await tx`insert into ${tx(table)} (tenant_id, name) values (app_tenant_id(), ${name}) returning id`;
  return made.id;
}

/** True if making managerId the manager of personId would create a loop (A manages B manages A). */
async function wouldLoop(tx: postgres.TransactionSql, personId: string, managerId: string): Promise<boolean> {
  const [r] = await tx`
    with recursive chain(id, depth) as (
      select ${managerId}::uuid, 0
      union all
      select p.manager_id, c.depth + 1 from people p join chain c on p.id = c.id
       where p.manager_id is not null and c.depth < 50
    )
    select exists (select 1 from chain where id = ${personId}::uuid) as loop`;
  return r.loop;
}

export type SaveResult = { ok: true; id: string } | { ok: false; errors: Record<string, string> };

export async function savePerson(tenantId: string, actor: Actor, raw: unknown, id?: string): Promise<SaveResult> {
  assertAdmin(actor);
  const parsed = personInput.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const p = parsed.data;
  if (id && !UUID.test(id)) return { ok: false, errors: { form: "That person no longer exists." } };
  if (id && p.managerId === id) return { ok: false, errors: { managerId: "A person can't be their own manager." } };
  const secondary = [...new Set(p.secondaryManagerIds)].filter((m) => m !== p.managerId && m !== id);
  const workDays = [...new Set(p.workDays)].sort();

  try {
    return await withTenant(tenantId, async (tx): Promise<SaveResult> => {
      const before = id ? (await tx`${SELECT(tx)} where p.id = ${id}`)[0] : undefined;
      if (id && !before) return { ok: false, errors: { form: "That person no longer exists." } };

      const managers = [p.managerId, ...secondary].filter(Boolean) as string[];
      if (managers.length) {
        const found = await tx`select id, status from people where id in ${tx(managers)}`;
        if (found.length !== new Set(managers).size) return { ok: false, errors: { managerId: "Choose a manager from this company." } };
        if (p.managerId && found.find((f) => f.id === p.managerId)?.status !== "active") {
          return { ok: false, errors: { managerId: "Choose an active manager." } };
        }
      }
      if (id && p.managerId && (await wouldLoop(tx, id, p.managerId))) {
        return { ok: false, errors: { managerId: "That would make a loop: this person already manages that manager, directly or through others." } };
      }
      if (id && before!.role === "admin" && p.role !== "admin") {
        const [{ n }] = await tx`select count(*)::int as n from people where role = 'admin' and status = 'active' and id <> ${id}`;
        if (n === 0) return { ok: false, errors: { role: "Keep at least one active HR admin." } };
      }

      const teamId = await idForName(tx, "teams", p.teamName);
      const locationId = await idForName(tx, "locations", p.locationName);
      let personId = id;
      if (id) {
        await tx`update people set full_name = ${p.fullName}, email = ${p.email}, job_title = ${p.jobTitle}, employee_number = ${p.employeeNumber},
                   jurisdiction = ${p.jurisdiction}, hire_date = ${p.hireDate}, manager_id = ${p.managerId}, team_id = ${teamId},
                   location_id = ${locationId}, role = ${p.role}, hours_per_day = ${p.hoursPerDay}, work_days = ${workDays}, updated_at = now()
                 where id = ${id}`;
      } else {
        const [r] = await tx`insert into people (tenant_id, full_name, email, job_title, employee_number, jurisdiction, hire_date, manager_id,
                                team_id, location_id, role, hours_per_day, work_days)
                             values (app_tenant_id(), ${p.fullName}, ${p.email}, ${p.jobTitle}, ${p.employeeNumber}, ${p.jurisdiction}, ${p.hireDate},
                                     ${p.managerId}, ${teamId}, ${locationId}, ${p.role}, ${p.hoursPerDay}, ${workDays}) returning id`;
        personId = r.id;
      }
      await tx`delete from person_managers where person_id = ${personId!}`;
      for (const m of secondary) await tx`insert into person_managers (tenant_id, person_id, manager_id) values (app_tenant_id(), ${personId!}, ${m})`;

      const after = toRow((await tx`${SELECT(tx)} where p.id = ${personId!}`)[0]);
      const changed = before ? diff(toRow(before), after) : undefined;
      await writeAudit(tx, `person:${actor.personId}`, id ? "person.updated" : "person.created",
        id ? { personId, changed } : { personId, fullName: p.fullName, email: p.email, role: p.role });
      return { ok: true, id: personId! };
    });
  } catch (e) {
    const err = e as { code?: string; constraint_name?: string };
    if (err.code === "23505" && err.constraint_name === "people_email_per_tenant") return { ok: false, errors: { email: "Someone at this company already uses this email." } };
    if (err.code === "23505" && err.constraint_name === "people_employee_number") return { ok: false, errors: { employeeNumber: "Another person already has this employee number." } };
    throw e;
  }
}

function diff(a: PersonRow, b: PersonRow): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(b) as (keyof PersonRow)[]) {
    if (k === "managerName") continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = { from: a[k], to: b[k] };
  }
  return out;
}

export type StatusResult = { ok: true } | { ok: false; error: string };

/** Deactivating ends the person's sessions. Their reports keep the manager link until HR changes it. */
export async function setStatus(tenantId: string, actor: Actor, id: string, status: "active" | "inactive"): Promise<StatusResult> {
  assertAdmin(actor);
  if (!UUID.test(id)) return { ok: false, error: "That person no longer exists." };
  if (id === actor.personId && status === "inactive") return { ok: false, error: "You can't deactivate yourself. Ask another HR admin." };
  return withTenant(tenantId, async (tx) => {
    const [p] = await tx`select role, status from people where id = ${id}`;
    if (!p) return { ok: false, error: "That person no longer exists." } as const;
    if (status === "inactive" && p.role === "admin") {
      const [{ n }] = await tx`select count(*)::int as n from people where role = 'admin' and status = 'active' and id <> ${id}`;
      if (n === 0) return { ok: false, error: "Keep at least one active HR admin." } as const;
    }
    await tx`update people set status = ${status}, updated_at = now() where id = ${id}`;
    if (status === "inactive") await tx`update sessions set revoked_at = now() where person_id = ${id} and revoked_at is null`;
    await writeAudit(tx, `person:${actor.personId}`, status === "inactive" ? "person.deactivated" : "person.reactivated", { personId: id });
    return { ok: true } as const;
  });
}

// Company settings ---------------------------------------------------------------------

export type Settings = { timeZone: string; secondApprovalThreshold: number; reminderAfterDays: number; escalateAfterDays: number };

export async function getSettings(tenantId: string, country: "CA" | "US"): Promise<Settings> {
  return withTenant(tenantId, async (tx) => {
    const [s] = await tx`select time_zone, second_approval_threshold, reminder_after_days, escalate_after_days from tenant_settings`;
    return s
      ? { timeZone: s.time_zone, secondApprovalThreshold: s.second_approval_threshold, reminderAfterDays: Number(s.reminder_after_days), escalateAfterDays: Number(s.escalate_after_days) }
      : { timeZone: DEFAULT_TIME_ZONE[country], secondApprovalThreshold: 10, reminderAfterDays: 2, escalateAfterDays: 5 };
  });
}

export const settingsInput = z.object({
  timeZone: z.string().refine(isTimeZone, "Choose a time zone from the list."),
  secondApprovalThreshold: z.coerce.number().int("Use a whole number of days.").min(1, "Use 1 to 60 days.").max(60, "Use 1 to 60 days."),
  reminderAfterDays: z.coerce.number({ message: "Use a whole number of days." }).int("Use a whole number of days.").min(1, "Use 1 to 30 days.").max(30, "Use 1 to 30 days."),
  escalateAfterDays: z.coerce.number({ message: "Use a whole number of days." }).int("Use a whole number of days.").min(1, "Use 1 to 60 days.").max(60, "Use 1 to 60 days."),
}).refine((v) => v.escalateAfterDays > v.reminderAfterDays, { path: ["escalateAfterDays"], message: "Escalate after more days than the reminder." });

export async function saveSettings(tenantId: string, actor: Actor, raw: unknown): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  assertAdmin(actor);
  const parsed = settingsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const s = parsed.data;
  await withTenant(tenantId, async (tx) => {
    await tx`insert into tenant_settings (tenant_id, time_zone, second_approval_threshold, reminder_after_days, escalate_after_days)
             values (app_tenant_id(), ${s.timeZone}, ${s.secondApprovalThreshold}, ${s.reminderAfterDays}, ${s.escalateAfterDays})
             on conflict (tenant_id) do update set time_zone = excluded.time_zone, second_approval_threshold = excluded.second_approval_threshold,
               reminder_after_days = excluded.reminder_after_days, escalate_after_days = excluded.escalate_after_days, updated_at = now()`;
    await writeAudit(tx, `person:${actor.personId}`, "settings.updated", s);
  });
  return { ok: true };
}

/** Active people in the company, for pickers such as choosing a backup approver. */
export async function listActivePeopleNames(tenantId: string): Promise<{ id: string; fullName: string }[]> {
  return withTenant(tenantId, async (tx) =>
    (await tx`select id, full_name from people where status = 'active' order by lower(full_name), id`).map((r) => ({ id: r.id as string, fullName: r.full_name as string })));
}
