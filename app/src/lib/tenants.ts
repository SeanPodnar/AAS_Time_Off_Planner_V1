import { platformDb } from "./db";
import { withTenant, writeAudit } from "./tenancy";
import { tenantInput, fieldErrors } from "./validation";

export type TenantRow = {
  id: string;
  legalName: string;
  shortLabel: string;
  subdomain: string;
  customDomain: string | null;
  brandColor: string;
  country: "CA" | "US";
  status: string;
  createdAt: Date;
};

export async function listTenants(): Promise<TenantRow[]> {
  const rows = await platformDb()`
    select id, legal_name, short_label, subdomain, custom_domain, brand_color, country, status, created_at
      from tenants order by lower(short_label)`;
  return rows.map((r) => ({
    id: r.id, legalName: r.legal_name, shortLabel: r.short_label, subdomain: r.subdomain,
    customDomain: r.custom_domain, brandColor: r.brand_color, country: r.country, status: r.status, createdAt: r.created_at,
  }));
}

export type CreateResult = { ok: true; id: string } | { ok: false; errors: Record<string, string> };

const UNIQUE_FIELDS: Record<string, [string, string]> = {
  tenants_short_label_ci: ["shortLabel", "Another company already uses this short label."],
  tenants_subdomain_key: ["subdomain", "Another company already uses this sign-in address."],
  tenants_custom_domain_key: ["customDomain", "Another company already uses this domain."],
};

export async function createTenant(raw: unknown, actor: string): Promise<CreateResult> {
  const parsed = tenantInput.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const t = parsed.data;
  let id: string;
  try {
    const [row] = await platformDb()`
      insert into tenants (legal_name, short_label, subdomain, custom_domain, brand_color, country)
      values (${t.legalName}, ${t.shortLabel}, ${t.subdomain}, ${t.customDomain}, ${t.brandColor}, ${t.country})
      returning id`;
    id = row.id;
  } catch (e) {
    const err = e as { code?: string; constraint_name?: string };
    if (err.code === "23505" && err.constraint_name && UNIQUE_FIELDS[err.constraint_name]) {
      const [field, message] = UNIQUE_FIELDS[err.constraint_name];
      return { ok: false, errors: { [field]: message } };
    }
    throw e;
  }
  await withTenant(id, (tx) => writeAudit(tx, actor, "company.created", { legalName: t.legalName, shortLabel: t.shortLabel, subdomain: t.subdomain }));
  return { ok: true, id };
}
