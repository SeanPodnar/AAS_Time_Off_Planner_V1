// Private calendar feed (ICS) for Google Calendar, Outlook and Apple Calendar subscriptions.
// The token in the address is the only credential, so unknown, revoked and other-company
// tokens all get the same 404, and responses are never cached by shared caches.
import { currentSite } from "@/lib/session";
import { companyFor } from "@/lib/requests/company";
import { renderFeed } from "@/lib/calendar/service";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const site = await currentSite();
  if (site.kind !== "company") return notFound();
  const { token } = await params;
  const body = await renderFeed(await companyFor(site), token.replace(/\.ics$/, ""), site.host);
  if (body === null) return notFound();
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="time-off.ics"',
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
