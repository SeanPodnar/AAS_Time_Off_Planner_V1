"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { savePerson, saveSettings, setStatus } from "@/lib/people";
import { requireAdmin } from "@/lib/session";

export type FormState = { errors?: Record<string, string>; values?: Record<string, string | string[]>; saved?: boolean };

const FIELDS = ["fullName", "email", "jobTitle", "employeeNumber", "jurisdiction", "hireDate", "managerId", "teamName", "locationName", "role", "hoursPerDay"];

export async function savePersonAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { site, actor } = await requireAdmin();
  const id = String(form.get("id") ?? "") || undefined;
  const values: Record<string, string | string[]> = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? "")]));
  values.workDays = form.getAll("workDays").map(String);
  values.secondaryManagerIds = form.getAll("secondaryManagerIds").map(String).filter(Boolean);
  const r = await savePerson(site.tenant.id, actor, values, id);
  if (!r.ok) return { errors: r.errors, values };
  revalidatePath("/people");
  redirect(`/people/${r.id}?saved=1`);
}

export async function setStatusAction(form: FormData) {
  const { site, actor } = await requireAdmin();
  const id = String(form.get("id") ?? "");
  const status = form.get("status") === "inactive" ? "inactive" : "active";
  const r = await setStatus(site.tenant.id, actor, id, status);
  revalidatePath("/people");
  redirect(`/people/${id}?${r.ok ? `status=${status}` : `error=${encodeURIComponent(r.error)}`}`);
}

export async function saveSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { site, actor } = await requireAdmin();
  const values = { timeZone: String(form.get("timeZone") ?? ""), secondApprovalThreshold: String(form.get("secondApprovalThreshold") ?? "") };
  const r = await saveSettings(site.tenant.id, actor, values);
  return r.ok ? { saved: true, values } : { errors: r.errors, values };
}
