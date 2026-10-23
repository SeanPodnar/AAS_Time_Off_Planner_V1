import { starterTemplates, type PlanInput } from "@/lib/plans";
import { requireAdmin } from "@/lib/session";
import { CompanyHeader, brandStyle } from "../../components/CompanyHeader";
import { PlanForm } from "../PlanForm";

export const dynamic = "force-dynamic";

const BLANK: PlanInput = { ...starterTemplates[0].plan, name: "", category: "other", accrualMethod: "lump_sum", lumpSumTiming: "plan_year_start", frequency: null, carryover: "none", carryoverCap: null, levels: [] };

export default async function NewPlanPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const { site, user } = await requireAdmin();
  const { template } = await searchParams;
  const found = starterTemplates.find((t) => t.key === template);
  return (
    <div style={brandStyle(site.tenant)}>
      <CompanyHeader tenant={site.tenant} user={user} current="/plans" />
      <main className="wrap">
        <h1>{found ? `Add a ${found.label.toLowerCase()} plan` : "Add a plan"}</h1>
        <PlanForm plan={found?.plan ?? BLANK} />
      </main>
    </div>
  );
}
