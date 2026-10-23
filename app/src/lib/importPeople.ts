// Bulk import of people from CSV or XLSX: parse, preview with row-level errors, then apply
// everything in one transaction. Nothing is saved until an HR admin confirms the preview.
//
// Matching is by email. On update, only the columns present in the file change; a column
// that is present but blank clears the value (for example an empty manager_email removes the manager).
import readXlsxFile from "read-excel-file/node";
import type postgres from "postgres";
import { withTenant, writeAudit } from "./tenancy";
import { personInput, NotAllowed, type Actor } from "./people";
import { PROVINCES, STATES, WEEKDAYS } from "./jurisdictions";

export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 1000;
const BATCH_TTL_MS = 60 * 60_000;

export const COLUMNS = [
  "full_name", "email", "job_title", "employee_number", "start_date", "province_or_state", "team", "location",
  "manager_email", "other_manager_emails", "role", "hours_per_day", "work_days",
] as const;
type Column = (typeof COLUMNS)[number];
const REQUIRED_FOR_NEW: Column[] = ["full_name", "email", "start_date", "province_or_state"];

const ALIASES: Record<string, Column> = {
  name: "full_name", fullname: "full_name", full_name: "full_name", employee: "full_name",
  email: "email", work_email: "email", email_address: "email",
  job_title: "job_title", title: "job_title", position: "job_title",
  employee_number: "employee_number", employee_no: "employee_number", employee_id: "employee_number", payroll_id: "employee_number",
  start_date: "start_date", hire_date: "start_date", started: "start_date",
  province_or_state: "province_or_state", province: "province_or_state", state: "province_or_state", jurisdiction: "province_or_state",
  team: "team", department: "team", location: "location", office: "location",
  manager_email: "manager_email", manager: "manager_email",
  other_manager_emails: "other_manager_emails", other_managers: "other_manager_emails", secondary_managers: "other_manager_emails",
  role: "role", hours_per_day: "hours_per_day", hours: "hours_per_day", work_days: "work_days", days: "work_days",
};

export const TEMPLATE_CSV =
  COLUMNS.join(",") + "\n" +
  "Maya Chen,maya@example.com,Product Designer,E1001,2021-03-15,ON,Product,Toronto,daniel@example.com,,employee,7.5,Mon-Fri\n" +
  "Liam Tremblay,liam@example.com,Data Engineer,E1002,2023-02-01,QC,Product,Montreal,daniel@example.com,maya@example.com,employee,8,\"Mon,Wed,Fri\"\n";

// Parsing -----------------------------------------------------------------------------------

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v);
}

export type ParseResult = { ok: true; header: Column[]; present: Column[]; unknown: string[]; rows: string[][] } | { ok: false; error: string };

export async function parseFile(filename: string, bytes: Buffer): Promise<ParseResult> {
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > MAX_BYTES) return { ok: false, error: "The file is over 2 MB. Split it into smaller files." };
  let table: string[][];
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) table = parseCsv(bytes.toString("utf8"));
  else if (lower.endsWith(".xlsx")) {
    try {
      const sheets = (await readXlsxFile(bytes)) as unknown as { data: unknown[][] }[];
      table = (sheets[0]?.data ?? []).map((r) => r.map(cellText)).filter((r) => r.some((x) => x.trim() !== ""));
    } catch {
      return { ok: false, error: "That file couldn't be read as an Excel workbook. Save it as .xlsx or .csv and try again." };
    }
  } else return { ok: false, error: "Upload a .csv or .xlsx file." };
  if (table.length < 2) return { ok: false, error: "The file needs a header row and at least one person." };
  if (table.length - 1 > MAX_ROWS) return { ok: false, error: `The file has ${table.length - 1} rows. The limit is ${MAX_ROWS} per file.` };
  const unknown: string[] = [];
  const header = table[0].map((h) => {
    const key = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const col = ALIASES[key];
    if (!col && key) unknown.push(h.trim());
    return col;
  }) as Column[];
  const seen = header.filter(Boolean);
  const dupe = seen.find((c, i) => seen.indexOf(c) !== i);
  if (dupe) return { ok: false, error: `The column "${dupe}" appears twice.` };
  if (!seen.includes("email")) return { ok: false, error: "The file needs an email column. Download the template to see the expected columns." };
  return { ok: true, header, present: [...new Set(seen)], unknown, rows: table.slice(1) };
}

