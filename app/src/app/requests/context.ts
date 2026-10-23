import { requireCompanyUser } from "@/lib/session";
import { companyFor } from "@/lib/requests/company";
import { approvalCount } from "@/lib/requests/service";
import type { Actor } from "@/lib/people";

/** Signed-in company user plus the request-service context. */
export async function requestContext() {
  const { site, user } = await requireCompanyUser();
  const company = await companyFor(site);
  const actor: Actor = { personId: user.personId, role: user.role };
  return { site, user, company, actor };
}

/** Count for the header badge. Only people who can approve get a query. */
export async function approvalsBadge(company: Parameters<typeof approvalCount>[0], actor: Actor, user: { isManager: boolean; role: string }) {
  return user.isManager || user.role === "admin" ? approvalCount(company, actor) : 0;
}
