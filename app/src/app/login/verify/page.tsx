import { currentSite } from "@/lib/session";
import { verifyLink } from "../actions";

export const dynamic = "force-dynamic";

// The link opens this page and the button signs in. Email security scanners that
// open links automatically therefore cannot use up the link.
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const site = await currentSite();
  const { token } = await searchParams;
  const label = site.kind === "company" ? site.tenant.shortLabel : "the platform console";
  return (
    <main className="wrap" style={{ maxWidth: 460 }}>
      <h1>Sign in to {label}</h1>
      <form action={verifyLink} className="card">
        <input type="hidden" name="token" value={token ?? ""} />
        <button className="btn" type="submit">Continue</button>
      </form>
    </main>
  );
}
