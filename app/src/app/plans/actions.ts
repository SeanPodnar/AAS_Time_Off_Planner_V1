"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assignPlan, assignPlanToAll, savePlan } from "@/lib/plans";
import { requireAdmin } from "@/lib/session";

export type PlanFormState = { errors?: Record<string, string>; values?: Record<string, string | string[]> };

const FIELDS = [
  "name", "category", "unit", "accrualMethod", "lumpSumTiming", "frequency", "creditTiming", "hoursWorkedRatio", "planYearStartMonth", "planYearStartDay",
  "rounding", "carryover", "carryoverCap", "carryoverExpiryMonth", "carryoverExpiryDay", "maxBalance", "approvalMode", "negativeLimit", "waitingPeriodDays",
  "visibility", "calendarStatus", "counts",
];
const BOOLEANS = ["firstYearProration", "payoutUnused", "secondApproval", "tenureEnabled", "active"];

export async function savePlanAction(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const { site, actor } = await requireAdmin();
  const id = String(form.get("id") ?? "") || undefined;
  const values: Record<string, string | string[]> = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? "")]));
  for (const b of BOOLEANS) values[b] = form.get(b) === null ? "false" : "true";
  const ids = form.getAll("levelId").map(String);
  const names = form.getAll("levelName").map(String);
  const amounts = form.getAll("levelAmount").map(String);
  const tiers = form.getAll("levelTiers").map(String);
  values.levelId = ids; values.levelName = names; values.levelAmount = amounts; values.levelTiers = tiers;
  const levels = names.map((name, i) => ({ id: ids[i] ?? "", name, annualAmount: amounts[i] ?? "", tenureTiers: tiers[i] ?? "" }));
  const r = await savePlan(site.tenant.id, actor, { ...values, levels }, id);
  if (!r.ok) return { errors: r.errors, values };
  revalidatePath("/plans");
  redirect(`/plans/${r.id}?saved=1`);
}

export async function assignAllAction(form: FormData) {
  const { site, actor } = await requireAdmin();
  const planId = String(form.get("planId") ?? "");
  const r = await assignPlanToAll(site.tenant.id, actor, { planId, levelId: String(form.get("levelId") ?? ""), effectiveFrom: String(form.get("effectiveFrom") ?? "") });
  revalidatePath("/plans");
  redirect(`/plans/${planId}?${r.ok ? `assigned=${r.count}` : `error=${encodeURIComponent(Object.values(r.errors)[0])}`}`);
}

export async function assignPersonAction(form: FormData) {
  const { site, actor } = await requireAdmin();
  const personId = String(form.get("personId") ?? "");
  // The plan and level come from one select whose values look like "planId:levelId".
  const [planId, levelId] = String(form.get("planLevel") ?? "").split(":");
  const r = await assignPlan(site.tenant.id, actor, { personId, planId: planId ?? "", levelId: levelId ?? "", effectiveFrom: String(form.get("effectiveFrom") ?? "") });
  revalidatePath("/plans");
  redirect(`/people/${personId}?${r.ok ? "assigned=1" : `assignError=${encodeURIComponent(Object.values(r.errors)[0])}`}`);
}
