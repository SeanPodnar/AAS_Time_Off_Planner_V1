"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  endPlatformSession, endSession, redeemPlatformLink, redeemSignInLink, requestPlatformLink, requestSignInLink,
} from "@/lib/auth";
import { clientInfo, COMPANY_COOKIE, cookieOptions, currentSite, PLATFORM_COOKIE } from "@/lib/session";

export type LinkState = { status?: "sent" | "invalid_email" | "rate_limited"; email?: string };

export async function requestLink(_prev: LinkState, form: FormData): Promise<LinkState> {
  const email = String(form.get("email") ?? "");
  const site = await currentSite();
  const { ip } = await clientInfo();
  const result =
    site.kind === "company"
      ? await requestSignInLink({ tenantId: site.tenant.id, tenantLabel: site.tenant.shortLabel, baseUrl: site.baseUrl, email, ip })
      : await requestPlatformLink({ baseUrl: site.baseUrl, email, ip });
  return { status: result === "sent_if_known" ? "sent" : result, email };
}

export async function verifyLink(form: FormData) {
  const token = String(form.get("token") ?? "");
  const site = await currentSite();
  const { userAgent } = await clientInfo();
  const jar = await cookies();
  if (site.kind === "company") {
    const s = await redeemSignInLink(site.tenant.id, token, userAgent);
    if (!s) redirect("/login?expired=1");
    jar.set(COMPANY_COOKIE, s.token, cookieOptions(s.expiresAt));
    redirect("/");
  }
  const s = await redeemPlatformLink(token, userAgent);
  if (!s) redirect("/login?expired=1");
  jar.set(PLATFORM_COOKIE, s.token, cookieOptions(s.expiresAt));
  redirect("/platform");
}

export async function signOut() {
  const site = await currentSite();
  const jar = await cookies();
  if (site.kind === "company") {
    await endSession(site.tenant.id, jar.get(COMPANY_COOKIE)?.value);
    jar.delete(COMPANY_COOKIE);
  } else {
    await endPlatformSession(jar.get(PLATFORM_COOKIE)?.value);
    jar.delete(PLATFORM_COOKIE);
  }
  redirect("/login");
}
