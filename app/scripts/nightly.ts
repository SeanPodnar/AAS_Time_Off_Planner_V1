// Scheduled jobs for every company: post accruals up to the company's own today, then send
// approval reminders and escalations. Safe to run as often as you like (posting is idempotent
// and each step is reminded and escalated once). Schedule it hourly in production so each
// company is handled soon after its own midnight; until then run it by hand: npm run jobs
import { closeDb, platformDb } from "../src/lib/db";
import { getSettings } from "../src/lib/people";
import { postAccruals } from "../src/lib/accrual/post";
import { todayIn } from "../src/lib/accrual/dates";
import { sendFollowUps } from "../src/lib/requests/followups";

const tenants = await platformDb()`select id, short_label, country, subdomain, custom_domain from tenants order by short_label`;
for (const t of tenants) {
  const { timeZone } = await getSettings(t.id, t.country);
  const asOf = todayIn(timeZone);
  const r = await postAccruals(t.id, { asOf, actor: "system:nightly" });
  const root = process.env.ROOT_DOMAIN ?? "localhost";
  const baseUrl = t.custom_domain ? `https://${t.custom_domain}` : root === "localhost" ? `http://${t.subdomain}.localhost:3000` : `https://${t.subdomain}.${root}`;
  const f = await sendFollowUps({ tenantId: t.id, label: t.short_label, timeZone, baseUrl });
  console.log(`${t.short_label}: ${r.posted} accrual rows as of ${asOf}${r.warnings.length ? `, ${r.warnings.length} warnings` : ""}; ${f.reminded} reminders, ${f.escalated} escalations`);
}
await closeDb();
