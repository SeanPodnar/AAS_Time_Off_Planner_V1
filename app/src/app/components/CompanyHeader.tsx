import Link from "next/link";
import { brandInk } from "@/lib/color";
import type { TenantBranding } from "@/lib/tenancy";
import type { SessionUser } from "@/lib/auth";
import { signOut } from "../login/actions";

export function brandStyle(t: TenantBranding) {
  return { "--brand": t.brandColor, "--brand-ink": brandInk(t.brandColor) } as React.CSSProperties;
}

export function CompanyHeader({ tenant, user, current, approvals }: { tenant: TenantBranding; user: SessionUser; current?: string; approvals?: number }) {
  const role = user.role === "admin" ? "HR admin" : user.isManager ? "Manager" : "Employee";
  const links = [{ href: "/", label: "My time off" }, { href: "/calendar", label: "Team calendar" }, ...(user.role === "admin" || user.isManager || (approvals ?? 0) > 0 ? [{ href: "/approvals", label: "Approvals" }] : []), ...(user.role === "admin" ? [{ href: "/people", label: "People" }, { href: "/plans", label: "Plans" }, { href: "/reports", label: "Reports" }, { href: "/settings", label: "Settings" }] : [])];
  return (
    <header className="top">
      <span className="mark" aria-hidden="true">{tenant.shortLabel.slice(0, 2).toUpperCase()}</span>
      <strong>{tenant.shortLabel}</strong>
      <nav className="topnav" aria-label="Main">
        {links.map((l) => <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined}>{l.label}{l.href === "/approvals" && approvals ? <span className="badge" aria-label={`${approvals} waiting`}>{approvals}</span> : null}</Link>)}
      </nav>
      <span style={{ flex: 1 }} />
      <span className="small">{user.fullName} · {role}</span>
      <form action={signOut}><button className="btn ghost" type="submit">Sign out</button></form>
    </header>
  );
}
