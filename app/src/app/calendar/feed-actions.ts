"use server";

import { revalidatePath } from "next/cache";
import { requestContext } from "../requests/context";
import { resetFeed, revokeFeed, type FeedScope } from "@/lib/calendar/service";
import { NotAllowed } from "@/lib/people";

export type FeedState = { scope?: FeedScope; address?: string; notice?: string; error?: string };

const SCOPES: FeedScope[] = ["me", "team", "reports"];

/** "Get a new link" and "Turn off" post here (the button's name="intent"). The address is returned in state, never put in a URL. */
export async function feedAction(_prev: FeedState, form: FormData): Promise<FeedState> {
  const scope = String(form.get("scope") ?? "") as FeedScope;
  if (!SCOPES.includes(scope)) return { error: "Choose a calendar." };
  const { site, company, actor } = await requestContext();
  const intent = form.get("intent");
  // Each button says what it does; anything else does nothing, so an old link is never replaced by accident.
  if (intent !== "reset" && intent !== "revoke") return { scope, error: "Choose Get a new link or Turn off." };
  if (intent === "revoke") {
    await revokeFeed(company, actor, scope);
    revalidatePath("/");
    return { scope, notice: "The link is turned off." };
  }
  try {
    const r = await resetFeed(company, actor, scope);
    if (!r.ok) return { scope, error: r.error };
    revalidatePath("/");
    return { scope, address: `${site.baseUrl}/feeds/${r.token}.ics` };
  } catch (e) {
    if (e instanceof NotAllowed) return { scope, error: "This calendar is not available to you." };
    throw e;
  }
}
