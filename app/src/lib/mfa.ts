// Two-factor codes for HR admins (per company) and platform owners.
import { randomBytes } from "node:crypto";
import type postgres from "postgres";
import { platformDb } from "./db";
import { withTenant, writeAudit } from "./tenancy";
import { hashToken, looksLikeToken } from "./tokens";
import { newSecret, otpauthUri, verifyCode } from "./totp";
import { open, seal } from "./secretbox";
import { RateLimiter } from "./rate-limit";

export type MfaScope =
  | { kind: "company"; tenantId: string; personId: string; account: string; issuer: string }
  | { kind: "platform"; ownerId: string; account: string };

const attempts = new RateLimiter(5, 15 * 60_000);
const RECOVERY_CODES = 10;

type Tx = postgres.TransactionSql;
const ownerId = (s: MfaScope) => (s.kind === "company" ? s.personId : s.ownerId);
const issuer = (s: MfaScope) => (s.kind === "company" ? s.issuer : "AAS Platform");

function run<T>(s: MfaScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return s.kind === "company" ? withTenant(s.tenantId, fn) : (platformDb().begin(fn) as Promise<T>);
}

// Table and column names differ between company and platform; everything else is shared.
const T = (s: MfaScope) =>
  s.kind === "company"
    ? { factors: "mfa_factors", codes: "mfa_recovery_codes", sessions: "sessions", who: "person_id" }
    : { factors: "platform_mfa_factors", codes: "platform_mfa_recovery_codes", sessions: "platform_sessions", who: "owner_id" };

async function factor(tx: Tx, s: MfaScope) {
  const t = T(s);
  const [f] = await tx`select secret_enc, confirmed_at, last_step from ${tx(t.factors)} where ${tx(t.who)} = ${ownerId(s)}`;
  return f as { secret_enc: Buffer; confirmed_at: Date | null; last_step: string } | undefined;
}

async function markSession(tx: Tx, s: MfaScope, sessionToken: string, now: Date) {
  const t = T(s);
  await tx`update ${tx(t.sessions)} set mfa_at = ${now} where token_hash = ${hashToken(sessionToken)} and ${tx(t.who)} = ${ownerId(s)}`;
}

async function audit(tx: Tx, s: MfaScope, action: string) {
  if (s.kind === "company") await writeAudit(tx, `person:${s.personId}`, action);
}

export async function isEnrolled(s: MfaScope): Promise<boolean> {
  return run(s, async (tx) => Boolean((await factor(tx, s))?.confirmed_at));
}

/** Starts (or resumes) set-up. Returns null if a confirmed factor already exists. */
export async function beginEnrollment(s: MfaScope): Promise<{ secret: string; uri: string } | null> {
  return run(s, async (tx) => {
    const t = T(s);
    const f = await factor(tx, s);
    if (f?.confirmed_at) return null;
    let secret: string;
    if (f) secret = open(f.secret_enc, ownerId(s));
    else {
      secret = newSecret();
      const enc = seal(secret, ownerId(s));
      if (s.kind === "company") await tx`insert into mfa_factors (tenant_id, person_id, secret_enc) values (app_tenant_id(), ${s.personId}, ${enc})`;
      else await tx`insert into ${tx(t.factors)} (owner_id, secret_enc) values (${s.ownerId}, ${enc})`;
    }
    return { secret, uri: otpauthUri(secret, issuer(s), s.account) };
  });
}

function newRecoveryCode(): string {
  const raw = randomBytes(8).toString("hex").slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}
const normRecovery = (c: string) => c.trim().toLowerCase().replace(/[\s-]/g, "");

export type ConfirmResult = { ok: true; recoveryCodes: string[] } | { ok: false; reason: "bad_code" | "rate_limited" | "already_enrolled" };

/** Confirms set-up with a first code. Returns the one-time recovery codes to show once. */
export async function confirmEnrollment(s: MfaScope, code: string, sessionToken: string, now = new Date()): Promise<ConfirmResult> {
  if (!looksLikeToken(sessionToken)) return { ok: false, reason: "bad_code" };
  if (!attempts.take(`${ownerId(s)}:${hashToken(sessionToken).toString("hex")}`)) return { ok: false, reason: "rate_limited" };
  return run(s, async (tx) => {
    const t = T(s);
    const f = await factor(tx, s);
    if (!f) return { ok: false, reason: "bad_code" } as const;
    if (f.confirmed_at) return { ok: false, reason: "already_enrolled" } as const;
    const step = verifyCode(open(f.secret_enc, ownerId(s)), code, now, Number(f.last_step));
    if (step === null) return { ok: false, reason: "bad_code" } as const;
    await tx`update ${tx(t.factors)} set confirmed_at = ${now}, last_step = ${step} where ${tx(t.who)} = ${ownerId(s)}`;
    const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
    await tx`delete from ${tx(t.codes)} where ${tx(t.who)} = ${ownerId(s)}`;
    for (const c of codes) {
      if (s.kind === "company") await tx`insert into mfa_recovery_codes (tenant_id, person_id, code_hash) values (app_tenant_id(), ${s.personId}, ${hashToken(normRecovery(c))})`;
      else await tx`insert into platform_mfa_recovery_codes (owner_id, code_hash) values (${s.ownerId}, ${hashToken(normRecovery(c))})`;
    }
    await markSession(tx, s, sessionToken, now);
    await audit(tx, s, "auth.mfa_enrolled");
    return { ok: true, recoveryCodes: codes } as const;
  });
}

export type VerifyResult = "ok" | "bad_code" | "rate_limited" | "not_enrolled";

/** Checks a code from the app, or a one-time recovery code, and marks the session as verified. */
export async function verifyMfa(s: MfaScope, code: string, sessionToken: string, now = new Date()): Promise<VerifyResult> {
  if (!looksLikeToken(sessionToken)) return "bad_code";
  if (!attempts.take(`${ownerId(s)}:${hashToken(sessionToken).toString("hex")}`)) return "rate_limited";
  return run(s, async (tx) => {
    const t = T(s);
    const f = await factor(tx, s);
    if (!f?.confirmed_at) return "not_enrolled";
    const step = verifyCode(open(f.secret_enc, ownerId(s)), code, now, Number(f.last_step));
    if (step !== null) {
      // Only advance if no concurrent request already used this or a later step.
      const upd = await tx`update ${tx(t.factors)} set last_step = ${step} where ${tx(t.who)} = ${ownerId(s)} and last_step < ${step}`;
      if (upd.count === 0) return "bad_code";
    } else {
      const used = await tx`update ${tx(t.codes)} set used_at = ${now}
        where ${tx(t.who)} = ${ownerId(s)} and code_hash = ${hashToken(normRecovery(code))} and used_at is null returning id`;
      if (used.length === 0) return "bad_code";
      await audit(tx, s, "auth.mfa_recovery_code_used");
    }
    await markSession(tx, s, sessionToken, now);
    await audit(tx, s, "auth.mfa_verified");
    return "ok";
  });
}

