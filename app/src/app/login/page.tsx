import { currentSite } from "@/lib/session";
import { brandInk } from "@/lib/color";
import { LinkForm } from "./LinkForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const site = await currentSite();
  const { expired } = await searchParams;
  const label = site.kind === "company" ? site.tenant.shortLabel : "AAS Time Off Planner";
  const style = site.kind === "company"
    ? ({ "--brand": site.tenant.brandColor, "--brand-ink": brandInk(site.tenant.brandColor) } as React.CSSProperties)
    : undefined;
  return (
    <div style={style}>
      <header className="top">
        <span className="mark" aria-hidden="true">{label.slice(0, 2).toUpperCase()}</span>
        <strong>{label}</strong>
      </header>
      <main className="wrap" style={{ maxWidth: 460 }}>
        <h1>{site.kind === "company" ? `Sign in to ${label} time off` : "Platform sign-in"}</h1>
        {expired && <p className="notice warn" role="alert">That link has expired or was already used. Request a new one.</p>}
        <LinkForm />
      </main>
    </div>
  );
}
