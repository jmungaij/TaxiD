/**
 * Shows the company's policy decision for a business trip before booking.
 * The server re-evaluates at confirmation; this is only an early, honest
 * explanation for the rider.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, ShieldAlert, ShieldX, Info } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type PolicyDecision = "COMPLIANT" | "WARNING" | "EXCEPTION" | "BLOCKED";
export interface PolicyResult { decision: PolicyDecision; reasons: { severity: string; message: string; policy?: string }[] }

const VIEW: Record<PolicyDecision, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
  COMPLIANT: { label: "Within company policy", cls: "border-status-success/40 text-status-success", Icon: ShieldCheck },
  WARNING: { label: "Allowed — your company will see a note", cls: "border-warning/50 text-warning", Icon: Info },
  EXCEPTION: { label: "Needs company approval before a driver is sent", cls: "border-warning/50 text-warning", Icon: ShieldAlert },
  BLOCKED: { label: "Not allowed by company policy", cls: "border-destructive/50 text-destructive", Icon: ShieldX },
};

export function PolicyCheck({ corporateId, rideTypeId, fareCents, distanceKm, scheduledFor, onResult }: {
  corporateId: string; rideTypeId: string | null; fareCents: number | null; distanceKm: number | null;
  scheduledFor?: string | null; onResult?: (r: PolicyResult | null) => void;
}) {
  const [res, setRes] = useState<PolicyResult | null>(null);
  useEffect(() => {
    if (!rideTypeId || fareCents == null) { setRes(null); onResult?.(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const { data, error } = await db.rpc("corporate_policy_precheck", {
        _corporate_id: corporateId, _ride_type_id: rideTypeId, _fare_cents: Math.round(fareCents),
        _distance_km: distanceKm, _scheduled_for: scheduledFor ?? null,
      });
      if (!live) return;
      const r = error ? null : (data as PolicyResult);
      setRes(r); onResult?.(r);
    }, 300);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corporateId, rideTypeId, fareCents, distanceKm, scheduledFor]);

  if (!res) return null;
  const v = VIEW[res.decision];
  return (
    <div className={`rounded-md border p-2 text-xs ${v.cls}`} role={res.decision === "BLOCKED" ? "alert" : "status"}>
      <p className="flex items-center gap-1 font-semibold"><v.Icon className="h-3.5 w-3.5" />{v.label}</p>
      {res.reasons.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-foreground">
          {res.reasons.map((r, i) => <li key={i}>{r.message}</li>)}
        </ul>
      )}
    </div>
  );
}
