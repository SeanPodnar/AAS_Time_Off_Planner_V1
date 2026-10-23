import type { Balance } from "@/lib/accrual/post";

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(x * 4 === Math.round(x * 4) ? 2 : 3).replace(/0+$/, "").replace(/\.$/, ""));
const unit = (b: Balance, x: number) => `${fmt(x)} ${b.unit === "days" ? (Math.abs(x) === 1 ? "day" : "days") : Math.abs(x) === 1 ? "hour" : "hours"}`;

/** Balance cards. Compliance notes are for HR admins only. */
export function Balances({ asOf, balances, showCompliance = false }: { asOf: string; balances: Balance[]; showCompliance?: boolean }) {
  if (balances.length === 0) return <p className="muted">No time off plans assigned yet.</p>;
  return (
    <>
      <div className="grid" style={{ alignItems: "start" }}>
        {balances.map((b) => (
          <div className="card" key={b.planId}>
            <h3>{b.planName}</h3>
            {b.tracked ? (
              <>
                <p className="big">{unit(b, b.balance)}</p>
                <p className="small muted">Available today ({asOf})</p>
                {b.scheduled > 0 && <p className="small">{unit(b, b.scheduled)} booked ahead</p>}
                <p className="small">Projected on {b.planYearEnd}: {unit(b, b.projectedYearEnd)}</p>
              </>
            ) : <p className="small muted">No balance kept. Request it when you need it.</p>}
            {showCompliance && b.compliance.map((c) => <p className={c.level === "warn" ? "small notice warn" : "small muted"} key={c.text}>{c.text}</p>)}
          </div>
        ))}
      </div>
    </>
  );
}