// Normalising -----------------------------------------------------------------------------

const PROVINCE_BY_NAME = Object.fromEntries(Object.entries(PROVINCES).map(([k, v]) => [v.toLowerCase(), `CA-${k}`]));
const STATE_BY_NAME = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [v.toLowerCase(), `US-${k}`]));

export function toJurisdiction(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const up = s.toUpperCase();
  if (/^(CA|US)-[A-Z]{2}$/.test(up)) return (up.startsWith("CA-") ? PROVINCES[up.slice(3)] : STATES[up.slice(3)]) ? up : null;
  if (PROVINCES[up]) return `CA-${up}`; // province and state codes do not overlap
  if (STATES[up]) return `US-${up}`;
  return PROVINCE_BY_NAME[s.toLowerCase()] ?? STATE_BY_NAME[s.toLowerCase()] ?? null;
}

export function toWorkDays(v: string): number[] | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  const idx = (t: string) => {
    if (/^[1-7]$/.test(t)) return Number(t);
    const i = WEEKDAYS.findIndex((d) => d.short.toLowerCase() === t.slice(0, 3));
    return i >= 0 ? i + 1 : -1;
  };
  const days = new Set<number>();
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const range = part.split(/-|to/).filter(Boolean);
    if (range.length === 2) {
      const [a, b] = range.map(idx);
      if (a < 0 || b < 0 || b < a) return null;
      for (let d = a; d <= b; d++) days.add(d);
    } else {
      const d = idx(part);
      if (d < 0) return null;
      days.add(d);
    }
  }
  return [...days].sort();
}

