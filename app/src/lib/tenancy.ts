import type postgres from "postgres";
import { appDb } from "./db";
import { parseHost } from "./host";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantBranding = { id: string; shortLabel: string; brandColor: string; country: "CA" | "US" };

/**
 * Runs fn in a transaction scoped to one company. The database's row-level security
 * policies read app.tenant_id, so every query inside sees and writes only that
 * company's rows. The setting is transaction-local and cannot leak to the next
 * request that reuses the pooled connection.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error("withTenant: tenantId must be a UUID");
  return appDb().begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Looks up a company's public branding from the request host. Returns null for the platform root or an unknown host. */
export async function resolveTenant(host: string | null, rootDomain = process.env.ROOT_DOMAIN ?? "localhost"): Promise<TenantBranding | null> {
  const target = parseHost(host, rootDomain);
  if (target.kind === "root") return null;
  const sub = target.kind === "subdomain" ? target.subdomain : null;
  const custom = target.kind === "custom" ? target.domain : null;
  const rows = await appDb()`select id, short_label, brand_color, country from resolve_tenant_by_host(${sub}, ${custom})`;
  const r = rows[0];
  return r ? { id: r.id, shortLabel: r.short_label, brandColor: r.brand_color, country: r.country } : null;
}

export async function writeAudit(tx: postgres.TransactionSql, actor: string, action: string, detail: Record<string, unknown> = {}) {
  await tx`insert into audit_log (tenant_id, actor, action, detail) values (app_tenant_id(), ${actor}, ${action}, ${tx.json(detail as postgres.JSONValue)})`;
}
