import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDb, resetDb, connect } from "./helpers";
import { closeDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { withTenant } from "@/lib/tenancy";
import { outbox } from "@/lib/mailer";
import {
  endSession, platformUser, redeemPlatformLink, redeemSignInLink, requestPlatformLink, requestSignInLink, sessionUser,
  LINK_TTL_MS, SESSION_TTL_MS,
} from "@/lib/auth";

const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]{43})/.exec(text)![1];
let ipN = 0;
const ip = () => `10.0.0.${++ipN}`;

describe.skipIf(!hasDb)("email sign-in", () => {
  let A: string, B: string;

  beforeAll(async () => {
    await resetDb();
    const base = { customDomain: "", brandColor: "#2b6cb0" };
    A = ((await createTenant({ ...base, legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", country: "CA" }, "t")) as { id: string }).id;
    B = ((await createTenant({ ...base, legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", country: "US" }, "t")) as { id: string }).id;
    await withTenant(A, async (tx) => {
      const [d] = await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date) values (${A}, 'Daniel Okafor', 'daniel@nw.example', 'CA-ON', '2017-06-01') returning id`;
      await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, manager_id) values (${A}, 'Maya Chen', 'Maya@NW.example', 'CA-ON', '2021-03-15', ${d.id})`;
      await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, role) values (${A}, 'Priya Shah', 'priya@nw.example', 'CA-ON', '2019-09-09', 'admin')`;
      await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, status) values (${A}, 'Former Person', 'gone@nw.example', 'CA-ON', '2015-01-01', 'inactive')`;
    });
    await withTenant(B, (tx) => tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date) values (${B}, 'Emily Park', 'emily@hp.example', 'US-CA', '2022-01-10')`);
    const platform = connect("DATABASE_URL_PLATFORM");
    await platform`insert into platform_owners (email, full_name) values ('owner@aas.example', 'Sample Owner')`;
    await platform.end();
  });
  beforeEach(() => { outbox.length = 0; });
  afterAll(closeDb);

  const req = (email: string, tenantId = A, label = "Northwind") =>
    requestSignInLink({ tenantId, tenantLabel: label, baseUrl: "http://northwind.localhost:3000", email, ip: ip() });

  it("emails a single-use link using the company's short label, matching email case-insensitively", async () => {
    expect(await req(" maya@nw.EXAMPLE ")).toBe("sent_if_known");
    expect(outbox).toHaveLength(1);
    expect(outbox[0].subject).toBe("Northwind: your sign-in link");
    const token = tokenFrom(outbox[0].text);
    const s = await redeemSignInLink(A, token, "test-agent");
    expect(s?.token).toBeTruthy();
    expect(await sessionUser(A, s!.token)).toMatchObject({ fullName: "Maya Chen", role: "employee", isManager: false });
    expect(await redeemSignInLink(A, token, null)).toBeNull();
  });

  it("gives the same answer for unknown and inactive addresses and sends nothing", async () => {
    expect(await req("nobody@nw.example")).toBe("sent_if_known");
    expect(await req("gone@nw.example")).toBe("sent_if_known");
    expect(outbox).toHaveLength(0);
  });

  it("does not send a link to someone from another company", async () => {
    expect(await req("emily@hp.example")).toBe("sent_if_known");
    expect(outbox).toHaveLength(0);
  });

  it("rejects a link or session on another company's address", async () => {
    await req("daniel@nw.example");
    const token = tokenFrom(outbox[0].text);
    expect(await redeemSignInLink(B, token, null)).toBeNull();
    const s = await redeemSignInLink(A, token, null);
    expect(await sessionUser(B, s!.token)).toBeNull();
    expect(await sessionUser(A, s!.token)).toMatchObject({ fullName: "Daniel Okafor", isManager: true });
  });

  it("expires links after 15 minutes and sessions after 12 hours", async () => {
    const t0 = new Date();
    await requestSignInLink({ tenantId: A, tenantLabel: "Northwind", baseUrl: "x", email: "priya@nw.example", ip: ip(), now: t0 });
    const token = tokenFrom(outbox[0].text);
    expect(await redeemSignInLink(A, token, null, new Date(t0.getTime() + LINK_TTL_MS + 1000))).toBeNull();
    await req("priya@nw.example");
    const s = await redeemSignInLink(A, tokenFrom(outbox[1].text), null, t0);
    expect(await sessionUser(A, s!.token, t0)).toMatchObject({ role: "admin" });
    expect(await sessionUser(A, s!.token, new Date(t0.getTime() + SESSION_TTL_MS + 1000))).toBeNull();
  });

  it("ends the session on sign-out and records it", async () => {
    await req("maya@nw.example");
    const s = await redeemSignInLink(A, tokenFrom(outbox[0].text), null);
    await endSession(A, s!.token);
    expect(await sessionUser(A, s!.token)).toBeNull();
    const actions = await withTenant(A, (tx) => tx`select action from audit_log where action like 'auth.%' order by at`);
    expect(actions.map((r) => r.action)).toContain("auth.signed_out");
  });

  it("locks out an address after 5 links in 15 minutes", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await req("ratelimit@nw.example"));
    expect(results.slice(0, 5).every((r) => r === "sent_if_known")).toBe(true);
    expect(results[5]).toBe("rate_limited");
  });

  it("rejects malformed emails and tokens without touching the database", async () => {
    expect(await req("not-an-email")).toBe("invalid_email");
    expect(await redeemSignInLink(A, "short", null)).toBeNull();
    expect(await sessionUser(A, undefined)).toBeNull();
  });

  it("stores only hashes of links and sessions", async () => {
    await req("maya@nw.example");
    const token = tokenFrom(outbox[0].text);
    const admin = connect("DATABASE_URL_ADMIN");
    const found = await admin`select count(*)::int as n from login_tokens where encode(token_hash, 'escape') like ${"%" + token + "%"}`;
    await admin.end();
    expect(found[0].n).toBe(0);
  });

  it("keeps platform owner sign-in separate from company sign-in", async () => {
    expect(await requestPlatformLink({ baseUrl: "http://localhost:3000", email: "owner@aas.example", ip: ip() })).toBe("sent_if_known");
    const token = tokenFrom(outbox[0].text);
    expect(await redeemSignInLink(A, token, null)).toBeNull();
    const s = await redeemPlatformLink(token, null);
    expect(await platformUser(s!.token)).toMatchObject({ fullName: "Sample Owner" });
    expect(await sessionUser(A, s!.token)).toBeNull();
    expect(await requestPlatformLink({ baseUrl: "x", email: "maya@nw.example", ip: ip() })).toBe("sent_if_known");
    expect(outbox).toHaveLength(1);
  });

  it("gives the app role no access to platform sign-in tables", async () => {
    const app = connect("DATABASE_URL_APP");
    await expect(app`select * from platform_sessions`).rejects.toMatchObject({ code: "42501" });
    await app.end();
  });
});
