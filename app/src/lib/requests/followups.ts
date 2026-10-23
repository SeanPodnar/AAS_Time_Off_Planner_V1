// FR-55 follow-ups: reminders for approvals left waiting, escalation to HR, and backup approvers.
import { z } from "zod";
import { withTenant, writeAudit } from "../tenancy";
import { sendEmail, type Email } from "../mailer";
import { NotAllowed, type Actor } from "../people";
import { addDays, todayIn, weekday, type ISODate } from "../accrual/dates";
import type { Company, Result, Errors } from "./service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const d = (v: unknown): ISODate => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/** Business days (Monday to Friday) after `from` up to and including `to`. Company holidays come with FR-41. */
export function businessDaysBetween(from: ISODate, to: ISODate): number {
  let n = 0;
  for (let x = addDays(from, 1); x <= to; x = addDays(x, 1)) if (weekday(x) <= 5) n++;
  return n;
}

// Backups -----------------------------------------------------------------------------------

export const backupInput = z.object({
  approverId: z.string().regex(UUID, "Choose whose approvals to cover."),
  backupId: z.string().regex(UUID, "Choose a backup."),
  startDate: z.string().refine(validDate, "Enter the first day."),
  endDate: z.string().refine(validDate, "Enter the last day."),
});

/**
 * Sets a backup for an approver's steps over a date range. Approvers set their own; HR admins
 * can set one for anyone. The backup must be an active person in the company.
 */
export async function setBackup(company: Company, actor: Actor, raw: unknown): Promise<Result<{ id: string }>> {
  const parsed = backupInput.safeParse(raw ?? {});
  if (!parsed.success) {
    const errors: Errors = {};
    for (const i of parsed.error.issues) errors[String(i.path[0] ?? "form")] ??= i.message;
    return { ok: false, errors };
  }
  const b = parsed.data;
  if (b.approverId !== actor.personId && actor.role !== "admin") throw new NotAllowed("Only HR can set a backup for someone else");
  if (b.endDate < b.startDate) return { ok: false, errors: { endDate: "The last day can't be before the first day." } };
  if (addDays(b.startDate, 366) < b.endDate) return { ok: false, errors: { endDate: "Set a backup for up to a year at a time." } };
  if (b.endDate < todayIn(company.timeZone)) return { ok: false, errors: { endDate: "Those dates are in the past." } };
  if (b.backupId === b.approverId) return { ok: false, errors: { backupId: "Choose someone else as the backup." } };
  return withTenant(company.tenantId, async (tx): Promise<Result<{ id: string }>> => {
    const people = await tx`select id, status from people where id = any(${[b.approverId, b.backupId]}::uuid[])`;
    const backup = people.find((p) => p.id === b.backupId);
    if (!people.some((p) => p.id === b.approverId)) return { ok: false, errors: { approverId: "That person no longer exists." } };
    if (!backup || backup.status !== "active") return { ok: false, errors: { backupId: "Choose an active person." } };
    const [overlap] = await tx`select 1 as x from approval_backups where approver_id = ${b.approverId} and start_date <= ${b.endDate} and end_date >= ${b.startDate}`;
    if (overlap) return { ok: false, errors: { startDate: "A backup is already set for some of these dates. Remove it first." } };
    const [row] = await tx`insert into approval_backups (tenant_id, approver_id, backup_id, start_date, end_date, created_by)
                           values (${company.tenantId}, ${b.approverId}, ${b.backupId}, ${b.startDate}, ${b.endDate}, ${actor.personId}) returning id`;
    await writeAudit(tx, `person:${actor.personId}`, "approval.backup_set", { id: row.id, ...b });
    return { ok: true, id: row.id };
  });
}

export type BackupRow = { id: string; approverId: string; approverName: string; backupId: string; backupName: string; startDate: ISODate; endDate: ISODate };

/** Current and future backups: the person's own (as approver or backup), or all of them for HR. */
export async function listBackups(company: Company, actor: Actor): Promise<BackupRow[]> {
  return withTenant(company.tenantId, async (tx) => {
    const rows = await tx`
      select b.id, b.approver_id, a.full_name as approver_name, b.backup_id, k.full_name as backup_name, b.start_date, b.end_date
        from approval_backups b join people a on a.id = b.approver_id join people k on k.id = b.backup_id
       where b.end_date >= ${todayIn(company.timeZone)}
         and (${actor.role === "admin"} or b.approver_id = ${actor.personId} or b.backup_id = ${actor.personId})
       order by b.start_date, a.full_name`;
    return rows.map((r) => ({ id: r.id, approverId: r.approver_id, approverName: r.approver_name, backupId: r.backup_id, backupName: r.backup_name, startDate: d(r.start_date), endDate: d(r.end_date) }));
  });
}

