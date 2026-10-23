import { listActivePeopleNames } from "@/lib/people";
import { listBackups } from "@/lib/requests/followups";
import type { requestContext } from "./context";

type Ctx = Awaited<ReturnType<typeof requestContext>>;

/** Everything the backup card on /approvals needs: active people and current or future backups. */
export async function backupData({ site, user, company, actor }: Ctx) {
  const [people, backups] = await Promise.all([listActivePeopleNames(site.tenant.id), listBackups(company, actor)]);
  return { people, backups, choices: people.filter((p) => p.id !== user.personId) };
}
