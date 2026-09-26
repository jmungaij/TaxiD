/**
 * Negotiation panel — recommended price vs selling price.
 *
 * The salesperson may propose any price. Nothing here blocks a commercial
 * decision: the panel shows the variance, the configured guardrail, the margin
 * where cost data exists and the market reference, then hands the proposed
 * price to the quotation builder.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  resolvePrice,
  priceSignal,
  SIGNAL_LABELS,
  describeTerms,
  explainLines,
  PRICE_SOURCE_LABELS,
  type PriceResolution,
} from "@/lib/pricing/competitive";

const money = (v: number | null | undefined, currency = "KES") =>
  v === null || v === undefined ? "—" : `${currency} ${Math.round(Number(v)).toLocaleString("en-KE")}`;

const signalTone: Record<string, string> = {
  RECOMMENDED: "bg-success/10 text-success border-success/30",
  NEAR_RECOMMENDED: "bg-success/10 text-success border-success/30",
  BELOW_RECOMMENDED: "bg-info/10 text-info border-info/30",
  ABOVE_RECOMMENDED: "bg-info/10 text-info border-info/30",
  HIGH_PREMIUM: "bg-warning/10 text-warning border-warning/30",
  APPROVAL_REQUIRED: "bg-warning/10 text-warning border-warning/30",
};

export interface NegotiationValue {
  proposed_amount: number | null;
  commercial_reason: string;
}

export function NegotiationPanel({
  serviceCode,
  scopeLabel,
  categoryCode,
  pricingBasis,
  quantity,
  accountId,
  value,
  onChange,
}: {
  serviceCode: string;
  scopeLabel: string;
  categoryCode: string;
  pricingBasis?: string;
  quantity: number;
  accountId: string | null;
  value: NegotiationValue;
  onChange: (v: NegotiationValue) => void;
}) {
  const [res, setRes] = useState<PriceResolution | null>(null);
  const [loading, setLoading] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  const load = useCallback(async () => {
    if (!serviceCode || !categoryCode) return;
    setLoading(true);
    try {
      const r = await resolvePrice({
        service_code: serviceCode,
        scope_label: scopeLabel,
        category_code: categoryCode,
        pricing_basis: pricingBasis,
        quantity,
        account_id: accountId,
        proposed_amount: value.proposed_amount,
        commercial_reason: value.commercial_reason || null,
      });
      setRes(r);
    } catch {
      setRes(null);
    } finally {
      setLoading(false);
    }
  }, [serviceCode, scopeLabel, categoryCode, pricingBasis, quantity, accountId, value.proposed_amount, value.commercial_reason]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  if (loading && !res) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Resolving the recommended price…
      </div>
    );
  }

  if (!res || res.status !== "OK") {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
        No recommended rate is published for this combination. Raise a pricing request instead of
        inventing a figure — or add the rate on the rate card editor.
      </div>
    );
  }

  const currency = res.currency ?? "KES";
  const variancePct = Number(res.variance_percent ?? 0);
  const signal = priceSignal(variancePct, res.guardrail ?? { code: null, label: "", action: "none", required_role: null });

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Figure label="Recommended" value={money(res.recommended_price, currency)} />
        <Figure label="Customer / contract" value={money(res.customer_rate_price, currency)} />
        <Figure label="Market reference" value={money(res.market_reference, currency)} />
        <Figure label="Selling price" value={money(res.applied_price, currency)} strong />
      </div>

      <p className="text-xs text-muted-foreground">
        {describeTerms({
          pricing_basis: res.pricing_basis ?? "per_day",
          included_distance_km: res.included_distance_km,
          distance_unit: res.distance_unit,
          excess_distance_rate: res.excess_distance_rate,
          included_hours: res.included_hours,
          excess_hour_rate: res.excess_hour_rate,
          currency,
        })}
        {" · "}
        {PRICE_SOURCE_LABELS[res.pricing_source ?? "RECOMMENDED"]}
        {res.rate_card_version ? ` · rate card ${res.rate_card_version}` : ""}
      </p>

      <Separator />

      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <div className="space-y-1.5">
          <Label>Proposed price</Label>
          <Input
            type="number"
            min={0}
            placeholder={String(res.recommended_price ?? "")}
            value={value.proposed_amount ?? ""}
            onChange={(e) =>
              onChange({ ...value, proposed_amount: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label>Commercial reason (optional)</Label>
          <Textarea
            rows={2}
            placeholder="e.g. Competitive corporate introductory rate"
            value={value.commercial_reason}
            onChange={(e) => onChange({ ...value, commercial_reason: e.target.value })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange({ ...value, proposed_amount: null })}
        >
          Use recommended
        </Button>
        {res.customer_rate_price != null && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onChange({ ...value, proposed_amount: Number(res.customer_rate_price) })}
          >
            Use customer rate
          </Button>
        )}
        <Badge variant="outline" className={signalTone[signal] ?? ""}>
          {SIGNAL_LABELS[signal]}
          {variancePct !== 0 ? ` · ${variancePct > 0 ? "+" : ""}${variancePct}%` : ""}
        </Badge>
        {res.margin_amount != null && (
          <Badge variant="outline">
            Margin {money(res.margin_amount, currency)} · {res.margin_percent}%
          </Badge>
        )}
        {res.guardrail?.action === "notify" && (
          <span className="text-xs text-muted-foreground">
            {res.guardrail.label}
            {res.guardrail.required_role ? ` — ${res.guardrail.required_role.replace(/_/g, " ")} informed` : ""}
          </span>
        )}
        {res.guardrail?.action === "approve" && (
          <span className="text-xs text-warning">
            {res.guardrail.label}
            {res.guardrail.required_role ? ` — ${res.guardrail.required_role.replace(/_/g, " ")}` : ""}
            . You can still quote it; it is recorded for approval.
          </span>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={() => setShowWhy((s) => !s)}>
          <Info className="mr-1 h-3.5 w-3.5" /> Why this price?
        </Button>
      </div>

      {showWhy && (
        <ul className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
          {explainLines(res, currency).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={strong ? "text-lg font-semibold tabular-nums" : "text-sm tabular-nums"}>{value}</p>
    </div>
  );
}
