"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { createTenant } from "@/lib/tenants";
import { devPlatformEnabled } from "@/lib/flags";

export type FormState = { ok?: string; errors?: Record<string, string>; values?: Record<string, string> };

const FIELDS = ["legalName", "shortLabel", "subdomain", "customDomain", "brandColor", "country"] as const;

export async function createCompany(_prev: FormState, form: FormData): Promise<FormState> {
  if (!devPlatformEnabled()) notFound();
  const values = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? "")]));
  const result = await createTenant(values, "Platform owner (development)");
  if (!result.ok) return { errors: result.errors, values };
  revalidatePath("/platform");
  return { ok: `${values.shortLabel.trim()} was created.` };
}