const emails = (v: string) => v.split(/[;,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);

// Preview ---------------------------------------------------------------------------------

export type PreviewRow = {
  line: number; email: string; fullName: string;
  action: "create" | "update" | "unchanged" | "error";
  errors: string[]; changes: string[];
};
export type Preview = { rows: PreviewRow[]; counts: Record<PreviewRow["action"], number>; unknownColumns: string[] };

type Existing = {
  id: string; full_name: string; email: string; job_title: string | null; employee_number: string | null; hire_date: string;
  jurisdiction: string; team: string | null; location: string | null; manager_email: string | null; others: string[];
  role: "employee" | "admin"; status: string; hours_per_day: string; work_days: number[];
};

type Planned = {
  line: number; email: string; existing?: Existing; errors: string[];
  fullName: string; jobTitle: string | null; employeeNumber: string | null; hireDate: string; jurisdiction: string;
  team: string | null; location: string | null; managerEmail: string | null; others: string[] | null;
  role: "employee" | "admin"; hoursPerDay: number; workDays: number[];
};

async function loadExisting(tx: postgres.TransactionSql): Promise<Map<string, Existing>> {
  const rows = await tx`
    select p.id, p.full_name, p.email, p.job_title, p.employee_number, p.hire_date::text as hire_date, p.jurisdiction,
           t.name as team, l.name as location, m.email as manager_email, p.role, p.status, p.hours_per_day, p.work_days,
           coalesce((select array_agg(lower(o.email) order by lower(o.email)) from person_managers pm join people o on o.id = pm.manager_id where pm.person_id = p.id), '{}') as others
      from people p left join teams t on t.id = p.team_id left join locations l on l.id = p.location_id left join people m on m.id = p.manager_id`;
  return new Map(rows.map((r) => [String(r.email).toLowerCase(), { ...(r as unknown as Existing), work_days: (r.work_days as number[]).map(Number) }]));
}

function plan(header: Column[], present: Column[], rows: string[][], existing: Map<string, Existing>): Planned[] {
  const has = (c: Column) => present.includes(c);
  const out: Planned[] = [];
  const seenEmails = new Map<string, number>();
  rows.forEach((cells, i) => {
    const line = i + 2;
    const get = (c: Column) => (cells[header.indexOf(c)] ?? "").trim();
    const email = get("email").toLowerCase();
    const ex = existing.get(email);
    const errors: string[] = [];
    if (seenEmails.has(email)) errors.push(`This email is also on line ${seenEmails.get(email)}.`);
    else if (email) seenEmails.set(email, line);
    if (!ex) for (const c of REQUIRED_FOR_NEW) if (!has(c) || !get(c)) errors.push(`New people need ${c.replace(/_/g, " ")}.`);
    const pick = (c: Column, current: string | null) => (has(c) ? get(c) || null : current);

    const jurRaw = pick("province_or_state", ex?.jurisdiction ?? null);
    const jurisdiction = jurRaw ? toJurisdiction(jurRaw) : null;
    if (jurRaw && !jurisdiction) errors.push(`"${jurRaw}" isn't a Canadian province or territory or a US state.`);
    const daysRaw = has("work_days") ? get("work_days") : "";
    const workDays = daysRaw ? toWorkDays(daysRaw) : ex?.work_days ?? [1, 2, 3, 4, 5];
    if (!workDays) errors.push(`Work days "${daysRaw}" weren't understood. Use for example Mon-Fri or Mon,Wed,Fri.`);
    const roleRaw = has("role") ? get("role").toLowerCase() : "";
    const role = !roleRaw ? ex?.role ?? "employee" : /admin/.test(roleRaw) ? "admin" : roleRaw === "employee" ? "employee" : null;
    if (!role) errors.push(`Role "${get("role")}" should be employee or HR admin.`);
    const hireDate = pick("start_date", ex?.hire_date ?? null) ?? "";
    if (hireDate && !/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) errors.push(`Start date "${hireDate}" should be written as YYYY-MM-DD.`);
    const hoursRaw = has("hours_per_day") && get("hours_per_day") ? get("hours_per_day") : String(ex?.hours_per_day ?? 8);
    const p: Planned = {
      line, email, existing: ex, errors,
      fullName: pick("full_name", ex?.full_name ?? null) ?? "",
      jobTitle: pick("job_title", ex?.job_title ?? null), employeeNumber: pick("employee_number", ex?.employee_number ?? null),
      hireDate, jurisdiction: jurisdiction ?? "", team: pick("team", ex?.team ?? null), location: pick("location", ex?.location ?? null),
      managerEmail: has("manager_email") ? get("manager_email").toLowerCase() || null : ex?.manager_email?.toLowerCase() ?? null,
      others: has("other_manager_emails") ? emails(get("other_manager_emails")) : null,
      role: role ?? "employee", hoursPerDay: Number(hoursRaw), workDays: workDays ?? [1],
    };
    const check = personInput.safeParse({
      fullName: p.fullName, email, jobTitle: p.jobTitle ?? "", employeeNumber: p.employeeNumber ?? "", jurisdiction: p.jurisdiction || "XX",
      hireDate: p.hireDate || "x", managerId: "", secondaryManagerIds: [], teamName: p.team ?? "", locationName: p.location ?? "",
      role: p.role, hoursPerDay: hoursRaw, workDays: p.workDays,
    });
    if (!check.success) {
      for (const issue of check.error.issues) {
        const k = String(issue.path[0]);
        if ((k === "jurisdiction" && jurRaw) || (k === "hireDate" && hireDate) || (k === "workDays" && !workDays)) continue;
        if (!errors.includes(issue.message)) errors.push(issue.message);
      }
    }
    out.push(p);
  });
  return out;
}

/** Checks that need the whole file and the current company: managers, loops, numbers, last admin. */
function crossCheck(planned: Planned[], existing: Map<string, Existing>) {
  const finalManager = new Map<string, string | null>();
  const finalActive = new Map<string, boolean>();
  for (const [email, e] of existing) { finalManager.set(email, e.manager_email?.toLowerCase() ?? null); finalActive.set(email, e.status === "active"); }
  for (const p of planned) { finalManager.set(p.email, p.managerEmail); if (!p.existing) finalActive.set(p.email, true); }

  const fileNumbers = new Map<string, number>();

  for (const p of planned) {
    const managers = [p.managerEmail, ...(p.others ?? [])].filter(Boolean) as string[];
    for (const m of managers) {
      if (m === p.email) p.errors.push("A person can't be their own manager.");
      else if (!finalManager.has(m)) p.errors.push(`Manager ${m} isn't in this file or in the company.`);
      else if (!finalActive.get(m)) p.errors.push(`Manager ${m} is inactive.`);
    }
    // Loop: follow the final manager chain from this person.
    const seen = new Set([p.email]);
    for (let cur = p.managerEmail; cur; cur = finalManager.get(cur) ?? null) {
      if (seen.has(cur)) { if (cur === p.email) p.errors.push("This would make a management loop."); break; }
      seen.add(cur);
    }
    if (p.employeeNumber) {
      const owner = [...existing.values()].find((e) => e.employee_number === p.employeeNumber && e.email.toLowerCase() !== p.email);
      if (owner && !planned.some((q) => q.email === owner.email.toLowerCase() && q.employeeNumber !== p.employeeNumber)) p.errors.push(`Employee number ${p.employeeNumber} belongs to ${owner.email}.`);
      if (fileNumbers.has(p.employeeNumber)) p.errors.push(`Employee number ${p.employeeNumber} is also on line ${fileNumbers.get(p.employeeNumber)}.`);
      else fileNumbers.set(p.employeeNumber, p.line);
    }
  }
  const admins = new Set([...existing.values()].filter((e) => e.role === "admin" && e.status === "active").map((e) => e.email.toLowerCase()));
  for (const p of planned) { if (p.role === "admin") admins.add(p.email); else admins.delete(p.email); }
  if (admins.size === 0) for (const p of planned) if (p.existing?.role === "admin") p.errors.push("This would leave the company with no active HR admin.");
}

function changesFor(p: Planned): string[] {
  const e = p.existing;
  if (!e) return [];
  const c: string[] = [];
  const cmp = (label: string, a: unknown, b: unknown) => { if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) c.push(`${label}: ${a ?? "none"} → ${b ?? "none"}`); };
  cmp("Name", e.full_name, p.fullName); cmp("Job title", e.job_title, p.jobTitle); cmp("Employee number", e.employee_number, p.employeeNumber);
  cmp("Start date", e.hire_date, p.hireDate); cmp("Province or state", e.jurisdiction, p.jurisdiction); cmp("Team", e.team, p.team);
  cmp("Location", e.location, p.location); cmp("Manager", e.manager_email?.toLowerCase() ?? null, p.managerEmail);
  if (p.others) cmp("Other managers", e.others.join(", ") || null, [...p.others].sort().join(", ") || null);
  cmp("Role", e.role, p.role); cmp("Hours per day", Number(e.hours_per_day), p.hoursPerDay); cmp("Work days", e.work_days.join(","), p.workDays.join(","));
  return c;
}

