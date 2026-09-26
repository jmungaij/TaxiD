/**
 * Lead-to-revenue flow.
 *
 * One row per lead: where it is, how long it has been there, when it last
 * moved, and the revenue actually recognised against it. Waiting times and
 * revenue are read from the database projections, never estimated here.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FLOW_STEPS,
  KES,
  STEP_LABEL,
  days,
  listLeadFlow,
  listStageBottlenecks,
  nextAction,
  type FlowStep,
} from "@/lib/sales/leadFlow";
import { LeadContactDialog } from "@/components/sales/LeadContactDialog";
import { LeadDetailsDialog } from "@/components/sales/LeadDetailsDialog";
import { OrganisationOnboardingDialog } from "@/components/sales/OrganisationOnboardingDialog";
import { QualifyDealDialog } from "@/components/sales/QualifyDealDialog";


export default function LeadFlowBoard() {
  const [term, setTerm] = React.useState("");
  const [step, setStep] = React.useState<FlowStep | "ALL">("ALL");
  const [owner, setOwner] = React.useState("ALL");

  const qc = useQueryClient();
  const flow = useQuery({ queryKey: ["lead-flow"], queryFn: listLeadFlow });
  const stages = useQuery({ queryKey: ["lead-flow-stages"], queryFn: listStageBottlenecks });

  // Leads move on the board the moment a record changes — a new partner
  // application becoming a lead, a stage moving on, revenue being recognised.
  React.useEffect(() => {
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ["lead-flow"] });
      void qc.invalidateQueries({ queryKey: ["lead-flow-stages"] });
    };
    const channel = supabase
      .channel("lead-flow-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_leads" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_lead_events" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "commercial_lifecycle" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "partner_applications" }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  const rows = (flow.data ?? []).filter((r) => !r.is_test);
  const owners = Array.from(new Set(rows.map((r) => r.owner_name).filter(Boolean))) as string[];

  const filtered = rows.filter((r) => {
    if (step !== "ALL" && r.step !== step) return false;
    if (owner !== "ALL" && r.owner_name !== owner) return false;
    if (!term.trim()) return true;
    const t = term.trim().toLowerCase();
    return (
      r.organisation_name.toLowerCase().includes(t) ||
      (r.contact_name ?? "").toLowerCase().includes(t) ||
      (r.service_interest ?? "").toLowerCase().includes(t) ||
      r.lead_ref.toLowerCase().includes(t)
    );
  });

  const revenue = rows.reduce((s, r) => s + Number(r.recognised_value_kes ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(stages.data ?? []).map((s) => (
          <Card
            key={s.step}
            className={step === s.step ? "border-primary" : undefined}
            role="button"
            tabIndex={0}
            onClick={() => setStep(step === s.step ? "ALL" : s.step)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setStep(step === s.step ? "ALL" : s.step);
            }}
          >
            <CardContent className="pt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {STEP_LABEL[s.step]}
              </p>
              <p className="mt-1 text-xl font-semibold tracking-tight">{s.leads}</p>
              <p className="text-xs text-muted-foreground">
                Average wait {days(s.avg_days_in_step)} · longest {days(s.longest_days_in_step)}
              </p>
              {s.older_than_7_days > 0 && (
                <p className="text-xs font-medium text-destructive">
                  {s.older_than_7_days} waiting over a week
                </p>
              )}
            </CardContent>
          </Card>
        ))}
        {stages.isLoading && <Skeleton className="h-24 w-full sm:col-span-3 lg:col-span-6" />}
      </div>

      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="text-base">Where revenue is generated</CardTitle>
          <CardDescription>
            Revenue counts only once a contract is activated and recognised. Total recognised across
            these leads: {revenue ? KES(revenue) : "NONE YET"}.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search organisation, contact, service or reference"
              className="h-9 max-w-xs"
              aria-label="Search leads"
            />
            <Button
              size="sm"
              variant={step === "ALL" ? "secondary" : "ghost"}
              onClick={() => setStep("ALL")}
            >
              All steps
            </Button>
            {owners.length > 1 && (
              <>
                <Button
                  size="sm"
                  variant={owner === "ALL" ? "secondary" : "ghost"}
                  onClick={() => setOwner("ALL")}
                >
                  Everyone
                </Button>
                {owners.map((o) => (
                  <Button
                    key={o}
                    size="sm"
                    variant={owner === o ? "secondary" : "ghost"}
                    onClick={() => setOwner(o)}
                  >
                    {o}
                  </Button>
                ))}
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {flow.isLoading && <Skeleton className="h-40 w-full" />}
          {flow.error && (
            <p className="text-sm text-destructive">
              The pipeline could not be read: {(flow.error as Error).message}
            </p>
          )}
          {!flow.isLoading && !flow.error && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No lead matches what you are looking at right now.
            </p>
          )}
          {filtered.map((r) => (
            <div
              key={r.lead_id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <div className="min-w-[220px]">
                <p className="font-medium">{r.organisation_name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.lead_ref} · {r.service_interest ?? "Service not stated"}
                </p>
                <p className="mt-1 text-xs">
                  <span className="text-muted-foreground">Next: </span>
                  {nextAction(r)}
                  {r.awaiting_due_date && (
                    <span className="text-muted-foreground">
                      {" "}
                      · due{" "}
                      {new Date(r.awaiting_due_date).toLocaleDateString("en-KE", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  )}
                  {r.waiting_on && (
                    <span className="text-muted-foreground">
                      {" "}
                      · waiting on {r.waiting_on === "US" ? "us" : "the client"}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{STEP_LABEL[r.step]}</Badge>
                <Badge variant="outline">{r.owner_name ?? "Unassigned"}</Badge>
                <span className="text-xs text-muted-foreground">
                  {days(r.days_in_step)} at this step · last moved {days(r.days_since_touched)} ago
                </span>
                {r.source === "PARTNER_APPLICATION" && <Badge variant="outline">Partner enquiry</Badge>}
                {r.lost_reason_code && (
                  <Badge variant="outline">{r.lost_reason_code.split("_").join(" ").toLowerCase()}</Badge>
                )}
                <LeadContactDialog
                  leadId={r.lead_id}
                  organisation={r.organisation_name}
                  contactName={r.contact_name}
                  onSaved={() => void qc.invalidateQueries({ queryKey: ["lead-flow"] })}
                />
                <LeadDetailsDialog
                  leadId={r.lead_id}
                  onSaved={() => void qc.invalidateQueries({ queryKey: ["lead-flow"] })}
                />
                <OrganisationOnboardingDialog
                  leadId={r.lead_id}
                  organisation={r.organisation_name}
                  onSaved={() => void qc.invalidateQueries({ queryKey: ["lead-flow"] })}
                />
                {r.step !== "WON" && r.step !== "LOST" && (
                  <QualifyDealDialog
                    leadId={r.lead_id}
                    organisation={r.organisation_name}
                    currentValueKes={r.estimated_value_kes}
                    onOpened={() => void qc.invalidateQueries({ queryKey: ["lead-flow"] })}
                  />
                )}

              </div>
              <div className="text-right">
                <p className="font-medium">
                  {r.recognised_value_kes ? KES(r.recognised_value_kes) : "NO REVENUE YET"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Estimate {r.estimated_value_kes ? KES(r.estimated_value_kes) : "not stated"}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Steps shown: {FLOW_STEPS.map((s) => STEP_LABEL[s]).join(" → ")}.
      </p>
    </div>
  );
}
