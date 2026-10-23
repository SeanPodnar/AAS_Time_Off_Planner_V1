import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDb, resetDb, connect } from "./helpers";
import { closeDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";
import { withTenant } from "@/lib/tenancy";
import { outbox } from "@/lib/mailer";
import { redeemPlatformLink, redeemSignInLink, requestPlatformLink, requestSignInLink, sessionUser, platformUser } from "@/lib/auth";
import { beginEnrollment, confirmEnrollment, isEnrolled, verifyMfa, type MfaScope } from "@/lib/mfa";
import { codeAt, stepOf } from "@/lib/totp";

process.env.MFA_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
const tokenFrom = (t: string) => /token=([A-Za-z0-9_-]{43})/.exec(t)![1];
let n = 0;

describe.skipIf(!hasDb)("two-step sign-in", () => {
  let A: string, B: string, priyaId: string;

  async function signIn(tenantId: string, email: string) {
    outbox.length = 0;
    await requestSignInLink({ tenantId, tenantLabel: "X", baseUrl: "x", email, ip: `10.9.0.${++n}` });
    return (await redeemSignInLink(tenantId, tokenFrom(outbox[0].text), null))!.token;
  }

  beforeAll(async () => {
    await resetDb();
    const base = { customDomain: "", brandColor: "#2b6cb0" };
    A = ((await createTenant({ ...base, legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", country: "CA" }, "t")) as { id: string }).id;
    B = ((await createTenant({ ...base, legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", country: "US" }, "t")) as { id: string }).id;
    priyaId = await withTenant(A, async (tx) => (await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, role) values (${A}, 'Priya Shah', 'priya@nw.example', 'CA-ON', '2019-09-09', 'admin') returning id`)[0].id);
    const p = connect("DATABASE_URL_PLATFORM");
    await p`insert into platform_owners (email, full_name) values ('owner@aas.example', 'Sample Owner')`;
    await p.end();
  });
  afterAll(closeDb);

  const scope = (): MfaScope => ({ kind: "company", tenantId: A, personId: priyaId, account: "priya@nw.example", issuer: "Northwind Time Off" });

  it("enrols an HR admin, issues 10 recovery codes and marks only that session as verified", async () => {
    const session = await signIn(A, "priya@nw.example");
    const other = await signIn(A, "priya@nw.example");
    expect((await sessionUser(A, session))!.mfaVerified).toBe(false);
    const setup = await beginEnrollment(scope());
    expect(setup!.uri).toContain("issuer=Northwind%20Time%20Off");
    // Resuming set-up shows the same key rather than making a new one.
    expect((await beginEnrollment(scope()))!.secret).toBe(setup!.secret);
    expect(await confirmEnrollment(scope(), "000000", session)).toEqual({ ok: false, reason: "bad_code" });
    const now = new Date();
    const r = await confirmEnrollment(scope(), codeAt(setup!.secret, stepOf(now)), session, now);
    expect(r.ok && r.recoveryCodes).toHaveLength(10);
    expect(await isEnrolled(scope())).toBe(true);
    expect((await sessionUser(A, session))!.mfaVerified).toBe(true);
    expect((await sessionUser(A, other))!.mfaVerified).toBe(false);
    expect(await beginEnrollment(scope())).toBeNull();

    // A later code works once on the other session; the same code cannot be replayed.
    const later = new Date(now.getTime() + 30_000);
    const code = codeAt(setup!.secret, stepOf(later));
    expect(await verifyMfa(scope(), code, other, later)).toBe("ok");
    expect((await sessionUser(A, other))!.mfaVerified).toBe(true);
    const third = await signIn(A, "priya@nw.example");
    expect(await verifyMfa(scope(), code, third, later)).toBe("bad_code");

    // A recovery code works once.
    const rc = (r as { recoveryCodes: string[] }).recoveryCodes[0];
    expect(await verifyMfa(scope(), rc.toUpperCase(), third, later)).toBe("ok");
    const fourth = await signIn(A, "priya@nw.example");
    expect(await verifyMfa(scope(), rc, fourth, later)).toBe("bad_code");
  });

  it("stores the key encrypted and recovery codes hashed", async () => {
    const admin = connect("DATABASE_URL_ADMIN");
    const [f] = await admin`select secret_enc from mfa_factors`;
    const codes = await admin`select code_hash from mfa_recovery_codes`;
    await admin.end();
    expect(f.secret_enc.length).toBeGreaterThan(28);
    expect(/^[A-Z2-7]+$/.test(f.secret_enc.toString("latin1"))).toBe(false);
    expect(codes).toHaveLength(10);
  });

  it("keeps two-step data inside the company", async () => {
    const leaked = await withTenant(B, (tx) => tx`select * from mfa_factors`);
    expect(leaked).toHaveLength(0);
    const asB: MfaScope = { kind: "company", tenantId: B, personId: priyaId, account: "priya@nw.example", issuer: "Harbor & Pine Time Off" };
    expect(await isEnrolled(asB)).toBe(false);
  });

  it("locks out after 5 wrong codes in 15 minutes", async () => {
    const s = await signIn(A, "priya@nw.example");
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await verifyMfa(scope(), "123456", s));
    expect(results.slice(0, 5).every((r) => r === "bad_code")).toBe(true);
    expect(results[5]).toBe("rate_limited");
  });

  it("works the same for the platform owner, separately from companies", async () => {
    outbox.length = 0;
    await requestPlatformLink({ baseUrl: "x", email: "owner@aas.example", ip: "10.9.9.9" });
    const session = (await redeemPlatformLink(tokenFrom(outbox[0].text), null))!.token;
    const owner = (await platformUser(session))!;
    expect(owner.mfaVerified).toBe(false);
    const s: MfaScope = { kind: "platform", ownerId: owner.ownerId, account: owner.email };
    const setup = (await beginEnrollment(s))!;
    expect(setup.uri).toContain("issuer=AAS%20Platform");
    const now = new Date();
    expect((await confirmEnrollment(s, codeAt(setup.secret, stepOf(now)), session, now)).ok).toBe(true);
    expect((await platformUser(session))!.mfaVerified).toBe(true);
    const app = connect("DATABASE_URL_APP");
    await expect(app`select * from platform_mfa_factors`).rejects.toMatchObject({ code: "42501" });
    await app.end();
  });
});
