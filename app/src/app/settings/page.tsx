import { getSettings } from "@/lib/people";
import { timeZoneChoices } from "@/lib/jurisdictions";
import { requireAdmin } from "@/lib/session";
import { CompanyHeader, brandStyle } from "../components/CompanyHeader";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { site, user } = await requireAdmin();
  const s = await getSettings(site.tenant.id, site.tenant.country);
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/settings" />
      <main className="wrap">
        <h1>Company settings</h1>
        <SettingsForm timeZone={s.timeZone} threshold={s.secondApprovalThreshold} reminderAfterDays={s.reminderAfterDays} escalateAfterDays={s.escalateAfterDays} zones={timeZoneChoices()} />
      </main>
    </div>
  );
}
