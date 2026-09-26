/**
 * Phase 4 — SAFARID Agentic Operating System command surface.
 *
 * Deliberately not another dashboard: this is a decision environment. Each tab
 * shows a working part of the operating model — the agent network and its
 * authority ceilings, the event fabric and state machines, a live orchestration
 * run (context assembled, peers consulted, gate evaluated), the autonomy ladder
 * with its measurement gate, red-team controls, the AI governance register, and
 * the Command Centre answer to "what requires SAFARID's attention today?".
 *
 * Nothing here fabricates a figure. Where a measure has no store, it reports
 * DATA NOT AVAILABLE; where evidence is unreadable, the recommendation is
 * withheld and the missing source is named.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StaffPageHeader, StaffSection, FlowChain, ChipList } from "@/components/staff/primitives";
import { useAuth } from "@/hooks/useAuth";
import { probeRecordCoverage, type Coverage } from "@/lib/staff/phase2";
import {
  ACTION_CLASS_LABEL, ACTION_POLICIES, AGENTS, AGENT_MEASURES, AUTONOMY_LABEL,
  ATTENTION_CANDIDATES, BUSINESS_EVENTS, CHANGE_CONTROL_STAGES, COORDINATIONS,
  ENTERPRISE_LOOP, EPISTEMIC_LABEL, LEARNING_QUESTIONS, LEARNING_TARGETS,
  NEXT_BEST_ACTIONS, ORCHESTRATION_LOOP, OVERRIDE_ACTIONS, OVERRIDE_RECORD_FIELDS,
  RED_TEAM_CASES, STATE_MACHINES, SUCCESS_CRITERIA,
  agentCeiling, attentionQueue, autonomyEligibility, autonomyLadderSummary,
  governanceRegister, measureState, orchestrate, phase4Verdict,
  type Epistemic,
} from "@/lib/staff/phase4";

const RISK_TONE: Record<string, string> = {
  low: "border-muted-foreground/30 text-muted-foreground",
  medium: "border-info/50 text-info",
  high: "border-warning/50 text-warning",
};

const CLASS_TONE: Record<string, string> = {
  A0: "border-muted-foreground/30 text-muted-foreground",
  A1: "border-info/50 text-info",
  A2: "border-info/50 text-info",
  A3: "border-warning/50 text-warning",
  A4: "border-primary/50 text-primary",
  A5: "border-destructive/50 text-destructive",
};

function EpistemicBadge({ value }: { value: Epistemic }) {
  return (
    <Badge variant="outline" className="text-[10px] tracking-wide" title={EPISTEMIC_LABEL[value]}>
      {value}
    </Badge>
  );
}

const tables = () => {
  const set = new Set<string>();
  for (const e of BUSINESS_EVENTS) if (e.source) set.add(e.source);
  for (const m of STATE_MACHINES) if (m.table) set.add(m.table);
  for (const c of COORDINATIONS) {
    for (const x of c.consults) set.add(x.evidence);
    for (const o of c.options) if (o.quantifiedBy) set.add(o.quantifiedBy);
  }
  for (const a of ATTENTION_CANDIDATES) for (const t of a.evidence) set.add(t);
  for (const n of NEXT_BEST_ACTIONS) { set.add(n.evidence); if (n.quantifiedBy) set.add(n.quantifiedBy); }
  return [...set];
};

export default function StaffAgentic() {
  const { roles } = useAuth();
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [runKey, setRunKey] = useState(COORDINATIONS[0].key);

  const probes = useMemo(tables, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    probeRecordCoverage(probes).then((c) => {
      if (!alive) return;
      setCoverage(c);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [nonce, probes]);

  const run = useMemo(
    () => (coverage ? orchestrate(runKey, roles, coverage) : null),
    [coverage, roles, runKey],
  );
  const attention = useMemo(
    () => (coverage ? attentionQueue(roles, coverage) : []),
    [coverage, roles],
  );
  const verdict = useMemo(phase4Verdict, []);
  const ladder = useMemo(autonomyLadderSummary, []);
  const register = useMemo(governanceRegister, []);

  return (
    <div>
      <StaffPageHeader
        eyebrow="Phase 4 — Agentic operating system"
        title="Agentic SAFARID"
        lede="AI agents operate as controlled digital workers inside SAFARID's real processes — within explicit authority, on assembled context, against explicit object states, with humans retained at every consequential decision. No agent speaks to the business directly; the orchestrator coordinates them."
        actions={
          <Button variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Re-probe evidence
          </Button>
        }
      />

      <Card className="mb-8">
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            {verdict.measured ? (
              <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
            ) : (
              <ShieldAlert className="mt-0.5 h-5 w-5 text-warning" />
            )}
            <div>
              <div className="text-sm font-semibold">
                {AGENTS.length} agents · {ACTION_POLICIES.length} action policies · {BUSINESS_EVENTS.length} events
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{verdict.statement}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="command">
        <TabsList className="mb-6 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="command">Command centre</TabsTrigger>
          <TabsTrigger value="model">Operating model</TabsTrigger>
          <TabsTrigger value="network">Agent network</TabsTrigger>
          <TabsTrigger value="orchestration">Orchestration</TabsTrigger>
          <TabsTrigger value="authority">Authority gate</TabsTrigger>
          <TabsTrigger value="fabric">Event fabric</TabsTrigger>
          <TabsTrigger value="autonomy">Autonomy & learning</TabsTrigger>
          <TabsTrigger value="governance">AI governance</TabsTrigger>
        </TabsList>

        {/* -------------------------------------------------- command centre */}
        <TabsContent value="command">
          <StaffSection
            title="What requires SAFARID's attention today?"
            description="Each line is established only when every evidencing source is readable for your identity. Unestablished lines name what is missing instead of asserting a finding."
          >
            <div className="space-y-3">
              {attention.map(({ item, established, missing, gateSummary }) => (
                <Card key={item.kind}>
                  <CardContent className="pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold">{item.label}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">{gateSummary}</Badge>
                        <Badge
                          variant="outline"
                          className={established ? "border-primary/50 text-primary" : "border-muted-foreground/30 text-muted-foreground"}
                        >
                          {loading ? "probing…" : established ? "Established" : "Not established"}
                        </Badge>
                      </div>
                    </div>
                    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      <div><dt className="text-muted-foreground">Detecting agent</dt><dd>{item.agent}</dd></div>
                      <div><dt className="text-muted-foreground">Owner</dt><dd>{item.owner}</dd></div>
                      <div><dt className="text-muted-foreground">Authority</dt><dd>{item.authority}</dd></div>
                      <div><dt className="text-muted-foreground">Expected outcome</dt><dd>{item.expectedOutcome}</dd></div>
                    </dl>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Evidence: <span className="font-mono">{item.evidence.join(", ")}</span>
                    </div>
                    {!loading && missing.length > 0 && (
                      <p className="mt-2 text-xs text-destructive">
                        Withheld — unreadable source(s): <span className="font-mono">{missing.join(", ")}</span>
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
              {loading && <p className="text-sm text-muted-foreground">Probing authorised evidence…</p>}
            </div>
          </StaffSection>

          <StaffSection title="Next best action by object" description="Every recommendation carries reason, evidence, owner, deadline and the source that would quantify its impact.">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Object</th>
                    <th className="px-3 py-2 text-left">Next best action</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                    <th className="px-3 py-2 text-left">Evidence</th>
                    <th className="px-3 py-2 text-left">Owner</th>
                    <th className="px-3 py-2 text-left">Deadline</th>
                    <th className="px-3 py-2 text-left">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {NEXT_BEST_ACTIONS.map((n) => {
                    const readable = coverage?.[n.evidence] && coverage[n.evidence].rows !== null;
                    const quantified = n.quantifiedBy && coverage?.[n.quantifiedBy]?.rows != null;
                    return (
                      <tr key={n.object + n.action} className="border-t align-top">
                        <td className="px-3 py-2 font-medium">{n.object}</td>
                        <td className="px-3 py-2">{n.action}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{n.reason}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {n.evidence}
                          {!loading && !readable && <span className="ml-1 text-destructive">(unreadable)</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">{n.owner}</td>
                        <td className="px-3 py-2 text-xs">{n.deadline}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {loading ? "…" : quantified ? n.impact : "DATA NOT AVAILABLE"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </StaffSection>
        </TabsContent>

        {/* -------------------------------------------------- operating model */}
        <TabsContent value="model">
          <StaffSection title="Operating Model 2.0" description="The old model ended at 'employee performs task'. This one closes the loop through measurement and learning.">
            <FlowChain steps={ORCHESTRATION_LOOP} />
          </StaffSection>
          <StaffSection title="The enterprise loop" description="Strategy reaches the marketplace and returns as learning. Agents sense and orchestrate; humans and policy decide.">
            <FlowChain steps={ENTERPRISE_LOOP} />
          </StaffSection>
          <StaffSection title="Epistemic contract" description="Every value an agent carries declares what kind of claim it is. A modelled figure can never be presented as an observed one.">
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(EPISTEMIC_LABEL) as Epistemic[]).map((k) => (
                <Card key={k}>
                  <CardContent className="flex items-start gap-3 pt-5">
                    <EpistemicBadge value={k} />
                    <p className="text-sm text-muted-foreground">{EPISTEMIC_LABEL[k]}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </StaffSection>
        </TabsContent>

        {/* ----------------------------------------------------- agent network */}
        <TabsContent value="network">
          <StaffSection
            title="SAFARID Agent Network"
            description="Specialised digital workers with named human owners. No agent may consult outside its declared peers, and no agent may subscribe to more than half the event fabric — that would be a super-agent by another name."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              {AGENTS.map((a) => (
                <Card key={a.key}>
                  <CardContent className="pt-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{a.name}</div>
                        <div className="text-xs text-muted-foreground">{a.department} · owned by {a.owner}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={RISK_TONE[a.risk]}>{a.risk} risk</Badge>
                        <Badge variant="outline" className="font-mono text-[10px]">{AUTONOMY_LABEL[a.autonomy]}</Badge>
                        <Badge variant="outline" className={CLASS_TONE[agentCeiling(a)]}>ceiling {agentCeiling(a)}</Badge>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{a.purpose}</p>
                    <div className="mt-3 space-y-2 text-xs">
                      <div><span className="text-muted-foreground">Capabilities: </span>{a.capabilities.join(" · ")}</div>
                      <div><span className="text-muted-foreground">Subscribes: </span><span className="font-mono">{a.events.join(", ")}</span></div>
                      <div><span className="text-muted-foreground">May consult: </span>{a.consults.join(", ") || "—"}</div>
                      <div><span className="text-muted-foreground">Context: </span>{a.contextScopes.join(", ")}</div>
                      <div><span className="text-muted-foreground">Tools: </span><span className="font-mono">{a.tools.join(", ")}</span></div>
                      <div><span className="text-muted-foreground">Version: </span><span className="font-mono">{a.version}</span> · <span className="font-mono">{a.model}</span></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </StaffSection>
        </TabsContent>

        {/* ---------------------------------------------------- orchestration */}
        <TabsContent value="orchestration">
          <StaffSection
            title="Multi-agent business reasoning"
            description="Pick a scenario to run it through the whole loop with your own identity and the evidence actually readable right now."
          >
            <div className="mb-4 flex flex-wrap gap-2">
              {COORDINATIONS.map((c) => (
                <Button
                  key={c.key}
                  size="sm"
                  variant={runKey === c.key ? "default" : "outline"}
                  onClick={() => setRunKey(c.key)}
                >
                  {c.label}
                </Button>
              ))}
            </div>

            {loading && <p className="text-sm text-muted-foreground">Assembling context and probing evidence…</p>}

            {run && (
              <div className="space-y-4">
                <Card>
                  <CardContent className="pt-5">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Trigger</div>
                    <div className="mt-1 font-mono text-sm">{run.event}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Owning agent: {run.coordination.owner} ·{" "}
                      {run.eventWired ? "event has a system of record" : "event is unwired and cannot fire"}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-5">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Context assembled</div>
                    <ul className="mt-2 space-y-1 text-xs">
                      {run.context.slots.map((s) => (
                        <li key={s.key} className={s.granted ? "text-muted-foreground" : "text-destructive"}>
                          {s.granted ? "✓" : "✗"} {s.label} — {s.reason}
                          {s.sensitive && <span className="ml-1 font-mono text-[10px]">sensitive</span>}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-5">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Peers consulted</div>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {run.answerable.map((c) => (
                        <li key={c.agent + c.question} className="flex flex-wrap items-center gap-2">
                          <EpistemicBadge value={c.epistemic} />
                          <span className="font-medium">{c.agent}</span>
                          <span className="text-muted-foreground">{c.question}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{c.evidence}</span>
                        </li>
                      ))}
                      {run.unanswerable.map(({ consultation, reason }) => (
                        <li key={consultation.agent + consultation.question} className="text-xs text-destructive">
                          ✗ {consultation.agent} — {consultation.question} ({reason})
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Authority gate</div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={CLASS_TONE[run.gate.requested]}>requested {run.gate.requested}</Badge>
                        <Badge variant="outline" className={CLASS_TONE[run.gate.effective]}>effective {run.gate.effective}</Badge>
                      </div>
                    </div>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {run.gate.reasons.map((r, i) => <li key={i}>· {r}</li>)}
                    </ul>
                    <div className="mt-2 text-xs">
                      {run.gate.approvalRequired && <span>Approval required from {run.gate.approver}. </span>}
                      {run.gate.auditRequired && <span>Audit record mandatory. </span>}
                      {run.gate.rollback && <span>Rollback: {run.gate.rollback}.</span>}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-5">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Options presented to the decision-maker</div>
                    <ul className="mt-2 space-y-2 text-sm">
                      {run.coordination.options.map((o) => {
                        const quantified = run.quantifiable.includes(o);
                        return (
                          <li key={o.label}>
                            <div className="flex flex-wrap items-center gap-2">
                              <EpistemicBadge value={o.epistemic} />
                              <span className="font-medium">{o.label}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {o.consequence} — {quantified ? `quantified from ${o.quantifiedBy}` : "consequence NOT quantified (DATA NOT AVAILABLE)"}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-3 text-xs">
                      <span className="text-muted-foreground">Human decision: </span>{run.coordination.humanDecision}
                    </p>
                    {run.recommendationWithheld && (
                      <p className="mt-2 text-xs text-destructive">Recommendation withheld — {run.recommendationWithheld}</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </StaffSection>
        </TabsContent>

        {/* -------------------------------------------------- authority gate */}
        <TabsContent value="authority">
          <StaffSection
            title="Action classification"
            description="Safer than 'human in the loop': each action is declared, and nothing undeclared may run. A5 is absolute — no context, instruction or escalation can raise it."
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(ACTION_CLASS_LABEL).map(([k, label]) => (
                <Badge key={k} variant="outline" className={`justify-start py-1.5 ${CLASS_TONE[k]}`}>{label}</Badge>
              ))}
            </div>
          </StaffSection>
          <StaffSection title="AI Policy Engine" description="What AI is allowed to do, at what risk, on what data, with which tools, under whose approval, with what audit and rollback.">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Action</th>
                    <th className="px-3 py-2 text-left">Agent</th>
                    <th className="px-3 py-2 text-left">Class</th>
                    <th className="px-3 py-2 text-left">Risk</th>
                    <th className="px-3 py-2 text-left">Data</th>
                    <th className="px-3 py-2 text-left">Approver</th>
                    <th className="px-3 py-2 text-left">Audit</th>
                    <th className="px-3 py-2 text-left">Rollback</th>
                  </tr>
                </thead>
                <tbody>
                  {ACTION_POLICIES.map((p) => (
                    <tr key={p.key} className="border-t align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.label}</div>
                        {p.note && <div className="text-xs text-muted-foreground">{p.note}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs">{p.agent}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className={CLASS_TONE[p.classification]}>{p.classification}</Badge></td>
                      <td className="px-3 py-2 text-xs">{p.risk}</td>
                      <td className="px-3 py-2 text-xs">{p.sensitivity}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.approver}</td>
                      <td className="px-3 py-2 text-xs">{p.audit ? "required" : "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.rollback ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </StaffSection>
          <StaffSection title="Human override" description="Every consequential agent action stays reversible, and every override is attributable.">
            <ChipList items={OVERRIDE_ACTIONS} />
            <div className="mt-3 text-xs text-muted-foreground">Recorded on every override: {OVERRIDE_RECORD_FIELDS.join(" · ")}</div>
          </StaffSection>
        </TabsContent>

        {/* -------------------------------------------------------- fabric */}
        <TabsContent value="fabric">
          <StaffSection title="Event fabric" description="Business events are machine-readable, evidenced by a system of record, and carry their own ceiling on what any resulting workflow may do.">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Event</th>
                    <th className="px-3 py-2 text-left">Meaning</th>
                    <th className="px-3 py-2 text-left">Source</th>
                    <th className="px-3 py-2 text-left">Rows</th>
                    <th className="px-3 py-2 text-left">Subscribers</th>
                    <th className="px-3 py-2 text-left">Ceiling</th>
                  </tr>
                </thead>
                <tbody>
                  {BUSINESS_EVENTS.map((e) => {
                    const probe = e.source ? coverage?.[e.source] : undefined;
                    return (
                      <tr key={e.key} className="border-t align-top">
                        <td className="px-3 py-2 font-mono text-xs">{e.key}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{e.meaning}</td>
                        <td className="px-3 py-2 font-mono text-xs">{e.source ?? "—"}</td>
                        <td className="px-3 py-2 text-xs">
                          {!e.source ? "—" : loading ? "…" : probe && probe.rows !== null ? probe.rows : (
                            <span className="text-destructive">unreadable</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">{e.subscribers.join(", ")}</td>
                        <td className="px-3 py-2"><Badge variant="outline" className={CLASS_TONE[e.ceiling]}>{e.ceiling}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </StaffSection>
          <StaffSection title="Business state machines" description="Agents operate against explicit states, never vague instruction. States marked 'agent may prepare' are the only points where an agent may stage a transition for a human.">
            <div className="grid gap-4 lg:grid-cols-2">
              {STATE_MACHINES.map((m) => (
                <Card key={m.key}>
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold">{m.label}</div>
                      <span className="font-mono text-xs text-muted-foreground">{m.table ?? "no record"}</span>
                    </div>
                    <ul className="mt-3 space-y-1 text-xs">
                      {m.states.map((s) => (
                        <li key={s.key}>
                          <span className="font-mono">{s.key}</span>
                          <span className="text-muted-foreground"> → {s.next.join(", ") || "terminal"}</span>
                          {s.agentMayPrepare && <span className="ml-1 text-[10px] text-primary">agent may prepare</span>}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </StaffSection>
        </TabsContent>

        {/* --------------------------------------------- autonomy & learning */}
        <TabsContent value="autonomy">
          <StaffSection title="Autonomy ladder" description="Autonomy is earned per workflow, on measured risk, accuracy, reliability, business impact and override rate — never granted by default.">
            <div className="space-y-2">
              {ladder.map((l) => (
                <Card key={l.level}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
                    <div className="font-medium">{l.label}</div>
                    <div className="text-xs text-muted-foreground">{l.agents.join(", ") || "No agent at this level"}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="mt-4 overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Agent</th>
                    <th className="px-3 py-2 text-left">Current</th>
                    <th className="px-3 py-2 text-left">Supported by evidence</th>
                    <th className="px-3 py-2 text-left">Promotion blockers</th>
                  </tr>
                </thead>
                <tbody>
                  {AGENTS.map((a) => {
                    const e = autonomyEligibility(a.key)!;
                    return (
                      <tr key={a.key} className="border-t align-top">
                        <td className="px-3 py-2 font-medium">{a.name}</td>
                        <td className="px-3 py-2 font-mono text-xs">L{e.current}</td>
                        <td className="px-3 py-2 font-mono text-xs">L{e.supported}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{e.blockers.join(" · ") || "None"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </StaffSection>

          <StaffSection title="Agent evaluation" description="An agent that cannot be measured cannot be trusted with autonomy. Each measure names the store that would record it.">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Measure</th>
                    <th className="px-3 py-2 text-left">Family</th>
                    <th className="px-3 py-2 text-left">Definition</th>
                    <th className="px-3 py-2 text-left">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {AGENT_MEASURES.map((m) => (
                    <tr key={m.key} className="border-t align-top">
                      <td className="px-3 py-2 font-medium">{m.label}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{m.family}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{m.definition}</td>
                      <td className="px-3 py-2 text-xs">
                        {measureState(m) === "measured" ? m.source : (
                          <Badge variant="outline" className="text-muted-foreground">DATA NOT AVAILABLE</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </StaffSection>

          <StaffSection title="Continuous learning loop" description="After every consequential workflow, the same six questions run and their answers update the system that produced the decision.">
            <FlowChain steps={LEARNING_QUESTIONS} />
            <div className="mt-3 text-xs text-muted-foreground">Updates: {LEARNING_TARGETS.join(" · ")}</div>
          </StaffSection>

          <StaffSection title="Red-team controls" description="Agents must fail safely. Each attack names the control in this codebase that produces the safe failure.">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Attack</th>
                    <th className="px-3 py-2 text-left">Safe failure</th>
                    <th className="px-3 py-2 text-left">Control</th>
                  </tr>
                </thead>
                <tbody>
                  {RED_TEAM_CASES.map((c) => (
                    <tr key={c.key} className="border-t align-top">
                      <td className="px-3 py-2">{c.attack}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.safeFailure}</td>
                      <td className="px-3 py-2 font-mono text-xs">{c.control}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </StaffSection>
        </TabsContent>

        {/* ------------------------------------------------------ governance */}
        <TabsContent value="governance">
          <StaffSection title="AI governance register" description="Derived from the network itself, so the inventory cannot drift from what actually runs.">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">System</th>
                    <th className="px-3 py-2 text-left">Owner</th>
                    <th className="px-3 py-2 text-left">Risk</th>
                    <th className="px-3 py-2 text-left">Data access</th>
                    <th className="px-3 py-2 text-left">Human oversight</th>
                    <th className="px-3 py-2 text-left">Autonomy</th>
                    <th className="px-3 py-2 text-left">Evaluation</th>
                    <th className="px-3 py-2 text-left">Version</th>
                    <th className="px-3 py-2 text-left">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {register.map((e) => (
                    <tr key={e.name} className="border-t align-top">
                      <td className="px-3 py-2 font-medium">{e.name}</td>
                      <td className="px-3 py-2 text-xs">{e.owner}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className={RISK_TONE[e.risk]}>{e.risk}</Badge></td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{e.dataClasses.join(", ")}</td>
                      <td className="px-3 py-2 text-xs">{e.humanOversight}</td>
                      <td className="px-3 py-2 text-xs font-mono">{e.autonomy}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{e.evaluation}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.version}</td>
                      <td className="px-3 py-2 text-xs">{e.reviewCadence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </StaffSection>
          <StaffSection title="Agent change control" description="High-risk agents change only through this path. Prompt, policy, tool and permission changes are versioned like code.">
            <FlowChain steps={CHANGE_CONTROL_STAGES} />
          </StaffSection>
          <StaffSection title="Phase 4 success criteria" description="Success is measured in business, people, AI and organisational outcomes — never in the number of agents.">
            <div className="grid gap-4 sm:grid-cols-2">
              {(["Business", "People", "AI", "Organisation"] as const).map((family) => (
                <Card key={family}>
                  <CardContent className="pt-5">
                    <div className="font-semibold">{family}</div>
                    <ul className="mt-2 space-y-1 text-xs">
                      {SUCCESS_CRITERIA.filter((c) => c.family === family).map((c) => (
                        <li key={c.label} className={c.source ? "text-muted-foreground" : "text-destructive"}>
                          {c.source ? "✓" : "✗"} {c.label} — <span className="font-mono">{c.source ?? "no measurement store"}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </StaffSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}
