// Company data separation. These tests talk to a real PostgreSQL database and must
// pass before anything merges to main. They check the database itself, not only the
// app code, so a forgotten filter in a future query still cannot leak data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { connect, hasDb, resetDb } from "./helpers";

describe.skipIf(!hasDb)("company data separation", () => {
  let app: postgres.Sql, platform: postgres.Sql, admin: postgres.Sql;
  let A: string, B: string, maya: string, emily: string;

  const asTenant = <T>(id: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    app.begin(async (tx) => {
      if (id) await tx`select set_config('app.tenant_id', ${id}, true)`;
      return fn(tx);
    }) as Promise<T>;

  beforeAll(async () => {
    await resetDb();
    app = connect("DATABASE_URL_APP");
    platform = connect("DATABASE_URL_PLATFORM");
    admin = connect("DATABASE_URL_ADMIN");
    [{ id: A }] = await platform`insert into tenants (legal_name, short_label, subdomain, country) values ('Northwind Analytics Inc.', 'Northwind', 'northwind', 'CA') returning id`;
    [{ id: B }] = await platform`insert into tenants (legal_name, short_label, subdomain, custom_domain, country) values ('Harbor & Pine Company LLC', 'Harbor & Pine', 'harborpine', 'pto.harborandpine.com', 'US') returning id`;
    maya = await asTenant(A, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date) values (${A}, 'Maya Chen', 'maya@nw.example', 'CA-ON', '2021-03-15') returning id`)[0].id);
    emily = await asTenant(B, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date) values (${B}, 'Emily Park', 'emily@hp.example', 'US-CA', '2022-01-10') returning id`)[0].id);
    await asTenant(A, (tx) => tx`insert into audit_log (tenant_id, actor, action) values (${A}, 'test', 'seed')`);
    await asTenant(B, (tx) => tx`insert into audit_log (tenant_id, actor, action) values (${B}, 'test', 'seed')`);
  });

  afterAll(async () => {
    await Promise.all([app?.end(), platform?.end(), admin?.end()]);
  });

  it("returns nothing when no company is set (fails closed)", async () => {
    expect(await asTenant(null, (tx) => tx`select id from people`)).toHaveLength(0);
    expect(await asTenant(null, (tx) => tx`select id from audit_log`)).toHaveLength(0);
  });

  it("shows each company only its own people and audit entries", async () => {
    const a = await asTenant(A, (tx) => tx`select id, tenant_id from people`);
    expect(a.map((r) => r.id)).toEqual([maya]);
    const b = await asTenant(B, (tx) => tx`select id from people`);
    expect(b.map((r) => r.id)).toEqual([emily]);
    expect(await asTenant(A, (tx) => tx`select tenant_id from audit_log`)).toEqual([{ tenant_id: A }]);
  });

  it("cannot read another company's row even by id", async () => {
    expect(await asTenant(A, (tx) => tx`select id from people where id = ${emily}`)).toHaveLength(0);
  });

  it("cannot insert a row for another company", async () => {
    await expect(asTenant(A, (tx) => tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date) values (${B}, 'Intruder', 'x@x.example', 'US-CA', '2024-01-01')`))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("cannot move a row to another company", async () => {
    await expect(asTenant(A, (tx) => tx`update people set tenant_id = ${B} where id = ${maya}`)).rejects.toMatchObject({ code: "42501" });
  });

  it("cannot update or delete another company's rows (they are invisible)", async () => {
    const upd = await asTenant(A, (tx) => tx`update people set full_name = 'changed' where id = ${emily}`);
    expect(upd.count).toBe(0);
    const del = await asTenant(A, (tx) => tx`delete from people where id = ${emily}`);
    expect(del.count).toBe(0);
    expect((await asTenant(B, (tx) => tx`select full_name from people where id = ${emily}`))[0].full_name).toBe("Emily Park");
  });

  it("cannot link a manager from another company", async () => {
    // Even the admin role (which bypasses RLS) is stopped by the composite foreign key.
    await expect(admin`update people set manager_id = ${emily} where id = ${maya}`).rejects.toMatchObject({ code: "23503" });
  });

  it("does not leak the setting across transactions on a pooled connection", async () => {
    const single = connect("DATABASE_URL_APP");
    try {
      await single.begin(async (tx) => { await tx`select set_config('app.tenant_id', ${A}, true)`; });
      expect(await single`select id from people`).toHaveLength(0);
    } finally {
      await single.end();
    }
  });

  it("keeps the audit log append-only", async () => {
    await expect(asTenant(A, (tx) => tx`update audit_log set action = 'x'`)).rejects.toMatchObject({ code: "42501" });
    await expect(asTenant(A, (tx) => tx`delete from audit_log`)).rejects.toMatchObject({ code: "42501" });
    await expect(admin`delete from audit_log`).rejects.toThrow(/append-only/);
  });

  it("gives the app role no direct access to the companies table", async () => {
    await expect(app`select * from tenants`).rejects.toMatchObject({ code: "42501" });
  });

  it("gives the platform role no access to company data", async () => {
    await expect(platform`select * from people`).rejects.toMatchObject({ code: "42501" });
    await expect(platform`select * from audit_log`).rejects.toMatchObject({ code: "42501" });
  });

  it("resolves branding by host with safe columns only", async () => {
    const [bySub] = await app`select * from resolve_tenant_by_host('northwind', null)`;
    expect(Object.keys(bySub).sort()).toEqual(["brand_color", "country", "id", "short_label"]);
    expect(bySub.short_label).toBe("Northwind");
    const [byDomain] = await app`select short_label from resolve_tenant_by_host(null, 'PTO.harborandpine.com')`;
    expect(byDomain.short_label).toBe("Harbor & Pine");
    expect(await app`select * from resolve_tenant_by_host('nobody', null)`).toHaveLength(0);
  });

  it("hides suspended companies from host lookup", async () => {
    await platform`update tenants set status = 'suspended' where id = ${B}`;
    expect(await app`select * from resolve_tenant_by_host('harborpine', null)`).toHaveLength(0);
    await platform`update tenants set status = 'setup' where id = ${B}`;
  });

  it("keeps short labels unique regardless of case and spacing", async () => {
    await expect(platform`insert into tenants (legal_name, short_label, subdomain, country) values ('Other', ' NORTHWIND ', 'other', 'CA')`)
      .rejects.toMatchObject({ code: "23505", constraint_name: "tenants_short_label_ci" });
  });

  it("enforces short label length and sign-in address format in the database too", async () => {
    await expect(platform`insert into tenants (legal_name, short_label, subdomain, country) values ('X', ${"x".repeat(25)}, 'xlong', 'CA')`).rejects.toMatchObject({ code: "23514" });
    await expect(platform`insert into tenants (legal_name, short_label, subdomain, country) values ('X', 'X co', 'Bad_Sub', 'CA')`).rejects.toMatchObject({ code: "23514" });
  });

  it("runtime roles cannot bypass row-level security", async () => {
    const rows = await admin`select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('aas_app', 'aas_platform') order by rolname`;
    expect(rows).toEqual([
      { rolname: "aas_app", rolbypassrls: false, rolsuper: false },
      { rolname: "aas_platform", rolbypassrls: false, rolsuper: false },
    ]);
  });
});