export async function removeBackup(company: Company, actor: Actor, id: string): Promise<Result> {
  if (!UUID.test(id)) return { ok: false, errors: { form: "That backup no longer exists." } };
  return withTenant(company.tenantId, async (tx): Promise<Result> => {
    const [b] = await tx`select approver_id from approval_backups where id = ${id}`;
    if (!b) return { ok: false, errors: { form: "That backup no longer exists." } };
    if (b.approver_id !== actor.personId && actor.role !== "admin") throw new NotAllowed("Not your backup");
    await tx`delete from approval_backups where id = ${id}`;
    await writeAudit(tx, `person:${actor.personId}`, "approval.backup_removed", { id });
    return { ok: true };
  });
}

// Reminders and escalation ----------------------------------------------------------------

/**
 * Sends one reminder to the approver (and any active backup) once a step has waited
 * `reminder_after_days` business days, and tells HR once it has waited `escalate_after_days`.
 * Steps already waiting on HR get the reminder only. Safe to run as often as you like:
 * each step is reminded and escalated at most once.
 */
export async function sendFollowUps(company: Company, now = new Date()): Promise<{ reminded: number; escalated: number }> {
  const today = todayIn(company.timeZone, now);
  const out: Email[] = [];
  const res = await withTenant(company.tenantId, async (tx) => {
    const [cfg] = await tx`select reminder_after_days, escalate_after_days from tenant_settings`;
    const remindAfter = cfg ? Number(cfg.reminder_after_days) : 2, escalateAfter = cfg ? Number(cfg.escalate_after_days) : 5;
    const steps = await tx`
      select s.id, s.role, s.approver_id, s.pending_since, s.reminded_at, s.escalated_at, a.email as approver_email, a.full_name as approver_name,
             r.id as request_id, r.person_id, r.start_date, r.end_date, p.full_name as person_name
        from approval_steps s join requests r on r.id = s.request_id join people p on p.id = r.person_id left join people a on a.id = s.approver_id
       where s.status = 'pending' and r.status = 'pending' and s.pending_since is not null and (s.reminded_at is null or (s.escalated_at is null and s.role <> 'admin'))
       for update of s skip locked`;
    let reminded = 0, escalated = 0;
    const admins = async (except: string) => (await tx`select email from people where role = 'admin' and status = 'active' and id <> ${except}`).map((r) => r.email as string);
    const dates = (s: unknown, e: unknown) => (d(s) === d(e) ? d(s) : `${d(s)} to ${d(e)}`);
    const link = company.baseUrl ? `\n\nReview it: ${company.baseUrl}/approvals` : "";
    for (const st of steps) {
      const waited = businessDaysBetween(todayIn(company.timeZone, new Date(st.pending_since)), today);
      if (st.role !== "admin" && !st.escalated_at && waited >= escalateAfter) {
        for (const to of await admins(st.person_id)) {
          out.push({ to, subject: `${company.label}: approval waiting ${waited} business days`, text: `${st.person_name}'s time off (${dates(st.start_date, st.end_date)}) has waited ${waited} business days for ${st.approver_name}. As HR you can decide it from the Approvals page.${link}` });
        }
        await tx`update approval_steps set escalated_at = now(), reminded_at = coalesce(reminded_at, now()) where id = ${st.id}`;
        await writeAudit(tx, "system:followups", "approval.escalated", { requestId: st.request_id, stepId: st.id, waited });
        escalated++;
      } else if (!st.reminded_at && waited >= remindAfter) {
        let to: string[];
        if (st.role === "admin") to = await admins(st.person_id);
        else {
          const backups = (await tx`select p.email from approval_backups b join people p on p.id = b.backup_id
                                    where b.approver_id = ${st.approver_id} and ${today} between b.start_date and b.end_date and p.status = 'active' and p.id <> ${st.person_id}`).map((r) => r.email as string);
          to = [st.approver_email, ...backups];
        }
        for (const email of to) out.push({ to: email, subject: `${company.label}: reminder, time off request from ${st.person_name}`, text: `${st.person_name}'s time off (${dates(st.start_date, st.end_date)}) is still waiting for a decision.${link}` });
        await tx`update approval_steps set reminded_at = now() where id = ${st.id}`;
        reminded++;
      }
    }
    return { reminded, escalated };
  });
  for (const e of out) await sendEmail(e);
  return res;
}
