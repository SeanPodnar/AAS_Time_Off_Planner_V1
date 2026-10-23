"use server";

import { revalidatePath } from "next/cache";
import { createTenant } from "@/lib/tenants";
import { requirePlatformOwner } from "@/lib/session";

export type FormState = { ok?: string; errors?: Record<string, string>; values?: Record<string, string> };

const FIELDS = ["legalName", "shortLabel", "subdomain", "customDomain", "brandColor", "country"] as const;

export async function createCompany(_prev: FormState, form: FormData): Promise<FormState> {
  const owner = await requirePlatformOwner();
  const values = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? "")]));
  const result = await createTenant(values, `Platform owner: ${owner.fullName}`);
  if (!result.ok) return { errors: result.errors, values };
  revalidatePath("/platform");
  return { ok: `${values.shortLabel.trim()} was created.` };
}
