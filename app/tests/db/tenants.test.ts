import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb, resetDb, connect } from "./helpers";
import { createTenant, listTenants } from "@/lib/tenants";
import { resolveTenant } from "@/lib/tenancy";
import { closeDb } from "@/lib/db";

describe.skipIf(!hasDb)("company setup", () => {
  beforeAll(resetDb);
  afterAll(closeDb);

  const input = { legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", customDomain: "timeoff.northwind.ca", brandColor: "#2f7fd8", country: "CA" };

  it("creates a company and writes an audit entry in that company's log", async () => {
    const res = await createTenant(input, "Test");
    expect(res.ok).toBe(true);
    const admin = connect("DATABASE_URL_ADMIN");
    const audit = await admin`select tenant_id, action, actor from audit_log`;
    await admin.end();
    expect(audit).toEqual([{ tenant_id: (res as { id: string }).id, action: "company.created", actor: "Test" }]);
  });

  it("reports duplicate short labels, addresses and domains against the right field", async () => {
    expect(await createTenant({ ...input, shortLabel: "northwind", subdomain: "nw2", customDomain: "" }, "Test"))
      .toEqual({ ok: false, errors: { shortLabel: "Another company already uses this short label." } });
    expect(await createTenant({ ...input, shortLabel: "NW2", customDomain: "" }, "Test"))
      .toEqual({ ok: false, errors: { subdomain: "Another company already uses this sign-in address." } });
    expect(await createTenant({ ...input, shortLabel: "NW3", subdomain: "nw3" }, "Test"))
      .toEqual({ ok: false, errors: { customDomain: "Another company already uses this domain." } });
  });

  it("returns validation errors without touching the database", async () => {
    const res = await createTenant({ ...input, shortLabel: "" }, "Test");
    expect(res).toMatchObject({ ok: false, errors: { shortLabel: expect.any(String) } });
  });

  it("lists companies and resolves them by sign-in address and custom domain", async () => {
    expect((await listTenants()).map((t) => t.shortLabel)).toEqual(["Northwind"]);
    expect(await resolveTenant("northwind.localhost:3000", "localhost")).toMatchObject({ shortLabel: "Northwind", brandColor: "#2f7fd8" });
    expect(await resolveTenant("timeoff.northwind.ca", "localhost")).toMatchObject({ shortLabel: "Northwind" });
    expect(await resolveTenant("localhost:3000", "localhost")).toBeNull();
    expect(await resolveTenant("unknown.localhost", "localhost")).toBeNull();
  });
});
