/** Which company a request is for, from its Host header. */
export type HostTarget =
  | { kind: "root" }
  | { kind: "subdomain"; subdomain: string }
  | { kind: "custom"; domain: string };

/**
 * rootDomain is the platform's own domain, e.g. "aas-timeoff.ca" (or "localhost" in development).
 * acme.aas-timeoff.ca -> subdomain "acme"; aas-timeoff.ca -> root; anything else -> custom domain.
 * Only one subdomain level is accepted, so a.b.aas-timeoff.ca is treated as unknown (custom lookup fails closed).
 */
export function parseHost(hostHeader: string | null | undefined, rootDomain: string): HostTarget {
  const root = rootDomain.toLowerCase().replace(/\.$/, "");
  const host = (hostHeader ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!host || host === root) return { kind: "root" };
  if (host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -(root.length + 1));
    if (sub && !sub.includes(".")) return { kind: "subdomain", subdomain: sub };
  }
  return { kind: "custom", domain: host };
}
