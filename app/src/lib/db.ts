import postgres from "postgres";

// Two pools with different database roles. Neither can bypass row-level security.
//   app:      company data, always inside withTenant()
//   platform: the tenants table only, for the platform owner console
let appPool: postgres.Sql | undefined;
let platformPool: postgres.Sql | undefined;

function url(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function appDb(): postgres.Sql {
  appPool ??= postgres(url("DATABASE_URL_APP"), { max: 10, onnotice: () => {} });
  return appPool;
}

export function platformDb(): postgres.Sql {
  platformPool ??= postgres(url("DATABASE_URL_PLATFORM"), { max: 3, onnotice: () => {} });
  return platformPool;
}

export async function closeDb() {
  await Promise.all([appPool?.end(), platformPool?.end()]);
  appPool = platformPool = undefined;
}