function summarise(planned: Planned[], unknownColumns: string[]): Preview {
  const rows: PreviewRow[] = planned.map((p) => {
    const changes = changesFor(p);
    const action = p.errors.length ? "error" : !p.existing ? "create" : changes.length ? "update" : "unchanged";
    return { line: p.line, email: p.email, fullName: p.fullName, action, errors: p.errors, changes };
  });
  const counts = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const r of rows) counts[r.action]++;
  return { rows, counts, unknownColumns };
}

type Stored = { header: Column[]; present: Column[]; unknown: string[]; rows: string[][] };

export type PreviewResult = { ok: true; batchId: string; preview: Preview } | { ok: false; error: string };

export async function previewImport(tenantId: string, actor: Actor, filename: string, bytes: Buffer, now = new Date()): Promise<PreviewResult> {
  if (actor.role !== "admin") throw new NotAllowed("HR admin only");
  const parsed = await parseFile(filename, bytes);
  if (!parsed.ok) return parsed;
  const stored: Stored = { header: parsed.header, present: parsed.present, unknown: parsed.unknown, rows: parsed.rows };
  return withTenant(tenantId, async (tx) => {
    const existing = await loadExisting(tx);
    const planned = plan(stored.header, stored.present, stored.rows, existing);
    crossCheck(planned, existing);
    await tx`delete from import_batches where expires_at < ${now}`;
    const [b] = await tx`insert into import_batches (tenant_id, created_by, kind, filename, rows, expires_at)
                         values (app_tenant_id(), ${actor.personId}, 'people', ${filename.slice(0, 200)}, ${tx.json(stored as unknown as postgres.JSONValue)}, ${new Date(now.getTime() + BATCH_TTL_MS)})
                         returning id`;
    return { ok: true, batchId: b.id, preview: summarise(planned, stored.unknown) } as const;
  });
}

