import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseHost } from "@/lib/host";
import { resolveTenant } from "@/lib/tenancy";
import { brandInk } from "@/lib/color";
import { devPlatformEnabled } from "@/lib/flags";

export const dynamic = "force-dynamic";

export default async function Home() {
  const host = (await headers()).get("host");
  const tenant = await resolveTenant(host);

  if (!tenant) {
    // A company address that matches no company gets a plain 404, never another company's page.
    if (parseHost(host, process.env.ROOT_DOMAIN ?? "localhost").kind !== "root") notFound();
    return (
      <main className="wrap">
        <h1>AAS Time Off Planner</h1>
        <p className="muted">Open your company&apos;s sign-in address to continue.</p>
        {devPlatformEnabled() && (
          <p className="small">
            Development: <Link href="/platform">platform console</Link>
          </p>
        )}
      </main>
    );
  }

  const style = { "--brand": tenant.brandColor, "--brand-ink": brandInk(tenant.brandColor) } as React.CSSProperties;
  return (
    <div style={style}>
      <header className="top">
        <span className="mark" aria-hidden="true">{tenant.shortLabel.slice(0, 2).toUpperCase()}</span>
        <strong>{tenant.shortLabel}</strong>
      </header>
      <main className="wrap">
        <h1>{tenant.shortLabel} time off</h1>
        <p className="muted">Sign-in with Google, Microsoft 365 or an email link arrives in the next update.</p>
      </main>
    </div>
  );
}
