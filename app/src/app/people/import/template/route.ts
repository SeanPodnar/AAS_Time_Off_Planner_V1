import { TEMPLATE_CSV } from "@/lib/importPeople";
import { requireAdmin } from "@/lib/session";

export async function GET() {
  await requireAdmin();
  return new Response("﻿" + TEMPLATE_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="people-import-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
