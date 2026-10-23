import Link from "next/link";
import { brandInk } from "@/lib/color";
import { currentSite, requireCompanyUser } from "@/lib/session";
import { signOut } from "./login/actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const site = await currentSite();
  if (site.kind === "platform") {
    return (
      <main className="wrap">
        <h1>AAS Time Off Planner</h1>
        <p className="muted">Open your company&apos;s sign-in address to continue.</p>
        <p className="small"><Link href="/platform">Platform console</Link></p>
      </main>
    );
  }

  const { user } = await requireCompanyUser();
  const t = site.tenant;
  const style = { "--brand": t.brandColor, "--brand-ink": brandInk(t.brandColor) } as React.CSSProperties;
  const role = user.role === "admin" ? "HR admin" : user.isManager ? "Manager" : "Employee";
  return (
    <div style={style}>
      <header className="top">
        <span className="mark" aria-hidden="true">{t.shortLabel.slice(0, 2).toUpperCase()}</span>
        <strong>{t.shortLabel}</strong>
        <span style={{ flex: 1 }} />
        <span className="small">{user.fullName} · {role}</span>
        <form action={signOut}><button className="btn" type="submit">Sign out</button></form>
      </header>
      <main className="wrap">
        <h1>{t.shortLabel} time off</h1>
        <p className="muted">You&apos;re signed in. Balances and requests arrive with the next roadmap items.</p>
      </main>
    </div>
  );
}
