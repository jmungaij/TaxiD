/**
 * Phase 6 — SAFARID Autonomous Value & Production Excellence surface.
 *
 * Four questions, answered from readable evidence only:
 *  1. What value is the enterprise actually creating? (value engine + EEI)
 *  2. Where should scarce resources and management attention go? (allocation)
 *  3. Which agents have earned autonomy, and what is safe right now?
 *     (quality gates + supervisor breakers)
 *  4. What have we proven rather than assumed? (experiment engine)
 *
 * Nothing here is scored from an assumed number: unmeasurable terms are excluded
 * from every headline and named as withheld.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck, FlaskConical, Gauge, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { StaffPageHeader, StaffSection, FlowChain } from "@/components/staff/primitives";
import { probeRecordCoverage, type Coverage } from "@/lib/staff/phase2";
import {
  ingestBusinessEvents, correlate, prioritise, listOutcomes, agentConfidence,
  type OutcomeRecord, type Prioritised,
} from "@/lib/staff/phase5";
import { AGENTS } from "@/lib/staff/phase4";
import {
  NORTH_STAR, assessValueStreams, evaluateObjective, northStarDrivers,
  enterpriseEffectivenessIndex, valueUnjustified, VALUE_DIMENSION_LABEL,
  rankAllocation, resourcePressure, buildAttentionQueue, productivityMeasures, resourceLabel,
  evaluateAllAgents, labSummary, evaluateBreakers, supervise, effectiveAutonomy,
  listExperiments, createExperiment, validateDesign, summariseExperiments, experimentLessons,
  type ExperimentFeed,
} from "@/lib/staff/phase6";

const VALUE_LOOP = ["Define value", "Measure value", "Allocate resources", "Earn autonomy", "Prove with experiments", "Adapt"] as const;

const PROBE_TABLES = [
  "charter_bookings", "charter_inventory", "charter_partner_applications", "charter_quotes",
  "corporate_invoices", "corporate_accounts", "corporate_documents", "corporate_support_tickets",
  "client_journey_events", "delivery_orders", "dispatch_requests", "availability_metrics",
  "charter_wallet_ledger", "charter_wallet_reconciliation_findings", "compliance_alerts",
  "country_launch_status", "capabilities", "access_denials", "audit_logs",
  "staff_decisions", "staff_decision_audit", "staff_action_outcomes", "staff_live_events", "staff_experiments",
];

const NOT_MEASURED = "NOT CONNECTED";

function ScoreCard({ label, value, suffix, hint }: { label: string; value: number | null; suffix?: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={value === null ? "mt-2 text-sm text-muted-foreground" : "mt-2 text-2xl font-semibold"}>
          {value === null ? NOT_MEASURED : `${value}${suffix ?? ""}`}
        </div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function StaffValue() {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [ranked, setRanked] = useState<Prioritised[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeRecord[]>([]);
  const [experiments, setExperiments] = useState<ExperimentFeed>({ rows: [], error: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [design, setDesign] = useState({
    title: "", domain: "marketplace", hypothesis: "", baseline: "",
    control: "", treatment: "", measurement: "charter_bookings", expectedValue: "", ownerRole: "staff",
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [cov, signals, out, exp] = await Promise.all([
      probeRecordCoverage(PROBE_TABLES), ingestBusinessEvents(), listOutcomes(), listExperiments(),
    ]);
    setCoverage(cov);
    setRanked(prioritise(correlate(signals)));
    setOutcomes(out.data ?? []);
    setExperiments(exp);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const learning = useMemo(() => AGENTS.map((a) => agentConfidence(a.key, outcomes)), [outcomes]);
  const streams = useMemo(() => (coverage ? assessValueStreams(coverage) : []), [coverage]);
  const objective = useMemo(() => (coverage ? evaluateObjective(coverage) : null), [coverage]);
  const eei = useMemo(() => (coverage ? enterpriseEffectivenessIndex(coverage) : null), [coverage]);
  const drivers = useMemo(() => (coverage ? northStarDrivers(coverage) : []), [coverage]);
  const allocation = useMemo(() => (coverage ? rankAllocation(coverage) : []), [coverage]);
  const pressure = useMemo(() => resourcePressure(allocation), [allocation]);
  const attention = useMemo(() => buildAttentionQueue(ranked), [ranked]);
  const productivity = useMemo(() => (coverage ? productivityMeasures(coverage) : []), [coverage]);
  const evaluations = useMemo(() => (coverage ? evaluateAllAgents(coverage, learning) : []), [coverage, learning]);
  const lab = useMemo(() => labSummary(evaluations), [evaluations]);
  const breakers = useMemo(() => (coverage ? evaluateBreakers(coverage, learning) : []), [coverage, learning]);
  const verdict = useMemo(() => supervise(breakers), [breakers]);
  const effective = useMemo(() => effectiveAutonomy(evaluations, verdict), [evaluations, verdict]);
  const expSummary = useMemo(() => summariseExperiments(experiments), [experiments]);
  const lessons = useMemo(() => experimentLessons(experiments), [experiments]);
  const unjustified = useMemo(() => valueUnjustified(streams), [streams]);

  const submitExperiment = async () => {
    if (!coverage) return;
    const designVerdict = validateDesign(design, coverage);
    if (designVerdict.ok === false) {
      toast({ title: "Experiment not created", description: designVerdict.reason, variant: "destructive" });
      return;
    }
    setSaving(true);
    const res = await createExperiment(design);
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Could not save the experiment", description: res.reason, variant: "destructive" });
      return;
    }
    toast({ title: "Experiment registered", description: "Measurement source recorded — the result will be read from it." });
    setDesign({ ...design, title: "", hypothesis: "", control: "", treatment: "", baseline: "", expectedValue: "" });
    void refresh();
  };

  return (
    <div>
      <StaffPageHeader
        eyebrow="Phase 6 · Autonomous value"
        title="Value & Production Excellence"
        lede="What value the enterprise is creating, where scarce resources should go, which agents have earned autonomy, and what has been proven rather than assumed."
        actions={
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Re-measure</span>
          </Button>
        }
      />

      <div className="mb-8">
        <FlowChain steps={VALUE_LOOP} />
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ScoreCard label="Enterprise objective score" value={objective?.score ?? null} suffix="/100" hint={objective ? `${objective.measuredWeight}% of objective weight measurable` : undefined} />
        <ScoreCard label="Effectiveness Index (EEI)" value={eei?.index ?? null} suffix="/100" hint={eei ? `${eei.measuredDomains}/${eei.totalDomains} domains measurable` : undefined} />
        <ScoreCard label="Agents at execute tier" value={lab.agents ? lab.atExecuteTier : null} hint={`${lab.averagePassed} of 9 gates passed on average`} />
        <ScoreCard label="Experiments measured" value={expSummary.measurementRate} suffix="%" hint={`${expSummary.measured} of ${expSummary.total} have a recorded result`} />
      </div>

      <Card className={verdict.tripped.length > 0 ? "mb-8 border-destructive/50" : "mb-8"}>
        <CardContent className="pt-5 flex items-start gap-3">
          {verdict.tripped.length > 0
            ? <ShieldAlert className="h-5 w-5 text-destructive shrink-0" aria-hidden="true" />
            : <ShieldCheck className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />}
          <div>
            <div className="font-semibold text-sm">Agent supervisor</div>
            <p className="text-sm text-muted-foreground">{verdict.statement}</p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="value">
        <TabsList className="mb-6 flex-wrap h-auto">
          <TabsTrigger value="value"><Layers className="mr-2 h-4 w-4" />Value engine</TabsTrigger>
          <TabsTrigger value="allocation"><Gauge className="mr-2 h-4 w-4" />Allocation & attention</TabsTrigger>
          <TabsTrigger value="autonomy"><ShieldCheck className="mr-2 h-4 w-4" />Earned autonomy</TabsTrigger>
          <TabsTrigger value="experiments"><FlaskConical className="mr-2 h-4 w-4" />Experiments</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------- value */}
        <TabsContent value="value">
          <StaffSection title="North star" description={NORTH_STAR.statement}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {drivers.map((d) => (
                <Card key={d.label}>
                  <CardContent className="pt-5">
                    <div className="text-xs text-muted-foreground">{d.label}</div>
                    <div className={d.observed === null ? "mt-1 text-sm text-muted-foreground" : "mt-1 text-xl font-semibold"}>
                      {d.observed === null ? NOT_MEASURED : d.observed.toLocaleString()}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{d.quantifiedBy ?? "no source"}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </StaffSection>

          <StaffSection title="Enterprise objective function" description="One score no department can game: growth that destroys margin, quality, safety or people reduces it. Unmeasurable terms are excluded, never assumed.">
            <div className="rounded-lg border divide-y">
              {objective?.terms.map((t) => (
                <div key={t.term.key} className="p-4 flex flex-wrap items-center gap-3">
                  <div className="min-w-[190px]">
                    <div className="text-sm font-medium">{t.term.label}</div>
                    <div className="text-xs text-muted-foreground">Weight {Math.round(t.term.weight * 100)}% · guards against {t.term.guards.toLowerCase()}</div>
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    {t.score === null
                      ? <span className="text-xs text-muted-foreground">{NOT_MEASURED} — {t.reason}</span>
                      : <Progress value={t.score} aria-label={`${t.term.label} score`} />}
                  </div>
                  <div className="w-24 text-right text-sm font-semibold">{t.score === null ? "—" : `${t.score}/100`}</div>
                  <Badge variant="outline" className="text-[10px]">{t.term.quantifiedBy ?? "no source"}</Badge>
                </div>
              ))}
            </div>
            {objective && objective.withheld.length > 0 && (
              <div className="mt-3 rounded-md border border-muted-foreground/30 p-3 text-xs text-muted-foreground">
                <div className="font-medium">Withheld from the score</div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {objective.withheld.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </div>
            )}
          </StaffSection>

          <StaffSection title="Value streams" description="Every stream names the activity, the value dimensions it serves, the resource it consumes and the table that measures it.">
            <div className="grid gap-3 lg:grid-cols-2">
              {streams.map((a) => (
                <Card key={a.stream.key}>
                  <CardContent className="pt-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{a.stream.label}</div>
                        <div className="text-xs text-muted-foreground">{a.stream.activity}</div>
                      </div>
                      <Badge variant={a.state === "measured" ? "outline" : "secondary"} className="text-[10px] shrink-0">
                        {a.state === "measured" ? "MEASURED" : NOT_MEASURED}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {a.stream.dimensions.map((d) => (
                        <Badge key={d} variant="secondary" className="font-normal text-[10px]">{VALUE_DIMENSION_LABEL[d]}</Badge>
                      ))}
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">
                      Consumes {resourceLabel(a.stream.consumes)} · owner {a.stream.owner} ·{" "}
                      {a.state === "measured" ? `${(a.observed ?? 0).toLocaleString()} rows in ${a.stream.quantifiedBy}` : a.reason}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {unjustified.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {unjustified.length} stream(s) consume resources with no measurable value attached — connect the source or stop funding the activity.
              </p>
            )}
          </StaffSection>

          <StaffSection title="Effectiveness Index by domain" description="Drillable: each domain score is derived only from the tables listed beneath it.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {eei?.domains.map((d) => (
                <Card key={d.key}>
                  <CardContent className="pt-5">
                    <div className="flex items-baseline justify-between">
                      <div className="text-sm font-semibold">{d.label}</div>
                      <div className={d.score === null ? "text-xs text-muted-foreground" : "text-lg font-semibold"}>
                        {d.score === null ? NOT_MEASURED : d.score}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">{d.measures}</div>
                    <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                      {d.evidence.map((e) => (
                        <li key={e.table}>{e.table}: {e.rows === null ? (e.reason ?? "unreadable") : `${e.rows.toLocaleString()} rows`}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </StaffSection>
        </TabsContent>

        {/* -------------------------------------------------- allocation */}
        <TabsContent value="allocation">
          <StaffSection title="Attention queue" description={`Management attention is the scarcest resource, so the queue is capped at ${attention.cap}. Everything beyond the cap is deferred explicitly.`}>
            {attention.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No evidenced situation currently requires management attention.</p>
            ) : (
              <ol className="rounded-lg border divide-y">
                {attention.items.map((i) => (
                  <li key={i.item.key} className="p-4 flex flex-wrap items-center gap-3">
                    <span className="h-6 w-6 shrink-0 rounded-full bg-primary text-primary-foreground text-xs grid place-items-center font-semibold">{i.rank}</span>
                    <div className="flex-1 min-w-[220px]">
                      <div className="text-sm font-medium">{i.item.label}</div>
                      <div className="text-xs text-muted-foreground">{i.justification}</div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{i.item.reversible ? "reversible" : "irreversible"}</Badge>
                  </li>
                ))}
              </ol>
            )}
            {attention.deferred.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Deferred beyond the cap: {attention.deferred.map((d) => d.label).join(", ")}
              </p>
            )}
            {attention.unevidenced.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Excluded for lack of readable evidence (sensing gaps to fix, not decisions to make): {attention.unevidenced.map((d) => d.label).join(", ")}
              </p>
            )}
          </StaffSection>

          <StaffSection title="Resource allocation ranking" description="Ranked by marginal value per unit of the scarce resource consumed. Unmeasurable claims cannot outrank measured work.">
            <div className="rounded-lg border divide-y">
              {allocation.map((c) => (
                <div key={c.stream.key} className="p-4 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[220px]">
                    <div className="text-sm font-medium">{c.stream.label}</div>
                    <div className="text-xs text-muted-foreground">
                      Consumes {resourceLabel(c.resource)} ·{" "}
                      {c.supported ? `${(c.evidence ?? 0).toLocaleString()} measured rows` : `unsupported — ${c.reason}`}
                    </div>
                  </div>
                  <div className="w-40">
                    {c.marginalValue === null
                      ? <span className="text-xs text-muted-foreground">{NOT_MEASURED}</span>
                      : <Progress value={c.marginalValue} aria-label={`${c.stream.label} marginal value`} />}
                  </div>
                  <div className="w-16 text-right text-sm font-semibold">{c.marginalValue ?? "—"}</div>
                </div>
              ))}
            </div>
          </StaffSection>

          <StaffSection title="Resource contention" description="Where multiple streams compete for the same constrained resource.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pressure.map((p) => (
                <Card key={p.resource}>
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">{p.label}</div>
                      <Badge variant={p.contention === "high" ? "destructive" : "outline"} className="text-[10px]">{p.contention}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{p.constraint} · measured in {p.unit}</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {p.claims} claim(s){p.unsupportedClaims > 0 ? ` · ${p.unsupportedClaims} unmeasurable` : ""}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </StaffSection>

          <StaffSection title="Productivity measurement" description="Productivity is measured as work completed with evidence, not activity performed.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {productivity.map((p) => (
                <Card key={p.key}>
                  <CardContent className="pt-5">
                    <div className="text-xs text-muted-foreground">{p.label}</div>
                    <div className={p.measured ? "mt-1 text-xl font-semibold" : "mt-1 text-sm text-muted-foreground"}>
                      {p.measured ? (p.observed ?? 0).toLocaleString() : NOT_MEASURED}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{p.improvement}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </StaffSection>
        </TabsContent>

        {/* --------------------------------------------------- autonomy */}
        <TabsContent value="autonomy">
          <StaffSection title="Circuit breakers" description="Safety conditions evaluated from measured evidence. A condition that cannot be observed caps autonomy — unobservable safety is not safety.">
            <div className="grid gap-3 lg:grid-cols-2">
              {breakers.map((b) => (
                <Card key={b.breaker.key} className={b.state === "tripped" ? "border-destructive/50" : undefined}>
                  <CardContent className="pt-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{b.breaker.label}</div>
                        <div className="text-xs text-muted-foreground">{b.breaker.condition}</div>
                      </div>
                      <Badge variant={b.state === "tripped" ? "destructive" : b.state === "closed" ? "outline" : "secondary"} className="text-[10px] shrink-0">
                        {b.state === "closed" ? "CLOSED" : b.state === "tripped" ? "TRIPPED" : "UNMONITORED"}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">{b.detail}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">On trip: {b.breaker.onTrip}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </StaffSection>

          <StaffSection title="Agent quality gates" description="Nine gates, evaluated in order. A gate without readable evidence is UNPROVEN — autonomy cannot be accumulated through missing data.">
            {lab.topBlockers.length > 0 && (
              <p className="mb-3 text-xs text-muted-foreground">
                Highest-leverage fixes: {lab.topBlockers.map((b) => `${b.label} (${b.agents} agents)`).join(", ")}
              </p>
            )}
            <div className="space-y-3">
              {evaluations.map((e) => (
                <Card key={e.agent.key}>
                  <CardContent className="pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{e.agent.name}</div>
                        <div className="text-xs text-muted-foreground">{e.agent.department} · owner {e.agent.owner}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">Earned: {e.tierLabel}</Badge>
                        <Badge variant="secondary" className="text-[10px]">{e.passed}/9 passed</Badge>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {e.gates.map((g) => (
                        <span
                          key={g.key}
                          title={`${g.asks} — ${g.detail}`}
                          className={
                            g.state === "passed"
                              ? "rounded border border-primary/40 px-2 py-0.5 text-[10px] text-primary"
                              : g.state === "failed"
                                ? "rounded border border-destructive/50 px-2 py-0.5 text-[10px] text-destructive"
                                : "rounded border border-muted-foreground/30 px-2 py-0.5 text-[10px] text-muted-foreground"
                          }
                        >
                          {g.id}. {g.label}
                        </span>
                      ))}
                    </div>
                    {e.blockedBy && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Blocked at gate {e.blockedBy.id} ({e.blockedBy.label}): {e.blockedBy.detail}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </StaffSection>

          <StaffSection title="Effective autonomy" description="What each agent may actually do right now: the earned tier, capped by the supervisor.">
            <div className="rounded-lg border divide-y">
              {effective.map((a) => (
                <div key={a.agentKey} className="p-3 flex flex-wrap items-center gap-3 text-sm">
                  <span className="flex-1 min-w-[200px] font-medium">{a.agentLabel}</span>
                  <span className="text-xs text-muted-foreground">earned: {a.earned}</span>
                  <Badge variant="outline" className="text-[10px]">effective: {a.effective}</Badge>
                  {a.cappedBy && <span className="text-[11px] text-muted-foreground">{a.cappedBy}</span>}
                </div>
              ))}
            </div>
          </StaffSection>
        </TabsContent>

        {/* ------------------------------------------------ experiments */}
        <TabsContent value="experiments">
          <StaffSection title="Register an experiment" description="An experiment may only be created when its measurement source is readable — otherwise the result could never be known.">
            <div className="grid gap-3 lg:grid-cols-2">
              <Input placeholder="Title" value={design.title} onChange={(e) => setDesign({ ...design, title: e.target.value })} aria-label="Experiment title" />
              <Input placeholder="Measurement table (e.g. charter_bookings)" value={design.measurement} onChange={(e) => setDesign({ ...design, measurement: e.target.value })} aria-label="Measurement source" />
              <Textarea placeholder="Hypothesis — a testable claim" value={design.hypothesis} onChange={(e) => setDesign({ ...design, hypothesis: e.target.value })} aria-label="Hypothesis" />
              <div className="grid gap-3">
                <Input placeholder="Control" value={design.control} onChange={(e) => setDesign({ ...design, control: e.target.value })} aria-label="Control" />
                <Input placeholder="Treatment" value={design.treatment} onChange={(e) => setDesign({ ...design, treatment: e.target.value })} aria-label="Treatment" />
              </div>
              <Input placeholder="Baseline (optional)" value={design.baseline} onChange={(e) => setDesign({ ...design, baseline: e.target.value })} aria-label="Baseline" />
              <Input placeholder="Expected value if the hypothesis holds" value={design.expectedValue} onChange={(e) => setDesign({ ...design, expectedValue: e.target.value })} aria-label="Expected value" />
            </div>
            <Button className="mt-3" onClick={() => void submitExperiment()} disabled={saving || !coverage}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
              Register experiment
            </Button>
          </StaffSection>

          <StaffSection title="Experiment register" description="Results are read back from the record. An experiment with no measured result is pending, never a success.">
            {experiments.error ? (
              <p className="text-sm text-muted-foreground">Register unreadable for this identity: {experiments.error}</p>
            ) : experiments.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No experiments registered yet.</p>
            ) : (
              <div className="rounded-lg border divide-y">
                {experiments.rows.map((r) => (
                  <div key={r.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold">{r.title}</div>
                      <Badge variant={r.status === "measured" ? "outline" : "secondary"} className="text-[10px]">
                        {r.status === "measured" ? "MEASURED" : r.status.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{r.hypothesis}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {r.domain} · measured via {r.measurement ?? "no source"} ·{" "}
                      {r.measured_result ? `result: ${r.measured_result}` : "result pending"}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {lessons.length > 0 && (
              <div className="mt-4 rounded-md border p-3">
                <div className="text-sm font-medium">Proven lessons</div>
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
                  {lessons.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </div>
            )}
          </StaffSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}
