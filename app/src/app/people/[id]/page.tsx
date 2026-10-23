import { notFound } from "next/navigation";
import { getPerson, listPeople, listTeamsAndLocations } from "@/lib/people";
import { requireAdmin } from "@/lib/session";
import { CompanyHeader, brandStyle } from "../../components/CompanyHeader";
import { PersonForm } from "../PersonForm";
import { setStatusAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditPersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; status?: string; error?: string }> }) {
  const { site, user, actor } = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const person = await getPerson(site.tenant.id, actor, id);
  if (!person) notFound();
  const [people, lists] = await Promise.all([listPeople(site.tenant.id, actor), listTeamsAndLocations(site.tenant.id)]);
  const active = person.status === "active";
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/people" />
      <main className="wrap">
        <div className="pagehead">
          <div><h1>{person.fullName}</h1><p className="muted">{person.jobTitle ?? "No job title"} · {active ? "Active" : "Inactive"}</p></div>
          <form action={setStatusAction}>
            <input type="hidden" name="id" value={person.id} />
            <input type="hidden" name="status" value={active ? "inactive" : "active"} />
            <button className="btn secondary" type="submit">{active ? "Deactivate" : "Reactivate"}</button>
          </form>
        </div>
        {sp.saved && <p className="notice ok" role="status">Saved.</p>}
        {sp.status === "inactive" && <p className="notice ok" role="status">{person.fullName} is deactivated and signed out everywhere. Their records stay for reports.</p>}
        {sp.status === "active" && <p className="notice ok" role="status">{person.fullName} can sign in again.</p>}
        {sp.error && <p className="notice warn" role="alert">{sp.error}</p>}
        <PersonForm person={person} managers={people.map((p) => ({ id: p.id, name: p.fullName }))} teams={lists.teams} locations={lists.locations} />
      </main>
    </div>
  );
}
