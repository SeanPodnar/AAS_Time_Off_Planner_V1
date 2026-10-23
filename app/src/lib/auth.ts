// Sign-in for company users (email link) and for the platform owner.
// Every company query runs inside withTenant, so a link or session from one company
// can never be used on another company's address.
import { platformDb } from "./db";
import { withTenant, writeAudit } from "./tenancy";
import { hashToken, looksLikeToken, newToken } from "./tokens";
import { sendEmail } from "./mailer";
import { linkByEmail, linkByIp } from "./rate-limit";

export const LINK_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 12 * 60 * 60_000;

const normEmail = (e: string) => e.trim().toLowerCase();
const plausibleEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254;

export type LinkRequest = { tenantId: string; tenantLabel: string; baseUrl: string; email: string; ip: string; now?: Date };
export type LinkResult = "sent_if_known" | "invalid_email" | "rate_limited";

/**
 * Sends a sign-in link if the address belongs to an active person at this company.
 * The answer is the same whether or not the address is known, so it cannot be used
 * to find out who works where.
 */
export async function requestSignInLink(r: LinkRequest): Promise<LinkResult> {
  const email = normEmail(r.email);
  if (!plausibleEmail(email)) return "invalid_email";
  if (!linkByIp.take(`ip:${r.ip}`) || !linkByEmail.take(`${r.tenantId}:${email}`)) return "rate_limited";
  const now = r.now ?? new Date();
  const token = newToken();
  const person = await withTenant(r.tenantId, async (tx) => {
    const [p] = await tx`select id, full_name from people where lower(email) = ${email} and status = 'active'`;
    if (!p) return null;
    await tx`insert into login_tokens (tenant_id, person_id, token_hash, expires_at)
             values (app_tenant_id(), ${p.id}, ${hashToken(token)}, ${new Date(now.getTime() + LINK_TTL_MS)})`;
    return p;
  });
  if (person) {
    await sendEmail({
      to: email,
      subject: `${r.tenantLabel}: your sign-in link`,
      text: `Hi ${person.full_name.split(" ")[0]},\n\nUse this link to sign in to ${r.tenantLabel} time off. It works once and expires in 15 minutes.\n\n${r.baseUrl}/login/verify?token=${token}\n\nIf you didn't ask for this, you can ignore this email.`,
    });
  }
  return "sent_if_known";
}

export type NewSession = { token: string; expiresAt: Date };

/** Uses a sign-in link once and starts a session. Returns null for an unknown, used, expired or other-company link. */
export async function redeemSignInLink(tenantId: string, token: string, userAgent: string | null, now = new Date()): Promise<NewSession | null> {
  if (!looksLikeToken(token)) return null;
  const session = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  return withTenant(tenantId, async (tx) => {
    const [t] = await tx`
      update login_tokens set used_at = ${now}
       where token_hash = ${hashToken(token)} and used_at is null and expires_at > ${now}
         and person_id in (select id from people where status = 'active')
      returning person_id`;
    if (!t) return null;
    await tx`insert into sessions (tenant_id, person_id, token_hash, method, expires_at, user_agent)
             values (app_tenant_id(), ${t.person_id}, ${hashToken(session)}, 'email_link', ${expiresAt}, ${userAgent?.slice(0, 300) ?? null})`;
    await writeAudit(tx, `person:${t.person_id}`, "auth.signed_in", { method: "email_link" });
    return { token: session, expiresAt };
  });
}

export type SessionUser = { personId: string; fullName: string; email: string; role: "employee" | "admin"; isManager: boolean };

export async function sessionUser(tenantId: string, token: string | undefined, now = new Date()): Promise<SessionUser | null> {
  if (!looksLikeToken(token)) return null;
  return withTenant(tenantId, async (tx) => {
    const [u] = await tx`
      select p.id, p.full_name, p.email, p.role,
             exists (select 1 from people r where r.manager_id = p.id and r.status = 'active') as is_manager
        from sessions s join people p on p.id = s.person_id
       where s.token_hash = ${hashToken(token)} and s.revoked_at is null and s.expires_at > ${now} and p.status = 'active'`;
    return u ? { personId: u.id, fullName: u.full_name, email: u.email, role: u.role, isManager: u.is_manager } : null;
  });
}

export async function endSession(tenantId: string, token: string | undefined, now = new Date()) {
  if (!looksLikeToken(token)) return;
  await withTenant(tenantId, async (tx) => {
    const [s] = await tx`update sessions set revoked_at = ${now} where token_hash = ${hashToken(token)} and revoked_at is null returning person_id`;
    if (s) await writeAudit(tx, `person:${s.person_id}`, "auth.signed_out");
  });
}

// Platform owner ------------------------------------------------------------------

export async function requestPlatformLink(r: { baseUrl: string; email: string; ip: string; now?: Date }): Promise<LinkResult> {
  const email = normEmail(r.email);
  if (!plausibleEmail(email)) return "invalid_email";
  if (!linkByIp.take(`ip:${r.ip}`) || !linkByEmail.take(`platform:${email}`)) return "rate_limited";
  const now = r.now ?? new Date();
  const token = newToken();
  const db = platformDb();
  const [o] = await db`select id, full_name from platform_owners where lower(email) = ${email} and active`;
  if (o) {
    await db`insert into platform_login_tokens (owner_id, token_hash, expires_at) values (${o.id}, ${hashToken(token)}, ${new Date(now.getTime() + LINK_TTL_MS)})`;
    await sendEmail({
      to: email,
      subject: "AAS Time Off Planner: platform sign-in link",
      text: `Use this link to sign in to the platform console. It works once and expires in 15 minutes.\n\n${r.baseUrl}/login/verify?token=${token}\n\nIf you didn't ask for this, someone may be trying your address; no action is needed.`,
    });
  }
  return "sent_if_known";
}

export async function redeemPlatformLink(token: string, userAgent: string | null, now = new Date()): Promise<NewSession | null> {
  if (!looksLikeToken(token)) return null;
  const session = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  return platformDb().begin(async (tx) => {
    const [t] = await tx`
      update platform_login_tokens set used_at = ${now}
       where token_hash = ${hashToken(token)} and used_at is null and expires_at > ${now}
         and owner_id in (select id from platform_owners where active)
      returning owner_id`;
    if (!t) return null;
    await tx`insert into platform_sessions (owner_id, token_hash, expires_at, user_agent) values (${t.owner_id}, ${hashToken(session)}, ${expiresAt}, ${userAgent?.slice(0, 300) ?? null})`;
    return { token: session, expiresAt };
  }) as Promise<NewSession | null>;
}

export type PlatformUser = { ownerId: string; fullName: string; email: string };

export async function platformUser(token: string | undefined, now = new Date()): Promise<PlatformUser | null> {
  if (!looksLikeToken(token)) return null;
  const [o] = await platformDb()`
    select o.id, o.full_name, o.email from platform_sessions s join platform_owners o on o.id = s.owner_id
     where s.token_hash = ${hashToken(token)} and s.revoked_at is null and s.expires_at > ${now} and o.active`;
  return o ? { ownerId: o.id, fullName: o.full_name, email: o.email } : null;
}

export async function endPlatformSession(token: string | undefined, now = new Date()) {
  if (!looksLikeToken(token)) return;
  await platformDb()`update platform_sessions set revoked_at = ${now} where token_hash = ${hashToken(token)} and revoked_at is null`;
}
