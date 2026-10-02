import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Briefcase, User } from "lucide-react";
import { cn } from "@/lib/utils";

export type BusinessProfile = {
  corporate_id: string; employee_id: string; name: string; role: string;
  per_trip_cap_cents: number | null; monthly_cap_cents: number | null; requires_approval: boolean;
  month_spent_cents: number; wallet_cents: number; company_status: string;
};
export type BookingContext =
  | { context: "personal"; payment: "mpesa" | "cash" | "wallet" }
  | { context: "business"; profile: BusinessProfile; purpose: string; costCenter: string };

const kes = (c: number) => `KSh ${(c / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const PAY: { id: "mpesa" | "cash" | "wallet"; label: string }[] = [
  { id: "mpesa", label: "M-Pesa" }, { id: "cash", label: "Cash" }, { id: "wallet", label: "TaxiD wallet" },
];

/** One TaxiD identity — choose who pays for this trip. */
export function BookingProfilePicker({ value, onChange, fareCents }: {
  value: BookingContext; onChange: (v: BookingContext) => void; fareCents: number | null;
}) {
  const [business, setBusiness] = useState<BusinessProfile[]>([]);
  useEffect(() => {
    supabase.rpc("rider_booking_profiles").then(({ data }) => setBusiness(((data as any)?.business ?? []) as BusinessProfile[]));
  }, []);

  const sel = value.context === "business" ? value.profile : null;
  const remainingMonth = sel?.monthly_cap_cents != null ? sel.monthly_cap_cents - sel.month_spent_cents : null;
  const needsApproval = sel && fareCents != null && (
    sel.requires_approval
    || (sel.per_trip_cap_cents != null && fareCents > sel.per_trip_cap_cents)
    || (remainingMonth != null && fareCents > remainingMonth));

  return (
    <div className="space-y-3 text-sm" data-testid="booking-profile">
      <div className="text-xs font-medium">Who's paying for this trip?</div>
      <div className="flex flex-wrap gap-2" role="radiogroup">
        <button type="button" role="radio" aria-checked={value.context === "personal"}
          onClick={() => onChange({ context: "personal", payment: value.context === "personal" ? value.payment : "mpesa" })}
          className={cn("flex items-center gap-2 rounded-md border px-3 py-2", value.context === "personal" && "border-primary bg-primary/5")}>
          <User className="h-4 w-4" /> Personal
        </button>
        {business.map((b) => (
          <button key={b.corporate_id} type="button" role="radio" aria-checked={sel?.corporate_id === b.corporate_id}
            disabled={b.company_status !== "ACTIVE"}
            onClick={() => onChange({ context: "business", profile: b, purpose: value.context === "business" ? value.purpose : "", costCenter: value.context === "business" ? value.costCenter : "" })}
            className={cn("flex items-center gap-2 rounded-md border px-3 py-2 disabled:opacity-50", sel?.corporate_id === b.corporate_id && "border-primary bg-primary/5")}>
            <Briefcase className="h-4 w-4" /> {b.name}
          </button>
        ))}
      </div>

      {value.context === "personal" ? (
        <div className="flex flex-wrap gap-2">
          {PAY.map((p) => (
            <button key={p.id} type="button" onClick={() => onChange({ context: "personal", payment: p.id })}
              className={cn("rounded-full border px-3 py-1 text-xs", value.payment === p.id && "border-primary bg-primary text-primary-foreground")}>{p.label}</button>
          ))}
          {business.length === 0 && <p className="w-full text-[11px] text-muted-foreground">Travelling for work? Ask your company admin to add you, and your company will appear here.</p>}
        </div>
      ) : sel && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <p className="text-xs">Charged to <b>{sel.name}</b> — you won't pay personally.</p>
          <Input aria-label="Trip purpose" placeholder="Trip purpose (required), e.g. client meeting" maxLength={200}
            value={value.purpose} onChange={(e) => onChange({ ...value, purpose: e.target.value })} />
          <Input aria-label="Cost centre" placeholder="Cost centre (optional)" maxLength={40}
            value={value.costCenter} onChange={(e) => onChange({ ...value, costCenter: e.target.value })} />
          <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
            {sel.per_trip_cap_cents != null && <span>Per-trip limit: {kes(sel.per_trip_cap_cents)}</span>}
            {remainingMonth != null && <span>Left this month: {kes(Math.max(0, remainingMonth))}</span>}
          </div>
          {needsApproval && <p className="text-xs text-warning">This trip needs your company's approval before a driver is sent.</p>}
        </div>
      )}
    </div>
  );
}
