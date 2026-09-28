/**
 * Phase 5 — TaxiD Adaptive Enterprise surface.
 *
 * Not another dashboard: the working face of the control loop. Signals are
 * ingested from authorised tables, correlated into named situations, ranked by
 * the priority engine, raised as decisions to the declared authority with an
 * append-only audit trail, and closed by a recorded outcome that updates
 * measured confidence. Anything unreadable is named, never assumed.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { StaffPageHeader, StaffSection, FlowChain, ChipList } from "@/components/staff/primitives";
import { useAuth } from "@/hooks/useAuth";
import { probeRecordCoverage, type Coverage } from "@/lib/staff/phase2";
import { AGENTS, CHANGE_CONTROL_STAGES, RED_TEAM_CASES, governanceRegister, autonomyEligibility, AUTONOMY_LABEL } from "@/lib/staff/phase4";
import {
  ingestBusinessEvents, sensingCoverage, unsensedEvents, correlate, presentSituations,
  noiseReduction, prioritise, whatMattersMost, SLA_LABEL, CAUSAL_GRADE_LABEL,
  raiseDecision, decideDecision, listDecisions, listAudit, overdueDecisions,
  routeSupplyShortage, recordOutcome, listOutcomes, measureFromOutcomes, agentConfidence, learningLoop,
  type IngestedSignal, type DecisionRecord, type AuditEntry, type OutcomeRecord, type Prioritised,
} from "@/lib/staff/phase5";

const CONTROL_LOOP = [
  "Sense", "Understand", "Predict", "Prioritise", "Decide", "Authorise",
  "Orchestrate", "Execute", "Measure", "Learn", "Adapt",
] as const;

const PROBE_TABLES = [
  "charter_inventory", "charter_bookings", "charter_partner_applications",
  "corporate_invoices", "corporate_accounts", "client_journey_events",
  "charter_quotes", "availability_metrics", "corporate_policy_rules",
  "corporate_support_tickets", "alerts_events", "capabilities", "dashboard_metrics",
];

export default function StaffAdaptive() {
  const { user, roles } = useAuth();
  const [signals, setSignals] = useState<IngestedSignal[] | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeRecord[]>([]);
  const [audit, setAudit] = useState<Record<string, AuditEntry[]>>({});
  const [rationale, setRationale] = useState<Record<string, string>>({});
  const [outcomeDraft, setOutcomeDraft] = useState<Record<string, { actual: string; lesson: string; adaptation: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [sig, cov, dec, out] = await Promise.all([
      ingestBusinessEvents(), probeRecordCoverage(PROBE_TABLES), listDecisions(), listOutcomes(),
    ]);
    setSignals(sig);
    setCoverage(cov);
    setDecisions(dec.data ?? []);
    setDecisionError(dec.error);
    setOutcomes(out.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const correlations = useMemo(() => (signals ? correlate(signals) : []), [signals]);
  const present = useMemo(() => presentSituations(correlations), [correlations]);
  const ranked = useMemo(() => prioritise(correlations), [correlations]);
  const top = useMemo(() => whatMattersMost(ranked), [ranked]);
  const noise = useMemo(() => (signals ? noiseReduction(signals, correlations) : null), [signals, correlations]);
  const sensing = useMemo(() => (signals ? sensingCoverage(signals) : null), [signals]);
  const measured = useMemo(() => measureFromOutcomes(outcomes), [outcomes]);
  const loop = useMemo(() => learningLoop(outcomes), [outcomes]);
  const overdue = useMemo(() => overdueDecisions(decisions), [decisions]);
  const shortage = useMemo(() => {
    const gap = present.find((c) => c.situation.key === "marketplace_liquidity_gap");
    return gap && coverage ? routeSupplyShortage(gap, roles, coverage) : null;
  }, [present, coverage, roles]);

  const onRaise = async (item: Prioritised) => {
    setBusy(item.key);
    const res = await raiseDecision(item, roles, user?.id ?? null);
    setBusy(null);
    if (res.error) { toast({ title: "Could not raise the decision", description: res.error, variant: "destructive" }); return; }
    toast({ title: "Decision raised", description: `Routed to: ${res.data?.approver}` });
    void refresh();
  };

  const onDecide = async (d: DecisionRecord, outcome: "approved" | "rejected") => {
    setBusy(d.id);
    const res = await decideDecision(d.id, outcome, rationale[d.id] ?? "", d.selected_option, roles, user?.id ?? null);
    setBusy(null);
    if (res.error) { toast({ title: "Decision not recorded", description: res.error, variant: "destructive" }); return; }
    toast({ title: `Decision ${outcome}`, description: "Recorded with an immutable audit entry." });
    void refresh();
  };

  const onLoadAudit = async (id: string) => {
    const res = await listAudit(id);
    if (res.error) { toast({ title: "Audit unavailable", description: res.error, variant: "destructive" }); return; }
    setAudit((a) => ({ ...a, [id]: res.data ?? [] }));
  };

  const onRecordOutcome = async (d: DecisionRecord) => {
    const draft = outcomeDraft[d.id] ?? { actual: "", lesson: "", adaptation: "" };
    setBusy(d.id);
    const err = await recordOutcome({
      decisionId: d.id,
      agentKey: d.coordination_key,
      measureKey: "recommendation_accuracy",
      expected: d.priority_score,
      actual: draft.actual === "" ? null : Number(draft.actual),
      succeeded: draft.actual !== "" && Number(draft.actual) >= d.priority_score * 0.8,
      lesson: draft.lesson,
      adaptation: draft.adaptation,
    }, user?.id ?? null);
    setBusy(null);
    if (err) { toast({ title: "Outcome not recorded", description: err, variant: "destructive" }); return; }
    toast({ title: "Outcome recorded", description: "Measured confidence updated from evidence." });
    void refresh();
  };

  return (
    <div className="space-y-6">
      <StaffPageHeader
        title="Adaptive enterprise"
        lede="Sense → understand → prioritise → decide → authorise → orchestrate → measure → learn. Every item traces to a counted row; anything unreadable is named."
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Re-sense</span>
          </Button>
        }
      />

      <FlowChain steps={CONTROL_LOOP} />

      <Tabs defaultValue="sense">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="sense">Sensing</TabsTrigger>
          <TabsTrigger value="situations">Situations</TabsTrigger>
          <TabsTrigger value="priority">Priority</TabsTrigger>
          <TabsTrigger value="queue">Decision queue</TabsTrigger>
          <TabsTrigger value="marketplace">Supply & revenue routing</TabsTrigger>
          <TabsTrigger value="learning">Measured learning</TabsTrigger>
          <TabsTrigger value="registry">Agent governance register</TabsTrigger>
        </TabsList>

        <TabsContent value="sense" className="space-y-4 pt-4">
          <StaffSection title="Live event ingestion" description="Each ingestor is a narrow count against the authoritative table with a declared window and threshold.">
            {sensing && (
              <p className="text-sm text-muted-foreground mb-3">
                {sensing.sensed} of {sensing.declared} declared events are sensed ({sensing.coverage}% coverage) · {sensing.raised} raised · {sensing.unavailable} unreadable
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {(signals ?? []).map((s) => (
                <Card key={s.eventKey}>
                  <CardContent className="p-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">{s.eventKey}</span>
                      <Badge variant="outline" className={s.state === "raised" ? "border-warning/60 text-warning" : s.state === "unavailable" ? "border-destructive/60 text-destructive" : "border-muted-foreground/30 text-muted-foreground"}>
                        {s.state === "unavailable" ? "DATA NOT AVAILABLE" : s.state}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{s.detects}</p>
                    <p className="text-xs">
                      {s.observed === null ? <span className="text-destructive">{s.reason}</span> : <>Observed <strong>{s.observed}</strong> vs threshold {s.threshold} · {s.window} · <code>{s.table}</code></>}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </StaffSection>
          <StaffSection title="Sensing gaps" description="Declared events with no ingestor. Silence here means unobserved, not healthy.">
            <ChipList items={unsensedEvents().map((e) => e.key)} />
          </StaffSection>
        </TabsContent>

        <TabsContent value="situations" className="space-y-4 pt-4">
          {noise && (
            <p className="text-sm text-muted-foreground">
              {noise.raw} raised signal(s) correlated into {noise.grouped} named situation(s) — {noise.reduction}% noise reduction.
            </p>
          )}
          {present.length === 0 && <p className="text-sm text-muted-foreground">No situation currently meets its correlation threshold.</p>}
          {present.map((c) => (
            <StaffSection key={c.situation.key} title={c.situation.label} description={CAUSAL_GRADE_LABEL[c.grade]}>
              <FlowChain steps={c.situation.chain} />
              <p className="text-sm mt-3">Consequence: <strong>{c.situation.consequence}</strong>{c.situation.quantifiedBy ? <> · quantified by <code>{c.situation.quantifiedBy}</code></> : " · not quantified by any table"}</p>
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {c.evidence.map((e) => <p key={e.eventKey}>Evidence: {e.eventKey} — {e.observed} in {e.table}</p>)}
                {c.blind.map((b) => <p key={b} className="text-destructive">Unreadable contributor: {b}</p>)}
              </div>
            </StaffSection>
          ))}
        </TabsContent>

        <TabsContent value="priority" className="space-y-4 pt-4">
          <StaffSection title="What matters most now" description="Ranked on a declared, auditable weighting; reversible situations are discounted.">
            {top.length === 0 && <p className="text-sm text-muted-foreground">Nothing currently qualifies for enterprise attention.</p>}
            <div className="space-y-3">
              {top.map((item) => (
                <Card key={item.key}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{item.label}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{item.score}/100</Badge>
                        <Badge variant="outline" className="border-warning/60 text-warning">{SLA_LABEL[item.sla]}</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{item.rationale}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {item.contributions.slice(0, 4).map((c) => (
                        <Badge key={c.factor} variant="outline" className="text-[10px]">{c.factor} {c.points}</Badge>
                      ))}
                    </div>
                    <Button size="sm" onClick={() => void onRaise(item)} disabled={busy === item.key}>
                      {busy === item.key ? <Loader2 className="h-4 w-4 animate-spin" /> : "Raise for authorisation"}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </StaffSection>
        </TabsContent>

        <TabsContent value="queue" className="space-y-4 pt-4">
          {decisionError && (
            <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Decision store unreadable for this identity: {decisionError}</p>
          )}
          {overdue.length > 0 && <p className="text-sm text-warning">{overdue.length} decision(s) past their SLA — escalation applies by policy.</p>}
          {decisions.length === 0 && !decisionError && <p className="text-sm text-muted-foreground">No decisions raised yet.</p>}
          {decisions.map((d) => (
            <StaffSection key={d.id} title={d.title} description={`Authority: ${d.approver} · requested ${d.requested_class}, effective ${d.effective_class} · ${d.status}`}>
              <p className="text-xs text-muted-foreground">Trigger {d.event_key} · priority {d.priority_score} · confidence {d.confidence ?? "—"} · deadline {d.deadline_at ? new Date(d.deadline_at).toLocaleString() : "none"}</p>
              {d.status === "pending" && (
                <div className="space-y-2 mt-3">
                  <Textarea
                    placeholder="Rationale — required, recorded immutably against your identity"
                    value={rationale[d.id] ?? ""}
                    onChange={(e) => setRationale((r) => ({ ...r, [d.id]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void onDecide(d, "approved")} disabled={busy === d.id}>Authorise</Button>
                    <Button size="sm" variant="outline" onClick={() => void onDecide(d, "rejected")} disabled={busy === d.id}>Reject</Button>
                  </div>
                </div>
              )}
              {(d.status === "approved" || d.status === "executed") && (
                <div className="space-y-2 mt-3">
                  <Input placeholder="Measured result (numeric)" value={outcomeDraft[d.id]?.actual ?? ""} onChange={(e) => setOutcomeDraft((o) => ({ ...o, [d.id]: { ...(o[d.id] ?? { actual: "", lesson: "", adaptation: "" }), actual: e.target.value } }))} />
                  <Input placeholder="Lesson learned (required)" value={outcomeDraft[d.id]?.lesson ?? ""} onChange={(e) => setOutcomeDraft((o) => ({ ...o, [d.id]: { ...(o[d.id] ?? { actual: "", lesson: "", adaptation: "" }), lesson: e.target.value } }))} />
                  <Input placeholder="Adaptation to future behaviour" value={outcomeDraft[d.id]?.adaptation ?? ""} onChange={(e) => setOutcomeDraft((o) => ({ ...o, [d.id]: { ...(o[d.id] ?? { actual: "", lesson: "", adaptation: "" }), adaptation: e.target.value } }))} />
                  <Button size="sm" variant="outline" onClick={() => void onRecordOutcome(d)} disabled={busy === d.id}>Record measured outcome</Button>
                </div>
              )}
              <div className="mt-3">
                <Button size="sm" variant="ghost" onClick={() => void onLoadAudit(d.id)}>Show audit trail</Button>
                {(audit[d.id] ?? []).map((a) => (
                  <p key={a.id} className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()} · <strong>{a.step}</strong> · {JSON.stringify(a.detail).slice(0, 180)}
                  </p>
                ))}
              </div>
            </StaffSection>
          ))}
        </TabsContent>

        <TabsContent value="marketplace" className="space-y-4 pt-4">
          <StaffSection title="Demand shortage routing" description="Marketplace supply acquisition and revenue impact analysis answer together before any authority decides.">
            {!shortage && <p className="text-sm text-muted-foreground">No marketplace liquidity gap is currently present.</p>}
            {shortage && (
              <div className="space-y-3">
                <ChipList items={shortage.contributors.map((c) => `agent: ${c}`)} />
                <div className="space-y-1">
                  {shortage.revenue.map((r) => (
                    <p key={r.statement} className="text-sm">
                      {r.quantified ? "✓" : "⚠"} {r.statement} <Badge variant="outline" className="text-[10px] ml-1">{r.epistemic}</Badge>
                    </p>
                  ))}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {shortage.levers.map((l) => (
                    <Card key={l.key}><CardContent className="p-3">
                      <p className="text-sm font-medium">{l.label}</p>
                      <p className="text-xs text-muted-foreground">{l.horizon} · {l.cost} · quantified by <code>{l.quantifiedBy}</code></p>
                      <p className="text-xs text-muted-foreground">{l.note}</p>
                    </CardContent></Card>
                  ))}
                </div>
                {shortage.withheld.length > 0 && (
                  <div className="text-xs text-destructive space-y-1">
                    {shortage.withheld.map((w) => <p key={w}>{w}</p>)}
                  </div>
                )}
                {shortage.run && (
                  <p className="text-xs text-muted-foreground">
                    Gate: requested {shortage.run.gate.requested} → effective {shortage.run.gate.effective}; {shortage.run.gate.reasons.join("; ")}
                  </p>
                )}
              </div>
            )}
          </StaffSection>
        </TabsContent>

        <TabsContent value="learning" className="space-y-4 pt-4">
          <StaffSection title="Measured agent performance" description="Recomputed from recorded outcomes. Unmeasured stays unmeasured — no placeholder figures.">
            <div className="grid gap-2 md:grid-cols-2">
              {measured.map((m) => (
                <Card key={m.measure.key}><CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{m.measure.label}</span>
                    <Badge variant="outline">{m.state === "measured" ? `${Math.round((m.successRate ?? 0) * 100)}%` : "NOT MEASURED"}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{m.observations} observation(s){m.meanVariance !== null ? ` · mean variance ${m.meanVariance}` : ""}</p>
                </CardContent></Card>
              ))}
            </div>
          </StaffSection>
          <StaffSection title="Prediction → outcome → lesson → adaptation" description="Institutional memory: each recorded loop closure.">
            {loop.length === 0 && <p className="text-sm text-muted-foreground">No outcomes recorded yet — confidence remains unmeasured by design.</p>}
            {loop.map((l, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {new Date(l.at).toLocaleString()} · {l.agent} · expected {l.expected ?? "—"} / actual {l.actual ?? "—"} (variance {l.variance ?? "—"}) · {l.succeeded ? "worked" : "did not work"} · {l.lesson}{l.adaptation ? ` → ${l.adaptation}` : ""}
              </p>
            ))}
          </StaffSection>
        </TabsContent>

        <TabsContent value="registry" className="space-y-4 pt-4">
          <StaffSection title="Agent inventory, version and permission control" description="Every agent, its owner, model, version, tools, autonomy and measured confidence.">
            <div className="space-y-3">
              {AGENTS.map((agent) => {
                const entry = governanceRegister().find((e) => e.name === agent.name);
                const conf = agentConfidence(agent.key, outcomes);
                const elig = autonomyEligibility(agent.key);
                return (
                  <Card key={agent.key}><CardContent className="p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{entry?.name ?? agent.name}</span>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline">v{agent?.version}</Badge>
                        <Badge variant="outline">{agent?.model}</Badge>
                        <Badge variant="outline">{agent ? AUTONOMY_LABEL[agent.autonomy] : "—"}</Badge>
                        <Badge variant="outline" className={conf.confidence === null ? "border-muted-foreground/30 text-muted-foreground" : "border-info/50 text-info"}>
                          {conf.confidence === null ? "confidence NOT MEASURED" : `confidence ${Math.round(conf.confidence * 100)}%`}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Owner: {agent?.owner} · Department: {agent?.department} · Risk: {agent?.risk}</p>
                    <p className="text-xs text-muted-foreground">Tools permitted: {agent?.tools.join(", ")}</p>
                    <p className="text-xs text-muted-foreground">Data access: {agent?.contextScopes.join(", ")}</p>
                    <p className="text-xs text-muted-foreground">
                      Incidents attributed: {conf.failures} · observations {conf.observations} · autonomy movement: {conf.recommendation.replace(/_/g, " ")}
                    </p>
                    {elig && !elig.eligible && (
                      <p className="text-xs text-warning">Promotion blocked: {elig.blockers.join("; ")}</p>
                    )}
                  </CardContent></Card>
                );
              })}
            </div>
          </StaffSection>
          <StaffSection title="Change control board" description="No agent version reaches production without passing every stage.">
            <FlowChain steps={CHANGE_CONTROL_STAGES} />
          </StaffSection>
          <StaffSection title="Red-team controls" description="Adversarial cases each agent must survive before autonomy moves.">
            <div className="space-y-1">
              {RED_TEAM_CASES.map((c) => (
                <p key={c.key} className="text-xs text-muted-foreground flex items-start gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-info" />
                  <span><strong>{c.key}</strong> — {c.attack} · control: {c.control}</span>
                </p>
              ))}
            </div>
          </StaffSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}
