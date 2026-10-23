// Synthetic sample data for development only. Never load real employee data in development.
import { createTenant } from "../src/lib/tenants";
import { withTenant } from "../src/lib/tenancy";
import { closeDb, platformDb } from "../src/lib/db";
import { assignPlanToAll, savePlan, starterTemplates } from "../src/lib/plans";

const companies = [
  { legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", customDomain: "", brandColor: "#2f7fd8", country: "CA",
    people: [["Daniel Okafor", "daniel@northwind.example", "CA-ON"], ["Maya Chen", "maya@northwind.example", "CA-ON", "daniel@northwind.example"], ["Liam Tremblay", "liam@northwind.example", "CA-QC", "daniel@northwind.example"], ["Priya Shah", "priya@northwind.example", "CA-ON", null, "admin"]] },
  { legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", customDomain: "", brandColor: "#2b6cb0", country: "US",
    people: [["Jordan Lee", "jordan@harborpine.example", "US-CA"], ["Emily Park", "emily@harborpine.example", "US-CA", "jordan@harborpine.example"], ["Hannah Kim", "hannah@harborpine.example", "US-NY", null, "admin"]] },
];

for (const c of companies) {
  const res = await createTenant(c, "Seed script");
  if (!res.ok) { console.log(`skip ${c.shortLabel}: ${Object.values(res.errors).join(" ")}`); continue; }
  await withTenant(res.id, async (tx) => {
    for (const [name, email, jur, managerEmail, role] of c.people as (string | null | undefined)[][]) {
      await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date, role, manager_id)
               values (${res.id}, ${name!}, ${email!}, ${jur!}, '2022-01-10', ${role ?? "employee"},
                       (select id from people where lower(email) = ${managerEmail ?? ""}))`;
    }
  });
  // Starter plans, assigned to everyone from 2026-01-01.
  const admin = await withTenant(res.id, async (tx) => (await tx`select id from people where role = 'admin' limit 1`)[0].id as string);
  const actor = { personId: admin, role: "admin" as const };
  for (const t of starterTemplates) {
    const saved = await savePlan(res.id, actor, t.plan);
    if (!saved.ok) { console.log(`plan ${t.label}: ${Object.values(saved.errors).join(" ")}`); continue; }
    const level = await withTenant(res.id, async (tx) => (await tx`select id from plan_levels where plan_id = ${saved.id} order by sort_order limit 1`)[0].id as string);
    await assignPlanToAll(res.id, actor, { planId: saved.id, levelId: level, effectiveFrom: "2026-01-01" });
  }
  console.log(`seeded ${c.shortLabel}`);
}
await platformDb()`insert into platform_owners (email, full_name) values ('owner@aas.example', 'Sample Platform Owner') on conflict do nothing`;
console.log("platform owner: owner@aas.example");
await closeDb();
