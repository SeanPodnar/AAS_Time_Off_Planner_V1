import postgres from "postgres";
import { migrate } from "../../scripts/migrate";

export const hasDb = Boolean(process.env.DATABASE_URL_ADMIN);
if (process.env.CI && !hasDb) throw new Error("DATABASE_URL_ADMIN must be set in CI so the isolation tests run");

/** Drops everything in the test database and re-applies all migrations. */
export async function resetDb() {
  const admin = postgres(process.env.DATABASE_URL_ADMIN!, { max: 1, onnotice: () => {} });
  await admin.unsafe("drop schema if exists public cascade; create schema public; grant usage on schema public to public;");
  await admin.end();
  await migrate();
}

export function connect(name: "DATABASE_URL_ADMIN" | "DATABASE_URL_APP" | "DATABASE_URL_PLATFORM") {
  return postgres(process.env[name]!, { max: 2, onnotice: () => {} });
}

/**
 * A Monday at least a week out with no Ontario holidays for the next nine weeks or the
 * Friday before: the Monday after the next Thanksgiving (mid-October to mid-December has none).
 * Request tests use it so holidays never change their day counts.
 */
export async function quietMonday(): Promise<string> {
  const { holidaysFor } = await import("../../src/lib/holidays/rules");
  const { addDays, todayIn } = await import("../../src/lib/accrual/dates");
  const today = todayIn("America/Toronto");
  for (let y = Number(today.slice(0, 4)); ; y++) {
    const t = holidaysFor("CA-ON", y).find((h) => h.key === "thanksgiving")!.date;
    if (t > addDays(today, 7)) return addDays(t, 7);
  }
}
