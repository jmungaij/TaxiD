import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRightLeft, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";
import {
  AP360_STATUS_COPY, ap360ShadowCompare,
  type Ap360QuoteInput, type Ap360ShadowCompare as ShadowResult,
} from "@/lib/pricing360/ap360";
import { logPricingAction } from "@/lib/pricing360/audit";

function money(v: number | null | undefined, currency = "KES"): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${currency} ${Math.round(v).toLocaleString()}`;
}

export interface Ap360ShadowCompareProps {
  /** Asset category being compared. */
  categoryCode: string;
  categoryLabel?: string;
  /** Mission inputs the console is already using for its test quote. */
  inputs: Record<string, number>;
  /** Field definitions for the engine, so only relevant inputs are editable. */
  fields: { key: string; label: string }[];
  /** Set false when the backend says this operator may not run comparisons. */
  permitted?: boolean;
}

/**
 * Quote comparison — legacy calculator against the pricing authority.
 *
 * Both figures come from `ap360_shadow_compare` in one server call on identical
 * inputs, so the delta shown is the genuine commercial impact of migrating a
 * family onto Asset Pricing 360. When either side cannot price the request the
 * screen states which side abstained and why; it never substitutes a zero or
 * silently treats an unpriced result as parity.
 */
export function Ap360ShadowCompare({
  categoryCode, categoryLabel, inputs, fields, permitted = true,
}: Ap360ShadowCompareProps) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ShadowResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effective = { ...inputs, ...overrides };

  const run = async () => {
    if (!categoryCode || !permitted) return;
    setRunning(true);
    setError(null);
    try {
      const payload = { category_code: categoryCode, ...effective } as Ap360QuoteInput;
      const res = await ap360ShadowCompare(payload);
      setResult(res);
      await logPricingAction({
        rbac: "allowed",
        action: "simulate",
        entity: "ap360_shadow_compare",
        entityId: categoryCode,
        reason: `Shadow comparison run for ${categoryLabel ?? categoryCode}`,
        after: {
          legacy_total: res.legacy_total, ap360_total: res.ap360_total,
          difference: res.difference, difference_pct: res.difference_pct,
          ap360_status: res.ap360?.status,
        },
        context: { inputs: effective },
      });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "The comparison could not be run");
    } finally {
      setRunning(false);
    }
  };

  if (!permitted) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="h-4 w-4" aria-hidden /> Quote comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning-foreground">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Insufficient permissions — running engine comparisons is restricted to staff with pricing authority.
          </p>
        </CardContent>
      </Card>
    );
  }

  const currency = result?.ap360?.currency ?? "KES";
  const up = (result?.difference ?? 0) > 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-br from-primary/10 via-transparent to-transparent pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowRightLeft className="h-4 w-4" aria-hidden /> Quote comparison · legacy vs pricing authority
        </CardTitle>
        <CardDescription>
          {categoryLabel ?? (categoryCode || "Select an asset category")} — identical inputs, both engines, one server call.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        {fields.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`cmp-${f.key}`}>{f.label}</Label>
                <Input
                  id={`cmp-${f.key}`}
                  type="number"
                  value={String(effective[f.key] ?? 0)}
                  onChange={(e) => setOverrides((o) => ({ ...o, [f.key]: Number(e.target.value) }))}
                />
              </div>
            ))}
          </div>
        )}

        <AppButton
          action="submit"
          analytics="ap360_shadow_compare"
          onClick={() => void run()}
          disabled={running || !categoryCode}
        >
          Compare both engines
        </AppButton>

        {running && <Skeleton className="h-40 w-full" />}

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Comparison unavailable — {error}.
          </p>
        )}

        {result && !running && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border bg-muted/20 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Legacy calculator</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{money(result.legacy_total, currency)}</p>
                {result.legacy_total === null && (
                  <p className="mt-1 text-xs text-warning-foreground">
                    {String(result.legacy?.status ?? "No figure")} — the legacy engine did not price this request.
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Asset Pricing 360</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-primary">{money(result.ap360_total, currency)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {AP360_STATUS_COPY[result.ap360?.status ?? ""] ?? result.ap360?.status}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Difference</p>
                {result.comparable ? (
                  <>
                    <p className={`mt-1 flex items-center gap-2 text-2xl font-semibold tabular-nums ${up ? "text-success" : "text-destructive"}`}>
                      {up ? <TrendingUp className="h-5 w-5" aria-hidden /> : <TrendingDown className="h-5 w-5" aria-hidden />}
                      {money(result.difference, currency)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {result.difference_pct !== null ? `${result.difference_pct > 0 ? "+" : ""}${result.difference_pct}% versus legacy` : "Percentage not computable"}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-warning-foreground">
                    Not comparable — one engine abstained, so no delta is claimed.
                  </p>
                )}
              </div>
            </div>

            {(result.ap360?.lines ?? []).length > 0 && (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  How the authoritative figure was built
                </h4>
                <ul className="space-y-1.5 text-sm">
                  {(result.ap360?.lines ?? []).map((l) => (
                    <li key={l.code} className="flex items-start justify-between gap-4">
                      <span>
                        <span className="font-medium">{l.label}</span>
                        {l.reason && <span className="block text-xs text-muted-foreground">{l.reason}</span>}
                      </span>
                      <span className="tabular-nums">{money(l.amount, currency)}</span>
                    </li>
                  ))}
                </ul>
                <Separator className="my-3" />
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">Engine {result.ap360?.engine_code ?? "—"}</Badge>
                  {result.ap360?.version != null && <Badge variant="outline">Version v{result.ap360.version}</Badge>}
                  {result.ap360?.profitability_band && (
                    <Badge variant="outline">Profitability {result.ap360.profitability_band}</Badge>
                  )}
                  {result.ap360?.tax_rule && <Badge variant="outline">Tax rule {result.ap360.tax_rule}</Badge>}
                </div>
              </section>
            )}

            {(result.ap360?.notices ?? []).length > 0 && (
              <ul className="space-y-1 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                {(result.ap360?.notices ?? []).map((n) => <li key={n.code}>{n.message}</li>)}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default Ap360ShadowCompare;
