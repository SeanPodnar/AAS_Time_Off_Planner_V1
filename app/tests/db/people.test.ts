import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb, resetDb } from "./helpers";
import { closeDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { withTenant } from "@/lib/tenancy";
import { getPerson, getSettings, listPeople, listTeamsAndLocations, NotAllowed, savePerson, saveSettings, setStatus, type Actor } from "@/lib/people";

describe.skipIf(!hasDb)("people management", () => {
  let A: string, B: string, admin: Actor, daniel: string, maya: string, liam: string;
  const base = { jobTitle: "", employeeNumber: "", jurisdiction: "CA-ON", hireDate: "2022-01-10", managerId: "", secondaryManagerIds: [], teamName: "", locationName: "", role: "employee", hoursPerDay: "8", workDays: ["1", "2", "3", "4", "5"] };

  beforeAll(async () => {
    await resetDb();
    const t = { customDomain: "", brandColor: "#2b6cb0" };
    A = ((await createTenant({ ...t, legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", country: "CA" }, "t")) as { id: string }).id;
    B = ((await createTenant({ ...t, legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", country: "US" }, "t")) as { id: string }).id;
    const priya = await withTenant(A, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, role) values (${A}, 'Priya Shah', 'priya@nw.example', 'CA-ON', '2019-09-09', 'admin') returning id`)[0].id);
    admin = { personId: priya, role: "admin" };
  });
  afterAll(closeDb);

  it("lets only HR admins manage people", async () => {
    const employee: Actor = { personId: admin.personId, role: "employee" };
    await expect(listPeople(A, employee)).rejects.toBeInstanceOf(NotAllowed);
    await expect(savePerson(A, employee, { ...base, fullName: "X", email: "x@nw.example" })).rejects.toBeInstanceOf(NotAllowed);
    await expect(setStatus(A, employee, admin.personId, "inactive")).rejects.toBeInstanceOf(NotAllowed);
  });

  it("adds people with team, location, part-time schedule and managers, creating teams and locations by name", async () => {
    const d = await savePerson(A, admin, { ...base, fullName: "Daniel Okafor", email: "Daniel@NW.example", teamName: "Product", locationName: "Toronto", hoursPerDay: "7.5" });
    expect(d.ok).toBe(true); daniel = (d as { id: string }).id;
    const m = await savePerson(A, admin, { ...base, fullName: "Maya Chen", email: "maya@nw.example", managerId: daniel, teamName: "product ", workDays: ["1", "3", "5"], hoursPerDay: "6" });
    maya = (m as { id: string }).id;
    const l = await savePerson(A, admin, { ...base, fullName: "Liam Tremblay", email: "liam@nw.example", jurisdiction: "CA-QC", managerId: daniel, secondaryManagerIds: [maya] });
    liam = (l as { id: string }).id;
    const row = (await getPerson(A, admin, maya))!;
    expect(row).toMatchObject({ email: "maya@nw.example", managerName: "Daniel Okafor", team: "Product", workDays: [1, 3, 5], hoursPerDay: 6 });
    expect((await getPerson(A, admin, daniel))!.email).toBe("daniel@nw.example");
    expect((await getPerson(A, admin, liam))!.secondaryManagerIds).toEqual([maya]);
    expect(await listTeamsAndLocations(A)).toEqual({ teams: ["Product"], locations: ["Toronto"] });
  });

  it("refuses duplicate emails and employee numbers with a message on the field", async () => {
    expect(await savePerson(A, admin, { ...base, fullName: "Copy", email: "MAYA@nw.example" })).toEqual({ ok: false, errors: { email: "Someone at this company already uses this email." } });
    await savePerson(A, admin, { ...(await asInput(daniel)), employeeNumber: "E100" }, daniel);
    expect(await savePerson(A, admin, { ...base, fullName: "Other", email: "other@nw.example", employeeNumber: "E100" })).toEqual({ ok: false, errors: { employeeNumber: "Another person already has this employee number." } });
  });

  it("validates input", async () => {
    const r = await savePerson(A, admin, { ...base, fullName: "", email: "bad", jurisdiction: "CA-XX", hoursPerDay: "0", workDays: [] });
    expect(r.ok).toBe(false);
    expect(Object.keys((r as { errors: Record<string, string> }).errors).sort()).toEqual(["email", "fullName", "hoursPerDay", "jurisdiction", "workDays"]);
  });

  it("blocks self-management and management loops", async () => {
    expect(await savePerson(A, admin, { ...(await asInput(daniel)), managerId: daniel }, daniel)).toMatchObject({ ok: false, errors: { managerId: expect.stringMatching(/own manager/) } });
    expect(await savePerson(A, admin, { ...(await asInput(daniel)), managerId: maya }, daniel)).toMatchObject({ ok: false, errors: { managerId: expect.stringMatching(/loop/) } });
  });

  it("refuses a manager from another company", async () => {
    const emily = await withTenant(B, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date) values (${B}, 'Emily Park', 'emily@hp.example', 'US-CA', '2022-01-10') returning id`)[0].id);
    expect(await savePerson(A, admin, { ...(await asInput(maya)), managerId: emily }, maya)).toMatchObject({ ok: false, errors: { managerId: "Choose a manager from this company." } });
    expect(await savePerson(A, admin, { ...(await asInput(maya)), secondaryManagerIds: [emily] }, maya)).toMatchObject({ ok: false });
    expect(await getPerson(A, admin, emily)).toBeNull();
    expect((await listPeople(B, admin)).map((p) => p.fullName)).toEqual(["Emily Park"]);
  });

  it("searches by name, team, location and manager, and filters by status", async () => {
    expect((await listPeople(A, admin, { q: "tremblay" })).map((p) => p.fullName)).toEqual(["Liam Tremblay"]);
    expect((await listPeople(A, admin, { q: "product" })).map((p) => p.fullName)).toEqual(["Daniel Okafor", "Maya Chen"]);
    expect((await listPeople(A, admin, { q: "okafor" })).map((p) => p.fullName)).toEqual(["Daniel Okafor", "Liam Tremblay", "Maya Chen"]);
    expect((await listPeople(A, admin, { q: "%" }))).toHaveLength(0);
  });

  it("deactivates people, ends their sessions, and protects the last HR admin", async () => {
    await withTenant(A, (tx) => tx`insert into sessions (tenant_id, person_id, token_hash, method, expires_at) values (${A}, ${liam}, ${Buffer.alloc(32, 1)}, 'email_link', now() + interval '1 hour')`);
    expect(await setStatus(A, admin, liam, "inactive")).toEqual({ ok: true });
    const [s] = await withTenant(A, (tx) => tx`select revoked_at from sessions where person_id = ${liam}`);
    expect(s.revoked_at).not.toBeNull();
    expect((await listPeople(A, admin)).map((p) => p.fullName)).not.toContain("Liam Tremblay");
    expect((await listPeople(A, admin, { status: "inactive" })).map((p) => p.fullName)).toEqual(["Liam Tremblay"]);
    expect(await setStatus(A, admin, admin.personId, "inactive")).toMatchObject({ ok: false });
    expect(await savePerson(A, admin, { ...(await asInput(admin.personId)), role: "employee" }, admin.personId)).toMatchObject({ ok: false, errors: { role: expect.any(String) } });
    expect(await setStatus(A, admin, liam, "active")).toEqual({ ok: true });
  });

  it("records changes in the audit log with what changed", async () => {
    await savePerson(A, admin, { ...(await asInput(maya)), jobTitle: "Senior Designer" }, maya);
    const [entry] = await withTenant(A, (tx) => tx`select detail from audit_log where action = 'person.updated' order by at desc limit 1`);
    expect(entry.detail.changed).toEqual({ jobTitle: { from: null, to: "Senior Designer" } });
  });

  it("stores company settings with sensible defaults", async () => {
    expect(await getSettings(A, "CA")).toEqual({ timeZone: "America/Toronto", secondApprovalThreshold: 10 });
    expect(await saveSettings(A, admin, { timeZone: "Mars/Base", secondApprovalThreshold: "10" })).toMatchObject({ ok: false, errors: { timeZone: expect.any(String) } });
    expect(await saveSettings(A, admin, { timeZone: "America/Vancouver", secondApprovalThreshold: "15" })).toEqual({ ok: true });
    expect(await getSettings(A, "CA")).toEqual({ timeZone: "America/Vancouver", secondApprovalThreshold: 15 });
    expect(await getSettings(B, "US")).toEqual({ timeZone: "America/New_York", secondApprovalThreshold: 10 });
  });

  async function asInput(id: string) {
    const p = (await getPerson(A, admin, id))!;
    return { fullName: p.fullName, email: p.email, jobTitle: p.jobTitle ?? "", employeeNumber: p.employeeNumber ?? "", jurisdiction: p.jurisdiction,
      hireDate: p.hireDate, managerId: p.managerId ?? "", secondaryManagerIds: p.secondaryManagerIds, teamName: p.team ?? "", locationName: p.location ?? "",
      role: p.role, hoursPerDay: String(p.hoursPerDay), workDays: p.workDays.map(String) };
  }
});
