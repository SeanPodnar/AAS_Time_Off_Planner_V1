import { getSettings } from "../people";
import type { Site } from "../session";
import type { Company } from "./service";

/** The company context the request service needs, from the current site. */
export async function companyFor(site: Extract<Site, { kind: "company" }>): Promise<Company> {
  const s = await getSettings(site.tenant.id, site.tenant.country);
  return { tenantId: site.tenant.id, label: site.tenant.shortLabel, timeZone: s.timeZone, baseUrl: site.baseUrl };
}
