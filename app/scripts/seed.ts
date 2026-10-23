// Synthetic sample data for development only. Never load real employee data in development.
import { createTenant } from "../src/lib/tenants";
import { withTenant } from "../src/lib/tenancy";
import { closeDb } from "../src/lib/db";

const companies = [
  { legalName: "Northwind Analytics Inc.", shortLabel: "Northwind", subdomain: "northwind", customDomain: "", brandColor: "#2f7fd8", country: "CA",
    people: [["Maya Chen", "maya@northwind.example", "CA-ON"], ["Daniel Okafor", "daniel@northwind.example", "CA-ON"], ["Liam Tremblay", "liam@northwind.example", "CA-QC"]] },
  { legalName: "Harbor & Pine Company LLC", shortLabel: "Harbor & Pine", subdomain: "harborpine", customDomain: "", brandColor: "#2b6cb0", country: "US",
    people: [["Emily Park", "emily@harborpine.example", "US-CA"], ["Jordan Lee", "jordan@harborpine.example", "US-CA"]] },
];

for (const c of companies) {
  const res = await createTenant(c, "Seed script");
  if (!res.ok) { console.log(`skip ${c.shortLabel}: ${Object.values(res.errors).join(" ")}`); continue; }
  await withTenant(res.id, async (tx) => {
    for (const [name, email, jur] of c.people) {
      await tx`insert into people (tenant_id, full_name, email, jurisdiction, hire_date) values (${res.id}, ${name}, ${email}, ${jur}, '2022-01-10')`;
    }
  });
  console.log(`seeded ${c.shortLabel}`);
}
await closeDb();
