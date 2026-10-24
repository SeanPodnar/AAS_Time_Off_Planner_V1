import { exportReport, findReport } from "@/lib/reports";
import { getSettings } from "@/lib/people";
import { requireAdmin } from "@/lib/session";
import { filterFrom } from "../../params";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { site, user, actor } = await requireAdmin();
  if (!findReport(key)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format");
  if (format !== "xlsx" && format !== "csv") return new Response("Format must be xlsx or csv", { status: 400 });
  const sp = Object.fromEntries(url.searchParams);
  const settings = await getSettings(site.tenant.id, site.tenant.country);
  const out = await exportReport(actor, { tenantId: site.tenant.id, timeZone: settings.timeZone, runByName: user.fullName }, key, filterFrom(sp), format);
  if (!out) return new Response("Not found", { status: 404 });
  const body = typeof out.body === "string" ? out.body : new Uint8Array(out.body);
  return new Response(body as BodyInit, {
    headers: { "Content-Type": out.type, "Content-Disposition": `attachment; filename="${out.name}"`, "Cache-Control": "private, no-store" },
  });
}
