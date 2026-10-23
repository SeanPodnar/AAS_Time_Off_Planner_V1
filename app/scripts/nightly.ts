// Nightly accrual run: posts every company's accruals up to its own today. Safe to run more than
// once a day (posting is idempotent). Schedule it hourly in production so each company is posted
// soon after its own midnight; until then run it by hand: npm run accrual:nightly
import { closeDb, platformDb } from "../src/lib/db";
import { getSettings } from "../src/lib/people";
import { postAccruals } from "../src/lib/accrual/post";
import { todayIn } from "../src/lib/accrual/dates";

const tenants = await platformDb()`select id, short_label, country from tenants order by short_label`;
for (const t of tenants) {
  const { timeZone } = await getSettings(t.id, t.country);
  const asOf = todayIn(timeZone);
  const r = await postAccruals(t.id, { asOf, actor: "system:nightly" });
  console.log(`${t.short_label}: ${r.posted} rows posted as of ${asOf}${r.warnings.length ? `, ${r.warnings.length} warnings` : ""}`);
}
await closeDb();
