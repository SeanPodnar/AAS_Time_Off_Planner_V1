import { listPeople, listTeamsAndLocations } from "@/lib/people";
import { requireAdmin } from "@/lib/session";
import { CompanyHeader, brandStyle } from "../../components/CompanyHeader";
import { PersonForm } from "../PersonForm";

export const dynamic = "force-dynamic";

export default async function NewPersonPage() {
  const { site, user, actor } = await requireAdmin();
  const [people, lists] = await Promise.all([listPeople(site.tenant.id, actor), listTeamsAndLocations(site.tenant.id)]);
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/people" />
      <main className="wrap">
        <h1>Add a person</h1>
        <PersonForm managers={people.map((p) => ({ id: p.id, name: p.fullName }))} teams={lists.teams} locations={lists.locations} />
      </main>
    </div>
  );
}
