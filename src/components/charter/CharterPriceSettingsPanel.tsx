/**
 * Operator pricing settings console.
 *
 * Moved out of the public marketing page — cost inputs, demand and season
 * indices and empty-leg discounts are commercial governance, not shopfront
 * content. Rendered inside the Charter Business Portal.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { SlidersHorizontal } from "lucide-react";
import type { CostSettings } from "@/lib/charter/catalog";

interface Props {
  value: CostSettings;
  onChange: (next: CostSettings) => void;
  onReset?: () => void;
  currency?: string;
  unitLabel?: string;
  feesLabel?: string;
  crewLabel?: string;
}

const NumField = ({
  id, label, value, onChange,
}: { id: string; label: string; value: number; onChange: (v: number) => void }) => (
  <div>
    <Label htmlFor={id} className="text-sm">{label}</Label>
    <Input
      id={id}
      type="number"
      min={0}
      className="mt-2"
      value={value}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
    />
  </div>
);

export function CharterPriceSettingsPanel({
  value, onChange, onReset, currency = "KES", unitLabel = "day",
  feesLabel = "Station & permit fees", crewLabel = "Crew",
}: Props) {
  const patch = (k: keyof CostSettings, v: number) => onChange({ ...value, [k]: v });

  return (
    <section
      id="charter-price-settings"
      aria-labelledby="charter-price-settings-heading"
      className="rounded-2xl border border-border bg-card p-6 space-y-5"
    >
      <div className="flex items-start gap-3">
        <SlidersHorizontal className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
        <div>
          <h2 id="charter-price-settings-heading" className="font-semibold text-lg">Price settings</h2>
          <p className="text-sm text-muted-foreground">
            Operator cost inputs applied to every quotation raised from this portal.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumField id="pp-fuel-price" label={`Fuel price / unit (${currency})`} value={value.fuelPrice} onChange={(v) => patch("fuelPrice", v)} />
        <NumField id="pp-fuel-burn" label={`Fuel burn per ${unitLabel}`} value={value.fuelBurn} onChange={(v) => patch("fuelBurn", v)} />
        <NumField id="pp-fees" label={`${feesLabel} per ${unitLabel}`} value={value.airportFees} onChange={(v) => patch("airportFees", v)} />
        <NumField id="pp-crew" label={`${crewLabel} cost per ${unitLabel}`} value={value.crewCost} onChange={(v) => patch("crewCost", v)} />
      </div>

      <div className="space-y-5">
        <div>
          <Label htmlFor="pp-demand">Demand index — ×{value.demandIndex.toFixed(2)}</Label>
          <Slider id="pp-demand" className="mt-3" min={0.6} max={2} step={0.05}
            value={[value.demandIndex]} onValueChange={([v]) => patch("demandIndex", v)} />
        </div>
        <div>
          <Label htmlFor="pp-season">Season index — ×{value.seasonIndex.toFixed(2)}</Label>
          <Slider id="pp-season" className="mt-3" min={0.6} max={2} step={0.05}
            value={[value.seasonIndex]} onValueChange={([v]) => patch("seasonIndex", v)} />
        </div>
        <div>
          <Label htmlFor="pp-empty-leg">Empty-leg discount — {value.emptyLegDiscountPct}%</Label>
          <Slider id="pp-empty-leg" className="mt-3" min={0} max={60} step={1}
            value={[value.emptyLegDiscountPct]} onValueChange={([v]) => patch("emptyLegDiscountPct", v)} />
        </div>
      </div>

      {onReset && (
        <Button variant="outline" size="sm" onClick={onReset}>Reset to operator defaults</Button>
      )}
    </section>
  );
}

export default CharterPriceSettingsPanel;
