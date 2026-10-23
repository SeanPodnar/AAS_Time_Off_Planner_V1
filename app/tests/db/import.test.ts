import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb, resetDb } from "./helpers";
import { closeDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { withTenant } from "@/lib/tenancy";
import { getPerson, listPeople, NotAllowed, type Actor } from "@/lib/people";
import { commitImport, previewImport } from "@/lib/importPeople";

const csv = (s: string) => Buffer.from(s.trim() + "\n");
const H = "full_name,email,start_date,province_or_state,team,manager_email,other_manager_emails,role,hours_per_day,work_days";

describe.skipIf(!hasDb)("bulk import of people", () => {
  let A: string, B: string, admin: Actor;
  beforeAll(async () => {
    await resetDb();
    const t = { customDomain: "", brandColor: "#2b6cb0" };
    A = ((await createTenant({ ...t, legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", country: "CA" }, "t")) as { id: string }).id;
    B = ((await createTenant({ ...t, legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", country: "US" }, "t")) as { id: string }).id;
    const priya = await withTenant(A, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, role) values (${A}, 'Priya Shah', 'priya@nw.example', 'CA-ON', '2019-09-09', 'admin') returning id`)[0].id);
    admin = { personId: priya, role: "admin" };
    await withTenant(B, (tx) => tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date) values (${B}, 'Emily Park', 'emily@hp.example', 'US-CA', '2022-01-10')`);
  });
  afterAll(closeDb);

  it("is HR admin only", async () => {
    await expect(previewImport(A, { ...admin, role: "employee" }, "p.csv", csv(H))).rejects.toBeInstanceOf(NotAllowed);
    await expect(commitImport(A, { ...admin, role: "employee" }, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(NotAllowed);
  });

  it("previews without saving, then creates people with managers defined later in the same file", async () => {
    const file = csv(`${H}
Maya Chen,maya@nw.example,2021-03-15,ON,Product,daniel@nw.example,,employee,7.5,Mon-Fri
Daniel Okafor,DANIEL@nw.example,2017-06-01,Ontario,Product,,,employee,,
Liam Tremblay,liam@nw.example,2023-02-01,QC,Product,daniel@nw.example,maya@nw.example,,8,"Mon,Wed,Fri"`);
    const p = await previewImport(A, admin, "people.csv", file);
    expect(p.ok && p.preview.counts).toEqual({ create: 3, update: 0, unchanged: 0, error: 0 });
    expect((await listPeople(A, admin)).map((x) => x.fullName)).toEqual(["Priya Shah"]);
    const c = await commitImport(A, admin, (p as { batchId: string }).batchId);
    expect(c).toEqual({ ok: true, counts: { create: 3, update: 0, unchanged: 0 } });
    const people = await listPeople(A, admin);
    const liam = people.find((x) => x.fullName === "Liam Tremblay")!;
    expect(liam).toMatchObject({ jurisdiction: "CA-QC", managerName: "Daniel Okafor", workDays: [1, 3, 5], team: "Product" });
    expect(liam.secondaryManagerIds).toEqual([people.find((x) => x.fullName === "Maya Chen")!.id]);
    expect(people.find((x) => x.fullName === "Maya Chen")!.hoursPerDay).toBe(7.5);
  });

  it("can't reuse a batch, and batches expire", async () => {
    const p = await previewImport(A, admin, "x.csv", csv(`${H}\nNew One,new1@nw.example,2024-01-01,ON,,,,,,`));
    const id = (p as { batchId: string }).batchId;
    expect(await commitImport(A, admin, id, new Date(Date.now() + 61 * 60_000))).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    expect((await commitImport(A, admin, id)).ok).toBe(true);
    expect(await commitImport(A, admin, id)).toMatchObject({ ok: false });
  });

  it("updates only the columns in the file, and reports what will change", async () => {
    const p = await previewImport(A, admin, "titles.csv", csv(`email,job_title\nmaya@nw.example,Senior Designer\ndaniel@nw.example,`));
    expect(p.ok && p.preview.rows.map((r) => [r.email, r.action, r.changes])).toEqual([
      ["maya@nw.example", "update", ["Job title: none → Senior Designer"]],
      ["daniel@nw.example", "unchanged", []],
    ]);
    await commitImport(A, admin, (p as { batchId: string }).batchId);
    const maya = (await listPeople(A, admin)).find((x) => x.email === "maya@nw.example")!;
    expect(maya).toMatchObject({ jobTitle: "Senior Designer", managerName: "Daniel Okafor", hoursPerDay: 7.5 });
  });

  it("shows row-level errors and saves nothing when any row has a problem", async () => {
    const p = await previewImport(A, admin, "bad.csv", csv(`${H}
Ok Person,ok@nw.example,2024-01-01,ON,,,,,,
,noname@nw.example,2024-01-01,ON,,,,,,
Bad Province,bp@nw.example,2024-01-01,Atlantis,,,,,,
Bad Date,bd@nw.example,15/01/2024,ON,,,,,,
Bad Days,bdays@nw.example,2024-01-01,ON,,,,,,weekdays
Ghost Manager,gm@nw.example,2024-01-01,ON,,nobody@nw.example,,,,
Other Company Manager,ocm@nw.example,2024-01-01,ON,,emily@hp.example,,,,
Dup,ok@nw.example,2024-01-01,ON,,,,,,`));
    const rows = (p as { preview: { rows: { line: number; action: string; errors: string[] }[] } }).preview.rows;
    const errs = Object.fromEntries(rows.map((r) => [r.line, r.errors.join(" | ")]));
    expect(rows[0].action).toBe("create");
    expect(errs[3]).toMatch(/name/);
    expect(errs[4]).toMatch(/Atlantis/);
    expect(errs[5]).toMatch(/YYYY-MM-DD/);
    expect(errs[6]).toMatch(/weekdays/);
    expect(errs[7]).toMatch(/nobody@nw.example isn't in this file/);
    expect(errs[8]).toMatch(/emily@hp.example isn't in this file/);
    expect(errs[9]).toMatch(/line 2/);
    const c = await commitImport(A, admin, (p as { batchId: string }).batchId);
    expect(c.ok).toBe(false);
    expect((await listPeople(A, admin)).map((x) => x.email)).not.toContain("ok@nw.example");
  });

  it("refuses management loops and removing the last HR admin", async () => {
    const loop = await previewImport(A, admin, "loop.csv", csv(`email,manager_email\ndaniel@nw.example,maya@nw.example`));
    expect((loop as { preview: { rows: { errors: string[] }[] } }).preview.rows[0].errors.join()).toMatch(/loop/);
    const demote = await previewImport(A, admin, "demote.csv", csv(`email,role\npriya@nw.example,employee`));
    expect((demote as { preview: { rows: { errors: string[] }[] } }).preview.rows[0].errors.join()).toMatch(/no active HR admin/);
  });

  it("keeps each company's import separate and audit-logs the result", async () => {
    // An admin from one company can't stage an import in another: the database refuses it.
    await expect(previewImport(B, { personId: admin.personId, role: "admin" }, "x.csv", csv(`email,job_title\nmaya@nw.example,Spy`)))
      .rejects.toMatchObject({ code: "23503" });
    const [log] = await withTenant(A, (tx) => tx`select detail from audit_log where action = 'people.imported' order by at limit 1`);
    expect(log.detail).toMatchObject({ filename: "people.csv", create: 3, created: ["maya@nw.example", "daniel@nw.example", "liam@nw.example"] });
    expect(await getPerson(B, admin, (await listPeople(A, admin))[0].id)).toBeNull();
  });
});
