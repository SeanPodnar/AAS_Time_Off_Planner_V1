"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { adjustBalance, adminAddTimeOff, amendRequest, cancelRequest, decideRequest, listMyRequests, NotAllowed, previewRequest, submitRequest, type Summary } from "@/lib/requests/service";
import { requestContext } from "./context";
import { safeReturn } from "./format";
import { companyFor } from "@/lib/requests/company";

export type RequestFormState = { errors?: Record<string, string>; values?: Record<string, string>; summary?: Summary };

const FIELDS = ["planId", "startDate", "endDate", "startPart", "endPart", "singlePart", "comment"];
const pick = (v: string, allowed: string[]) => (allowed.includes(v) ? v : "full");
const text = (form: FormData, k: string) => String(form.get(k) ?? "");

/** Form values to keep on screen after a check or an error. */
function values(form: FormData, extra: string[] = []) {
  const out: Record<string, string> = {};
  for (const f of [...FIELDS, ...extra]) out[f] = text(form, f);
  return out;
}

/** The service input. A single day uses the "singlePart" choice; longer runs use the start and end choices. */
function requestInput(form: FormData) {
  const startDate = text(form, "startDate").trim();
  const endDate = text(form, "endDate").trim() || startDate;
  const single = startDate === endDate;
  const startPart = single ? pick(text(form, "singlePart"), ["full", "am", "pm"]) : pick(text(form, "startPart"), ["full", "pm"]);
  const endPart = single ? startPart : pick(text(form, "endPart"), ["full", "am"]);
  return { planId: text(form, "planId"), startDate, endDate, startPart, endPart, comment: text(form, "comment") };
}

const guard = async <T,>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn(); } catch (e) { if (e instanceof NotAllowed) notFound(); throw e; }
};

/** Check, Send request and Save changes all post here. The button's name="intent" says which. */
export async function requestFormAction(_prev: RequestFormState, form: FormData): Promise<RequestFormState> {
  const { company, actor } = await requestContext();
  const intent = text(form, "intent");
  const id = text(form, "id") || undefined;
  const raw = requestInput(form);
  const vals = values(form);

  // Only an explicit "send" submits; anything else (Enter key, missing button value) just checks.
  if (intent !== "send") {
    const r = await guard(() => previewRequest(company, actor, raw, id ? { requestId: id } : {}));
    return r.ok ? { values: vals, summary: r.summary } : { values: vals, errors: r.errors };
  }
  if (id) {
    const before = (await listMyRequests(company, actor)).find((x) => x.id === id);
    if (!before || !before.canAmend) notFound();
    const r = await guard(() => amendRequest(company, actor, id, raw));
    if (!r.ok) return { values: vals, errors: r.errors };
    revalidatePath("/");
    redirect(`/?requested=${r.status === "approved" ? "approved" : before.status === "pending" ? "updated" : "change"}`);
  }
  const r = await guard(() => submitRequest(company, actor, raw));
  if (!r.ok) return { values: vals, errors: r.errors };
  revalidatePath("/");
  redirect(r.status === "approved" ? "/?requested=approved" : "/?requested=1");
}

/** Withdraw or cancel. HR passes a reason when it is someone else's time off. */
export async function cancelRequestAction(form: FormData) {
  const { company, actor } = await requestContext();
  const back = safeReturn(form.get("returnTo"));
  const r = await guard(() => cancelRequest(company, actor, text(form, "id"), text(form, "reason") || undefined));
  revalidatePath("/");
  const msg = r.ok ? `cancel=${r.status}` : `cancelError=${encodeURIComponent(Object.values(r.errors)[0])}`;
  redirect(`${back}?${msg}`);
}

/** Approve or decline from the approvals list. Each button has its own action, so a decision is never guessed. */
async function decide(form: FormData, decision: "approve" | "decline") {
  const { company, actor } = await requestContext();
  const id = text(form, "id");
  const r = await guard(() => decideRequest(company, actor, id, decision, text(form, "comment") || undefined));
  revalidatePath("/approvals");
  if (!r.ok) redirect(`/approvals?error=${encodeURIComponent(Object.values(r.errors)[0])}&errorId=${encodeURIComponent(id)}`);
  redirect(`/approvals?decided=${r.status === "pending" ? "next" : r.status}`);
}
export async function approveAction(form: FormData) { await decide(form, "approve"); }
export async function declineAction(form: FormData) { await decide(form, "decline"); }

export type AdminFormState = { errors?: Record<string, string>; values?: Record<string, string> };

/** HR adds time off for someone. */
export async function addTimeOffAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const { site, actor } = await requireAdmin();
  const personId = text(form, "personId");
  const vals = values(form, ["reason", "approveNow", "allowNegative"]);
  const company = await companyFor(site);
  const r = await guard(() => adminAddTimeOff(company, actor, personId, requestInput(form), {
    reason: text(form, "reason"), approveNow: form.get("approveNow") !== null, allowNegative: form.get("allowNegative") !== null,
  }));
  if (!r.ok) return { values: vals, errors: r.errors };
  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}?added=${r.status}`);
}

/** HR credits or debits a balance. */
export async function adjustBalanceAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  const { site, actor } = await requireAdmin();
  const personId = text(form, "personId");
  const vals: Record<string, string> = {};
  for (const f of ["planId", "amount", "effectiveDate", "reason"]) vals[f] = text(form, f);
  const company = await companyFor(site);
  const r = await guard(() => adjustBalance(company, actor, { personId, ...vals }));
  if (!r.ok) return { values: vals, errors: r.errors };
  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}?adjusted=1`);
}
