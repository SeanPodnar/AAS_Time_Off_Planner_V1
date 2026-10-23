"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { NotAllowed } from "@/lib/people";
import { addCompanyHoliday, removeHolidayChange, skipHoliday } from "@/lib/holidays";

const text = (form: FormData, k: string) => String(form.get(k) ?? "");

const guard = async <T,>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn(); } catch (e) { if (e instanceof NotAllowed) notFound(); throw e; }
};

/** Back to the same year and province or state, with a result in the query string. */
function back(form: FormData, result: string): never {
  const year = /^\d{4}$/.test(text(form, "year")) ? text(form, "year") : "";
  const j = /^(CA|US)-[A-Z]{2}$/.test(text(form, "j")) ? text(form, "j") : "";
  const q = new URLSearchParams();
  if (year) q.set("year", year);
  if (j) q.set("j", j);
  const [k, v] = result.split("=");
  q.set(k, v);
  revalidatePath("/settings/holidays");
  redirect(`/settings/holidays?${q.toString()}`);
}

const firstError = (errors: Record<string, string>) => Object.values(errors)[0] ?? "Something went wrong. Try again.";
const failed = (form: FormData, errors: Record<string, string>): never => {
  const q = new URLSearchParams({ year: text(form, "year"), j: text(form, "j"), error: firstError(errors) });
  redirect(`/settings/holidays?${q.toString()}`);
};

export async function addHolidayAction(form: FormData) {
  const { site, actor } = await requireAdmin();
  const everyone = text(form, "appliesTo") !== "selected";
  const r = await guard(() => addCompanyHoliday(site.tenant.id, actor, { day: text(form, "day"), name: text(form, "name"), jurisdiction: everyone ? "" : text(form, "j"), reason: text(form, "reason") }));
  if (!r.ok) failed(form, r.errors);
  back(form, "added=1");
}

export async function skipHolidayAction(form: FormData) {
  const { site, actor } = await requireAdmin();
  const r = await guard(() => skipHoliday(site.tenant.id, actor, { day: text(form, "day"), name: text(form, "name"), jurisdiction: text(form, "j"), reason: text(form, "reason") }));
  if (!r.ok) failed(form, r.errors);
  back(form, "skipped=1");
}

export async function removeChangeAction(form: FormData) {
  const { site, actor } = await requireAdmin();
  const r = await guard(() => removeHolidayChange(site.tenant.id, actor, text(form, "id")));
  if (!r.ok) failed(form, { form: "That change no longer exists." });
  back(form, "removed=1");
}
