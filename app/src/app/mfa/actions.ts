"use server";

import { confirmEnrollment, verifyMfa, type MfaScope } from "@/lib/mfa";
import { currentSite, requireCompanyUser, requirePlatformOwner } from "@/lib/session";

export type MfaState = { error?: string; recoveryCodes?: string[]; done?: boolean };

async function scope(): Promise<{ s: MfaScope; token: string }> {
  const site = await currentSite();
  if (site.kind === "company") {
    const { user, token } = await requireCompanyUser({ allowPendingMfa: true });
    return { s: { kind: "company", tenantId: site.tenant.id, personId: user.personId, account: user.email, issuer: `${site.tenant.shortLabel} Time Off` }, token };
  }
  const owner = await requirePlatformOwner({ allowPendingMfa: true });
  return { s: { kind: "platform", ownerId: owner.ownerId, account: owner.email }, token: owner.token };
}

const messages: Record<string, string> = {
  bad_code: "That code didn't work. Check the 6-digit code in your app and try again.",
  rate_limited: "Too many attempts. Wait 15 minutes, then try again.",
  already_enrolled: "Two-step sign-in is already set up. Enter a code to continue.",
  not_enrolled: "Set up two-step sign-in first.",
};

export async function confirmSetup(_prev: MfaState, form: FormData): Promise<MfaState> {
  const { s, token } = await scope();
  const r = await confirmEnrollment(s, String(form.get("code") ?? ""), token);
  return r.ok ? { recoveryCodes: r.recoveryCodes } : { error: messages[r.reason] };
}

export async function checkCode(_prev: MfaState, form: FormData): Promise<MfaState> {
  const { s, token } = await scope();
  const r = await verifyMfa(s, String(form.get("code") ?? ""), token);
  return r === "ok" ? { done: true } : { error: messages[r] };
}
