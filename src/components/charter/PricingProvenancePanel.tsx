import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, CheckCircle2, Database, Gauge, Info } from "lucide-react";
import { formatKes, type MissionFare } from "@/lib/charter/smartFare";
import { buildMissionProvenance } from "@/lib/charter/pricingProvenance";

const TONE_CLASS: Record<string, string> = {
  live: "border-primary/40 bg-primary/10 text-primary",
  published: "border-border bg-muted text-foreground",
  estimated: "border-status-warning/40 bg-status-warning/10 text-status-warning dark:text-status-warning",
  selected: "border-border bg-muted text-muted-foreground",
};

/**
 * Pricing provenance panel — shows exactly which live inputs produced the
 * SmartFare price and what was missing when an indicative value is shown.
 */
export function PricingProvenancePanel({ fare }: { fare: MissionFare }) {
  const p = buildMissionProvenance(fare);
  const confirmed = p.basis === "operator_calculated";

  return (
    <Card className="border-border/70">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4 text-primary" aria-hidden />
              Pricing provenance
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{p.basisLabel}</p>
          </div>
          <Badge variant={confirmed ? "default" : "outline"} className="gap-1">
            {confirmed
              ? <CheckCircle2 className="h-3 w-3" aria-hidden />
              : <Gauge className="h-3 w-3" aria-hidden />}
            {p.operatorCoveragePct}% operator-sourced
          </Badge>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
          <div className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.max(2, p.operatorCoveragePct)}%` }} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Live inputs used
          </h4>
          <ul className="space-y-2">
            {p.layers.map((l) => (
              <li key={l.key} className="rounded-lg border border-border/70 p-2.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{l.label}</span>
                  <span className="tabular-nums">{formatKes(l.amount)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${TONE_CLASS[l.tone]}`}>
                    {l.sourceLabel}
                  </span>
                  {l.detail && <span className="text-xs text-muted-foreground">{l.detail}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <Separator />

        <section>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Missing data behind the indicative value
          </h4>
          {p.missing.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing missing — every cost layer came from the operator's submitted rate card.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {p.missing.map((m) => (
                <li key={m.key} className="text-xs">
                  <span className="font-medium text-foreground">{m.label}</span>
                  <span className="block text-muted-foreground">{m.impact}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {p.savings.length > 0 && (
          <>
            <Separator />
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Discount provenance
              </h4>
              <ul className="space-y-1.5">
                {p.savings.map((s) => (
                  <li key={s.key} className="text-xs">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium text-foreground">{s.label}</span>
                      <span className="tabular-nums text-primary">− {formatKes(s.amount)}</span>
                    </div>
                    <span className="block text-muted-foreground">{s.explanation} · {s.source}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Rate card: {p.operator ? `${p.operator.operatorName} · submitted ${new Date(p.operator.submittedAt).toLocaleDateString("en-KE")}` : "none matched"} ·
            {" "}Admin pricing configuration v{p.configVersion}
            {p.configActor ? ` by ${p.configActor}` : ""}.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default PricingProvenancePanel;
