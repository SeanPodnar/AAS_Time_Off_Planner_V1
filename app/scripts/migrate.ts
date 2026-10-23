// Applies db/migrations/*.sql in order, once each, as the admin (owner) role.
// Also creates the two runtime login roles, taking their names and passwords from
// DATABASE_URL_APP and DATABASE_URL_PLATFORM so there is one source of truth.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "db", "migrations");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function credentials(url: string, expectedUser: string) {
  const u = new URL(url);
  if (decodeURIComponent(u.username) !== expectedUser) {
    throw new Error(`Connection URL must use role ${expectedUser}, got ${u.username}`);
  }
  return { user: expectedUser, password: decodeURIComponent(u.password) };
}

export async function migrate(adminUrl = required("DATABASE_URL_ADMIN")) {
  const roles = [
    credentials(required("DATABASE_URL_APP"), "aas_app"),
    credentials(required("DATABASE_URL_PLATFORM"), "aas_platform"),
  ];
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    for (const r of roles) {
      const [exists] = await sql`select 1 from pg_roles where rolname = ${r.user}`;
      if (!exists) await sql.unsafe(`create role ${r.user} login nobypassrls`);
      if (r.password) await sql.unsafe(`alter role ${r.user} password ${quote(r.password)}`);
    }
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name as string));
    for (const f of files) {
      if (done.has(f)) continue;
      const body = await readFile(path.join(migrationsDir, f), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${f})`;
      });
      console.log(`applied ${f}`);
    }
  } finally {
    await sql.end();
  }
}

function quote(s: string) {
  return `'${s.replace(/'/g, "''")}'`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
