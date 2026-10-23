// Adds (or reactivates) a platform owner who can sign in at the platform's root address.
// Usage: npm run platform:add-owner -- someone@example.com "Full Name"
import { platformDb, closeDb } from "../src/lib/db";

const [email, ...nameParts] = process.argv.slice(2);
const fullName = nameParts.join(" ").trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !fullName) {
  console.error('Usage: npm run platform:add-owner -- someone@example.com "Full Name"');
  process.exit(1);
}
const db = platformDb();
const [existing] = await db`select id from platform_owners where lower(email) = lower(${email})`;
if (existing) await db`update platform_owners set active = true, full_name = ${fullName} where id = ${existing.id}`;
else await db`insert into platform_owners (email, full_name) values (${email.trim()}, ${fullName})`;
console.log(`${fullName} <${email}> can now sign in to the platform console.`);
await closeDb();
