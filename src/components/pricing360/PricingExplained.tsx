import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Fuel, Gauge, Info, Receipt, ShieldCheck, TrendingUp } from "lucide-react";
import { AP360_STATUS_COPY, isPriced, type Ap360Quote } from "@/lib/pricing360/ap360";

const money = (n: number | null | undefined, currency = "KES") =>
  typeof n === "number" ? `${currency} ${Math.round(n).toLocaleString()}` : "—";

const BAND_TONE: Record<string, string> = {
  GREEN: "bg-success/10 text-success border-success/30",
  AMBER: "bg-warning/10 text-warning-foreground border-warning/30",
  RED: "bg-destructive/10 text-destructive border-destructive/30",
  UNPROVEN: "bg-muted text-muted-foreground border-border",
};

const POSITION_COPY: Record<string, string> = {
  MARKET_ALIGNED: "Within the observed market band",
  LOW_PRICE_WARNING: "Below the market median — margin risk",
  PREMIUM_WARNING: "Above the market median — premium position",
  MARKET_OUTLIER: "Far above the market — justify or reprice",
  NO_MARKET_DATA: "No market references recorded",
};

interface Props {
  quote: Ap360Quote | null;
  loading?: boolean;
  /** Commercial detail (floor, commission, margin) is staff-only. */
  showGovernance?: boolean;
  title?: string;
}

/**
 * Pricing explained — the traceable story behind one price.
 *
 * Every figure shown here comes from the `ap360_quote` response: the engine
 * lines, the indexed fuel, the tax rule, the demand ceiling and the economic
 * floor. Nothing on this panel is recomputed in the browser, so what the
 * customer reads is exactly what the pricing authority decided.
 */
export function PricingExplained({ quote, loading = false, showGovernance = false, title = "Pricing explained" }: Props) {
  if (loading) {
    return (
      <Card className="border-border/70">
        <CardContent className="p-6 text-sm text-muted-foreground">Asking the pricing authority…</CardContent>
      </Card>
    );
  }
  if (!quote) return null;

  const priced = isPriced(quote);
  const currency = quote.currency ?? "KES";
  const notices = quote.notices ?? [];

  if (!priced) {
    return (
      <Card className="border-warning/40 bg-warning/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
            {quote.status === "QUOTE_REQUIRED" ? "Priced by negotiated quote" : "No governed price"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{quote.message ?? quote.error ?? AP360_STATUS_COPY[quote.status] ?? "No price is available."}</p>
          {quote.indicative_from && (
            <p className="text-muted-foreground">
              Indicative range {money(Number(quote.indicative_from), currency)} – {money(Number(quote.indicative_to), currency)}
              {quote.quote_validity_days ? ` · quote valid ${quote.quote_validity_days} days` : ""}
            </p>
          )}
          {notices.map((n) => (
            <p key={n.code} className="text-xs text-muted-foreground">{n.message}</p>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-border/70 bg-card/80 backdrop-blur">
      <CardHeader className="bg-gradient-to-br from-primary/10 via-transparent to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {quote.category_label ?? quote.category_code} · engine {quote.engine_code} · pricing version v{quote.version}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold tracking-tight">{money(quote.customer_price, currency)}</div>
            <p className="text-xs text-muted-foreground">
              {quote.tax && quote.tax > 0 ? "Tax included as shown below" : "Tax per governed rule"}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1">
            <Gauge className="h-3 w-3" aria-hidden />
            Demand ×{quote.demand_applied ?? 1} (ceiling {quote.demand_ceiling ?? 1})
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Receipt className="h-3 w-3" aria-hidden />
            {quote.tax_rule ?? "No tax rule"}
          </Badge>
          {showGovernance && (
            <Badge variant="outline" className={BAND_TONE[quote.profitability_band ?? "UNPROVEN"]}>
              Margin {quote.profitability_band}
              {typeof quote.contribution_pct === "number" ? ` · ${quote.contribution_pct}%` : " · unproven"}
            </Badge>
          )}
          {quote.market_position && (
            <Badge variant="secondary" className="gap-1">
              <TrendingUp className="h-3 w-3" aria-hidden />
              {POSITION_COPY[quote.market_position] ?? quote.market_position}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-6">
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            How this price was built
          </h4>
          <ul className="space-y-2">
            {(quote.lines ?? []).map((line, i) => (
              <li key={`${line.code}-${i}`} className="flex items-start justify-between gap-4 text-sm">
                <span>
                  <span className="font-medium">{line.label}</span>
                  {line.reason && <span className="block text-xs text-muted-foreground">{line.reason}</span>}
                </span>
                <span className="tabular-nums">{money(line.amount, currency)}</span>
              </li>
            ))}
          </ul>
          <Separator className="my-3" />
          <div className="flex justify-between text-sm">
            <span>Subtotal before discount</span>
            <span className="tabular-nums">{money(quote.subtotal, currency)}</span>
          </div>
          {!!quote.discount && (
            <div className="flex justify-between text-sm text-success">
              <span>Discount applied</span>
              <span className="tabular-nums">− {money(quote.discount, currency)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span>Net before tax</span>
            <span className="tabular-nums">{money(quote.net_before_tax, currency)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <span>Customer price</span>
            <span className="tabular-nums">{money(quote.customer_price, currency)}</span>
          </div>
        </section>

        {showGovernance && (
          <section className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Economic floor and settlement
            </h4>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <Row label="Direct cost" value={money(quote.direct_cost, currency)} />
              <Row label="Overhead" value={money(quote.overhead, currency)} />
              <Row label="Risk reserve" value={money(quote.risk_reserve, currency)} />
              <Row label="Operator economic floor" value={money(quote.operator_floor, currency)} />
              <Row label="TaxiD commission" value={money(quote.commission, currency)} />
              <Row label="Operator net" value={money(quote.operator_net, currency)} />
              <Row label="Market median" value={money(quote.market?.median ?? null, currency)} />
              <Row label="Market band" value={`${money(quote.market?.low ?? null, currency)} – ${money(quote.market?.high ?? null, currency)}`} />
            </dl>
          </section>
        )}

        {notices.length > 0 && (
          <section className="space-y-1 rounded-lg border border-info/30 bg-info/5 p-3">
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-info">
              <Info className="h-3.5 w-3.5" aria-hidden /> Governance notices
            </h4>
            {notices.map((n) => (
              <p key={n.code} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{n.code}</span> — {n.message}
              </p>
            ))}
          </section>
        )}

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Fuel className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Fuel is indexed from the published fuel reference, tax from the governed tax rule, and demand uplift is
          capped by the published ceiling. Calculated {quote.calculated_at ? new Date(quote.calculated_at).toLocaleString() : "now"}.
        </p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export default PricingExplained;
