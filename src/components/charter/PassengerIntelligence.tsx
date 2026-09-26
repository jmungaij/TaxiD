/**
 * Passenger intelligence (Document System 2.0).
 *
 * Captures the passenger profile facts that change which vehicle should be
 * dispatched — VIP travellers, children, accessibility needs and luggage
 * volume — then recommends the right charter configuration. The captured
 * profile is printed on the travel document so the operator, driver and
 * corporate approver all see the same requirements.
 */
import { Accessibility, Baby, Briefcase, Crown, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface PassengerIntelligence {
  vipCount: number;
  childCount: number;
  wheelchairCount: number;
  /** Total luggage pieces (standard 23 kg cases). */
  luggagePieces: number;
  needsRestStops: boolean;
  needsRefrigeration: boolean;
  assistanceNotes: string;
}

export const EMPTY_PASSENGER_INTELLIGENCE: PassengerIntelligence = {
  vipCount: 0,
  childCount: 0,
  wheelchairCount: 0,
  luggagePieces: 0,
  needsRestStops: false,
  needsRefrigeration: false,
  assistanceNotes: "",
};

export interface CharterRecommendation {
  headline: string;
  reasons: string[];
  /** Amenities the assigned vehicle must carry. */
  requiredAmenities: string[];
}

/** Deterministic recommendation engine — no model call, fully auditable. */
export function recommendCharter(
  intel: PassengerIntelligence,
  passengers: number,
): CharterRecommendation {
  const reasons: string[] = [];
  const amenities = new Set<string>(["Air conditioning", "USB charging"]);
  let headline = "Standard executive coach configuration is the best fit.";

  if (intel.vipCount > 0) {
    headline = "Executive VIP configuration recommended.";
    reasons.push(`${intel.vipCount} VIP passenger(s) — reclining executive seating and privacy curtains.`);
    amenities.add("Wi-Fi");
    amenities.add("Refrigerator");
  }
  if (intel.wheelchairCount > 0) {
    headline = "Wheelchair-accessible vehicle required.";
    reasons.push(`${intel.wheelchairCount} wheelchair space(s) — ramp-equipped vehicle with securing points.`);
    amenities.add("Wheelchair accessibility");
  }
  if (intel.childCount > 0) {
    reasons.push(`${intel.childCount} child passenger(s) — child restraints and an onboard attendant.`);
    amenities.add("Onboard restroom");
  }
  const luggagePerHead = passengers > 0 ? intel.luggagePieces / passengers : 0;
  if (luggagePerHead > 1.5) {
    reasons.push(
      `${intel.luggagePieces} luggage pieces (${luggagePerHead.toFixed(1)} per passenger) — upsize to a high-capacity hold or add a trailer.`,
    );
  } else if (intel.luggagePieces > 0) {
    reasons.push(`${intel.luggagePieces} luggage pieces fit the standard hold.`);
  }
  if (intel.needsRestStops) {
    reasons.push("Scheduled rest stops added to the mission timeline every 3 hours.");
  }
  if (intel.needsRefrigeration) {
    reasons.push("Refrigerated onboard storage requested.");
    amenities.add("Refrigerator");
  }
  if (!reasons.length) {
    reasons.push("No special requirements captured — any compliant vehicle in this class is suitable.");
  }
  return { headline, reasons, requiredAmenities: [...amenities] };
}

/** Document lines describing the passenger profile. */
export function passengerIntelligenceLines(intel: PassengerIntelligence): string[] {
  const out: string[] = [];
  if (intel.vipCount) out.push(`VIP passengers: ${intel.vipCount}`);
  if (intel.childCount) out.push(`Children: ${intel.childCount}`);
  if (intel.wheelchairCount) out.push(`Wheelchair spaces: ${intel.wheelchairCount}`);
  if (intel.luggagePieces) out.push(`Luggage pieces: ${intel.luggagePieces}`);
  if (intel.needsRestStops) out.push("Rest stops: required every 3 hours");
  if (intel.needsRefrigeration) out.push("Onboard refrigeration: required");
  if (intel.assistanceNotes.trim()) out.push(`Special assistance: ${intel.assistanceNotes.trim()}`);
  return out;
}

interface Props {
  value: PassengerIntelligence;
  onChange: (next: PassengerIntelligence) => void;
  passengers: number;
}

export function PassengerIntelligencePanel({ value, onChange, passengers }: Props) {
  const set = <K extends keyof PassengerIntelligence>(k: K, v: PassengerIntelligence[K]) =>
    onChange({ ...value, [k]: v });
  const rec = recommendCharter(value, passengers);

  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-4" aria-label="Passenger intelligence">
      <div>
        <h3 className="font-semibold text-lg">Passenger intelligence</h3>
        <p className="text-sm text-muted-foreground">
          Tell us who is travelling and we will recommend — and dispatch — the right vehicle.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Counter
          id="pi-vip" label="VIP passengers" icon={<Crown className="h-3.5 w-3.5" />}
          value={value.vipCount} onChange={(n) => set("vipCount", n)}
        />
        <Counter
          id="pi-children" label="Children" icon={<Baby className="h-3.5 w-3.5" />}
          value={value.childCount} onChange={(n) => set("childCount", n)}
        />
        <Counter
          id="pi-wheelchair" label="Wheelchair spaces" icon={<Accessibility className="h-3.5 w-3.5" />}
          value={value.wheelchairCount} onChange={(n) => set("wheelchairCount", n)}
        />
        <Counter
          id="pi-luggage" label="Luggage pieces" icon={<Briefcase className="h-3.5 w-3.5" />}
          value={value.luggagePieces} onChange={(n) => set("luggagePieces", n)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle
          id="pi-rest" label="Scheduled rest stops"
          checked={value.needsRestStops} onChange={(v) => set("needsRestStops", v)}
        />
        <Toggle
          id="pi-fridge" label="Onboard refrigeration"
          checked={value.needsRefrigeration} onChange={(v) => set("needsRefrigeration", v)}
        />
      </div>

      <div>
        <Label htmlFor="pi-notes">Special assistance notes</Label>
        <Input
          id="pi-notes" className="mt-2" maxLength={300} value={value.assistanceNotes}
          placeholder="Medical equipment, dietary needs, interpreter…"
          onChange={(e) => set("assistanceNotes", e.target.value)}
        />
      </div>

      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Sparkles className="h-4 w-4" aria-hidden /> {rec.headline}
        </p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {rec.reasons.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          Required amenities: {rec.requiredAmenities.join(", ")}
        </p>
      </div>
    </section>
  );
}

const Counter = ({
  id, label, icon, value, onChange,
}: { id: string; label: string; icon: React.ReactNode; value: number; onChange: (n: number) => void }) => (
  <div>
    <Label htmlFor={id} className="flex items-center gap-1.5">
      {icon} {label}
    </Label>
    <Input
      id={id} type="number" min={0} max={99} className="mt-2" value={value}
      onChange={(e) => onChange(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
    />
  </div>
);

const Toggle = ({
  id, label, checked, onChange,
}: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
    <Label htmlFor={id} className="text-sm">{label}</Label>
    <Switch id={id} checked={checked} onCheckedChange={onChange} />
  </div>
);

export default PassengerIntelligencePanel;
