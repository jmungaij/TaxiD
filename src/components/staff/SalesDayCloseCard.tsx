/**
 * The commercial day close, answered as three questions:
 * what moved, what is stuck, what happens tomorrow.
 *
 * Every line is a recorded fact: movements written to the lead history today,
 * revenue from won business, the target taken from the register, live response
 * clocks and the ranked next actions the engine derived from them. Nothing here
 * asks the employee to account for their minutes.
 */
import { AlarmClock, ArrowUpRight, FileSignature, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KES, type SalesDayClose } from "@/lib/sales/dayClose";

interface Props {
  data: SalesDayClose | null;
  busy?: boolean;
  onPlaceTasks?: () => void;
}

const STATUS = (pct: number | null) => {
  if (pct === null) return { label: "No target recorded", tone: "secondary" as const };
  if (pct >= 100) return { label: "Exceeding target", tone: "default" as const };
  if (pct >= 85) return { label: "On pace", tone: "secondary" as const };
  if (pct >= 60) return { label: "At risk", tone: "outline" as const };
  return { label: "Behind", tone: "destructive" as const };
};

export function SalesDayCloseCard({ data, busy, onPlaceTasks }: Props) {
  if (!data) return null;
  const { today, month, sla, next_actions: actions, contracts } = data;
  const status = STATUS(month.attainment_pct);

  /* ------------------------------------------------------- 1. what moved */
  const moved: string[] = [];
  if (today.leads_created) moved.push(`${today.leads_created} new lead${today.leads_created === 1 ? "" : "s"} recorded`);
  if (today.stages_advanced) moved.push(`${today.stages_advanced} lead${today.stages_advanced === 1 ? "" : "s"} moved forward`);
  if (today.contracts_signed) moved.push(`${today.contracts_signed} contract${today.contracts_signed === 1 ? "" : "s"} signed`);
  if (today.won_count) moved.push(`${KES(today.revenue_won_kes)} won`);
  if (today.contract_revenue_kes) moved.push(`${KES(today.contract_revenue_kes)} revenue recorded`);

  /* ------------------------------------------------------ 2. what's stuck */
  const stuck: string[] = [];
  if (sla.breached) stuck.push(`${sla.breached} client${sla.breached === 1 ? "" : "s"} waiting past the promised reply`);
  else if (sla.open) stuck.push(`${sla.open} client${sla.open === 1 ? "" : "s"} waiting on your reply`);
  if (contracts?.awaiting_signature) stuck.push(`${contracts.awaiting_signature} waiting for a signed copy`);
  if (contracts?.awaiting_activation) stuck.push(`${contracts.awaiting_activation} signed but not yet started`);

  return (
    <Card data-testid="sales-day-close">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
          How today went
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={status.tone}>{status.label}</Badge>
          {onPlaceTasks && actions.length > 0 && (
            <Button size="sm" variant="secondary" onClick={onPlaceTasks} disabled={busy}>
              {busy ? "Adding…" : "Put tomorrow's top 3 on my list"}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ------------------------------------------------------- 1 */}
        <section>
          <h3 className="text-sm font-medium">What moved today</h3>
          {moved.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing was recorded on your leads today.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1 text-sm">
              {moved.map((m) => (
                <li key={m} className="flex items-start gap-1.5">
                  <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {month.target_kes === null
              ? `${KES(month.figures.revenue_won_kes)} won this month. No target is recorded for you yet.`
              : `${KES(month.figures.revenue_won_kes)} of ${KES(month.target_kes)} this month · ${KES(
                  month.remaining_kes,
                )} still to win.`}
          </p>
        </section>

        {/* ------------------------------------------------------- 2 */}
        <section>
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <AlarmClock className="h-3.5 w-3.5 text-primary" aria-hidden /> What is stuck
          </h3>
          {stuck.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing is waiting on you right now.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1 text-sm">
              {stuck.map((s) => (
                <li key={s}>· {s}</li>
              ))}
            </ul>
          )}
          {sla.clocks.slice(0, 3).map((c) => (
            <div key={`${c.process}-${c.entity_ref}-${c.due_at}`} className="mt-1.5 text-xs">
              <span className={c.breached ? "font-semibold text-destructive" : "font-medium"}>
                {c.organisation ?? c.entity_ref ?? "Customer"}
              </span>{" "}
              <span className="text-muted-foreground">
                — {c.breached ? "reply overdue" : "reply due"}
              </span>
            </div>
          ))}
        </section>

        {/* ------------------------------------------------------- 3 */}
        <section>
          <h3 className="text-sm font-medium">What happens tomorrow</h3>
          {actions.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              No open commercial work — tomorrow starts clear.
            </p>
          ) : (
            <ol className="mt-1.5 space-y-1.5">
              {actions.slice(0, 3).map((a, i) => (
                <li key={a.lead_id} className="flex gap-2 text-sm">
                  <span className="font-semibold text-primary">{i + 1}.</span>
                  <span>
                    <span className="font-medium">{a.organisation ?? a.lead_ref}</span>
                    <span className="text-muted-foreground"> — {a.why}</span>
                    {a.value_kes ? (
                      <span className="text-muted-foreground"> · {KES(a.value_kes)}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Detail stays available, but out of the way. */}
        {(contracts || today.movements.length > 0) && (
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">The detail behind this</summary>
            {contracts && (
              <p className="mt-2 flex items-start gap-1.5 text-muted-foreground">
                <FileSignature className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span>
                  {contracts.activated_this_month} contract
                  {contracts.activated_this_month === 1 ? "" : "s"} live this month ·{" "}
                  {KES(contracts.revenue_recorded_month_kes)} recorded.
                </span>
              </p>
            )}
            {today.movements.length > 0 && (
              <ul className="mt-2 space-y-1">
                {today.movements.map((m, i) => (
                  <li key={`${m.at}-${i}`} className="flex items-start gap-1.5 text-muted-foreground">
                    <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    <span>
                      <span className="font-medium text-foreground">
                        {m.organisation ?? m.lead_ref}
                      </span>{" "}
                      {m.stage_to
                        ? `moved to ${m.stage_to}`
                        : m.action.toLowerCase().split("_").join(" ")}
                      {m.note ? ` — ${m.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
      </CardContent>
    </Card>
  );
}