export type CommitResult = { ok: true; counts: Record<"create" | "update" | "unchanged", number> } | { ok: false; error: string; preview?: Preview };

/** Applies a previewed file in one transaction. Re-checks against the company as it is now. */
export async function commitImport(tenantId: string, actor: Actor, batchId: string, now = new Date()): Promise<CommitResult> {
  if (actor.role !== "admin") throw new NotAllowed("HR admin only");
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return { ok: false, error: "That import has expired. Upload the file again." };
  return withTenant(tenantId, async (tx) => {
    const [b] = await tx`select filename, rows from import_batches where id = ${batchId} and created_by = ${actor.personId} and expires_at > ${now}`;
    if (!b) return { ok: false, error: "That import has expired. Upload the file again." } as const;
    const stored = b.rows as Stored;
    const existing = await loadExisting(tx);
    const planned = plan(stored.header, stored.present, stored.rows, existing);
    crossCheck(planned, existing);
    const preview = summarise(planned, stored.unknown);
    if (preview.counts.error > 0) return { ok: false, error: "Some rows have problems now. Fix them and upload again.", preview } as const;

    const nameId = async (table: "teams" | "locations", name: string | null) => {
      if (!name) return null;
      const [f] = await tx`select id from ${tx(table)} where lower(btrim(name)) = lower(btrim(${name}))`;
      return f ? f.id : (await tx`insert into ${tx(table)} (tenant_id, name) values (app_tenant_id(), ${name}) returning id`)[0].id;
    };
    const work = planned.filter((_, i) => preview.rows[i].action !== "unchanged");
    for (const p of work) {
      const teamId = await nameId("teams", p.team), locationId = await nameId("locations", p.location);
      if (p.existing) {
        await tx`update people set full_name = ${p.fullName}, job_title = ${p.jobTitle}, employee_number = ${p.employeeNumber}, hire_date = ${p.hireDate},
                   jurisdiction = ${p.jurisdiction}, team_id = ${teamId}, location_id = ${locationId}, role = ${p.role},
                   hours_per_day = ${p.hoursPerDay}, work_days = ${p.workDays}, updated_at = now()
                 where id = ${p.existing.id}`;
      } else {
        await tx`insert into people (tenant_id, full_name, email, job_title, employee_number, jurisdiction, hire_date, team_id, location_id, role, hours_per_day, work_days)
                 values (app_tenant_id(), ${p.fullName}, ${p.email}, ${p.jobTitle}, ${p.employeeNumber}, ${p.jurisdiction}, ${p.hireDate}, ${teamId}, ${locationId}, ${p.role}, ${p.hoursPerDay}, ${p.workDays})`;
      }
    }
    // Managers second, so people can manage others added in the same file.
    for (const p of work) {
      await tx`update people set manager_id = (select id from people where lower(email) = ${p.managerEmail ?? ""}) where lower(email) = ${p.email}`;
      if (p.others) {
        await tx`delete from person_managers where person_id = (select id from people where lower(email) = ${p.email})`;
        for (const m of p.others) {
          await tx`insert into person_managers (tenant_id, person_id, manager_id)
                   select app_tenant_id(), (select id from people where lower(email) = ${p.email}), id from people where lower(email) = ${m}`;
        }
      }
    }
    const counts = { create: preview.counts.create, update: preview.counts.update, unchanged: preview.counts.unchanged };
    await writeAudit(tx, `person:${actor.personId}`, "people.imported", {
      filename: b.filename, ...counts,
      created: preview.rows.filter((r) => r.action === "create").map((r) => r.email),
      updated: preview.rows.filter((r) => r.action === "update").map((r) => ({ email: r.email, changes: r.changes })),
    });
    await tx`delete from import_batches where id = ${batchId}`;
    return { ok: true, counts } as const;
  });
}
