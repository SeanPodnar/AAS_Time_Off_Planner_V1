// Next.js glue: cookies, request host and page guards. The logic lives in auth.ts.
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { parseHost } from "./host";
import { resolveTenant, type TenantBranding } from "./tenancy";
import { platformUser, sessionUser, type PlatformUser, type SessionUser } from "./auth";

export const COMPANY_COOKIE = "aas_session";
export const PLATFORM_COOKIE = "aas_platform_session";

/** Host-only cookie (no Domain attribute), so a session for one company's address is never sent to another's. */
export function cookieOptions(expires: Date) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", expires };
}

export type Site =
  | { kind: "platform"; host: string; baseUrl: string }
  | { kind: "company"; host: string; baseUrl: string; tenant: TenantBranding };

/** Which site this request is for. Unknown company addresses get a 404. */
export async function currentSite(): Promise<Site> {
  const h = await headers();
  // Next.js renders a server action's redirect with Host set to the server's own address and the
  // browser's host in x-forwarded-host, so read that first. In production the load balancer sets it.
  // A forged value only selects which company's records are checked; it must match a company in the
  // database, and sessions are looked up inside that company, so it cannot reach another company's data.
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  const baseUrl = `${process.env.NODE_ENV === "production" ? "https" : "http"}://${host}`;
  const root = process.env.ROOT_DOMAIN ?? "localhost";
  if (parseHost(host, root).kind === "root") return { kind: "platform", host, baseUrl };
  const tenant = await resolveTenant(host, root);
  if (!tenant) notFound();
  return { kind: "company", host, baseUrl, tenant };
}

export async function clientInfo() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  return { ip, userAgent: h.get("user-agent") };
}

export async function requireCompanyUser(): Promise<{ site: Extract<Site, { kind: "company" }>; user: SessionUser }> {
  const site = await currentSite();
  if (site.kind !== "company") redirect("/platform");
  const user = await sessionUser(site.tenant.id, (await cookies()).get(COMPANY_COOKIE)?.value);
  if (!user) redirect("/login");
  return { site, user };
}

export async function requirePlatformOwner(): Promise<PlatformUser> {
  const site = await currentSite();
  if (site.kind !== "platform") notFound();
  const owner = await platformUser((await cookies()).get(PLATFORM_COOKIE)?.value);
  if (!owner) redirect("/login");
  return owner;
}
