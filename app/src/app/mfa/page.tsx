import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { beginEnrollment, isEnrolled, type MfaScope } from "@/lib/mfa";
import { currentSite, needsMfa, requireCompanyUser, requirePlatformOwner } from "@/lib/session";
import { SetupForm, VerifyForm } from "./MfaForms";

export const dynamic = "force-dynamic";

export default async function MfaPage() {
  const site = await currentSite();
  let s: MfaScope, next: string;
  if (site.kind === "company") {
    const { user } = await requireCompanyUser({ allowPendingMfa: true });
    if (!needsMfa(user) || user.mfaVerified) redirect("/");
    s = { kind: "company", tenantId: site.tenant.id, personId: user.personId, account: user.email, issuer: `${site.tenant.shortLabel} Time Off` };
    next = "/";
  } else {
    const owner = await requirePlatformOwner({ allowPendingMfa: true });
    if (owner.mfaVerified) redirect("/platform");
    s = { kind: "platform", ownerId: owner.ownerId, account: owner.email };
    next = "/platform";
  }

  if (await isEnrolled(s)) {
    return (
      <main className="wrap" style={{ maxWidth: 480 }}>
        <h1>Two-step sign-in</h1>
        <p className="muted">Open your authenticator app and enter the current code.</p>
        <VerifyForm next={next} />
      </main>
    );
  }

  const setup = await beginEnrollment(s);
  if (!setup) redirect("/mfa");
  const qr = await QRCode.toDataURL(setup.uri, { margin: 1, width: 200 });
  return (
    <main className="wrap" style={{ maxWidth: 520 }}>
      <h1>Set up two-step sign-in</h1>
      <p className="muted">Your role can see and change other people&apos;s records, so it needs a code from an authenticator app as well as your email link.</p>
      <div className="card">
        <p>1. Open an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password, and scan this code.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR code for your authenticator app" width={200} height={200} style={{ background: "#fff", borderRadius: 8 }} />
        <p className="small muted">Can&apos;t scan? Enter this key instead: <code>{setup.secret.match(/.{1,4}/g)!.join(" ")}</code></p>
        <p>2. Enter the 6-digit code the app shows.</p>
      </div>
      <SetupForm next={next} />
    </main>
  );
}
