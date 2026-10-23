"use server";

import { revalidatePath } from "next/cache";
import { commitImport, previewImport, MAX_BYTES, type Preview } from "@/lib/importPeople";
import { requireAdmin } from "@/lib/session";

export type ImportState = {
  error?: string; batchId?: string; filename?: string; preview?: Preview;
  done?: { create: number; update: number; unchanged: number };
};

export async function uploadAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  const { site, actor } = await requireAdmin();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a .csv or .xlsx file." };
  if (file.size > MAX_BYTES) return { error: "The file is over 2 MB. Split it into smaller files." };
  const r = await previewImport(site.tenant.id, actor, file.name, Buffer.from(await file.arrayBuffer()));
  return r.ok ? { batchId: r.batchId, filename: file.name, preview: r.preview } : { error: r.error };
}

export async function confirmAction(prev: ImportState, form: FormData): Promise<ImportState> {
  const { site, actor } = await requireAdmin();
  const r = await commitImport(site.tenant.id, actor, String(form.get("batchId") ?? ""));
  if (!r.ok) return { ...prev, error: r.error, preview: r.preview ?? prev.preview };
  revalidatePath("/people");
  return { done: r.counts, filename: String(form.get("filename") ?? "").slice(0, 200) || prev.filename };
}
