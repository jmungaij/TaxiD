/**
 * RENTAL OPERATIONS & CERTIFICATION CONSOLE.
 *
 * One place to see whether the rental service is actually safe to operate:
 * what is running now, what the orchestrator recovered on its own, what needs
 * a human, which vehicles may be sold, which policies you still owe a decision
 * on, whether the money reconciles, and exactly which controls are proven.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Helmet } from "react-helmet-async";
import { AlertTriangle, Gauge, RefreshCw, ShieldCheck } from "lucide-react";
import {
  decideRefund, loadAuthority, loadBusinessDecisions, loadCertification,
  loadCertificationConsistency, loadControlTower, loadDomainEvents,
  loadExceptions, loadExternalEvidence, loadPolicies, loadReadiness, loadReadinessChecks,
  loadReconciliation, loadRefunds, loadReleaseGates, loadSagas, recordHandover,
  recordReadinessEvidence, resolveException,
  loadPolicyVersions, loadPolicyDecisions, loadExceptionSla, loadCorporateExposure,
  loadCorporateApprovals, loadBookingTruth, decidePolicyVersion, decideCorporateApproval,
  loadCatalogueGroups, GROUP_LABEL, type CatalogueGroup,
  GATE_LABEL, GATE_TONE, VERDICT_LABEL, VERDICT_TONE,
  POLICY_STATE_LABEL, DECISION_CLASS_LABEL, SLA_LABEL, APPROVAL_LEVEL_LABEL,
  type AuthorityRow, type BusinessDecision, type CertificationRow, type CertificationSummary,
  type ControlTower, type DomainEvent, type ExternalEvidenceRow, type ReadinessCheck,
  type ReadinessRow, type ReconciliationRow, type RefundRow, type ReleaseGate,
  type RentalException, type RentalPolicy, type SagaRun,
  type PolicyVersion, type PolicyDecision, type ExceptionSla,
  type CorporateExposure, type CorporateApproval,
} from "@/lib/rentals/operations";

const kes = (n: number | null | undefined) =>
  `KSh ${Number(n ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-KE") : "—");

export default function RentalOperations() {
  const [tower, setTower] = useState<ControlTower | null>(null);
  const [controls, setControls] = useState<CertificationRow[]>([]);
  const [summary, setSummary] = useState<CertificationSummary | null>(null);
  const [exceptions, setExceptions] = useState<RentalException[]>([]);
  const [policies, setPolicies] = useState<RentalPolicy[]>([]);
  const [readiness, setReadiness] = useState<ReadinessRow[]>([]);
  const [checks, setChecks] = useState<ReadinessCheck[]>([]);
  const [recon, setRecon] = useState<ReconciliationRow[]>([]);
  const [authority, setAuthority] = useState<AuthorityRow[]>([]);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [sagas, setSagas] = useState<SagaRun[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [gates, setGates] = useState<ReleaseGate[]>([]);
  const [decisions, setDecisions] = useState<BusinessDecision[]>([]);
  const [external, setExternal] = useState<ExternalEvidenceRow[]>([]);
  const [consistency, setConsistency] = useState<Awaited<ReturnType<typeof loadCertificationConsistency>>>(null);
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [policyLog, setPolicyLog] = useState<PolicyDecision[]>([]);
  const [sla, setSla] = useState<ExceptionSla[]>([]);
  const [exposure, setExposure] = useState<CorporateExposure[]>([]);
  const [approvals, setApprovals] = useState<CorporateApproval[]>([]);
  const [groups, setGroups] = useState<CatalogueGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [t, cert, ex, po, rd, ck, rc, au, ev, sg, rf, gt, bd, xe, cs, pv, pd, sla, ce, ca, gr] = await Promise.all([
        loadControlTower(), loadCertification(), loadExceptions(), loadPolicies(),
        loadReadiness(), loadReadinessChecks(), loadReconciliation(), loadAuthority(),
        loadDomainEvents(), loadSagas(), loadRefunds(), loadReleaseGates(),
        loadBusinessDecisions(), loadExternalEvidence(), loadCertificationConsistency(),
        loadPolicyVersions(), loadPolicyDecisions(), loadExceptionSla(),
        loadCorporateExposure(), loadCorporateApprovals(), loadCatalogueGroups(),
      ]);
      setGroups(gr);
      setTower(t); setControls(cert.controls); setSummary(cert.summary);
      setExceptions(ex); setPolicies(po); setReadiness(rd); setChecks(ck);
      setRecon(rc); setAuthority(au); setEvents(ev); setSagas(sg); setRefunds(rf);
      setGates(gt); setDecisions(bd); setExternal(xe); setConsistency(cs);
      setVersions(pv); setPolicyLog(pd); setSla(sla); setExposure(ce); setApprovals(ca);

    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const undecided = policies.filter((p) => p.state !== "ACTIVE");
  const breaks = recon.filter((r) => r.reconciliation_state !== "RECONCILED");

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <Helmet>
        <title>Rental operations &amp; certification | SAFARID</title>
        <meta name="description" content="Live rental control tower, exception handling, fleet readiness, money reconciliation and evidence-backed certification." />
      </Helmet>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-primary" /> Rental operations &amp; certification
          </h1>
          <p className="text-sm text-muted-foreground">
            What is running now, what the service recovered by itself, and exactly what is proven.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {summary && (
            <Badge variant={summary.certification === "PRODUCTION READY" ? "default" : "secondary"} className="text-sm">
              {summary.certification} · {summary.passed}/{summary.controls} proven
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>
      </header>

      {tower && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Live rentals", tower.active_bookings],
            ["Waiting for a vehicle", tower.awaiting_allocation],
            ["Open exceptions", tower.exceptions_open],
            ["Urgent escalations", tower.escalations_p0 + tower.escalations_p1],
            ["Change requests", tower.change_requests_open],
            ["Refunds pending", tower.refunds_pending],
            ["Money mismatches", tower.reconciliation_breaks],
            ["Expired quote holds", tower.stale_quote_holds],
            ["Vehicles bookable", tower.units_available],
            ["Vehicles not ready", tower.units_not_ready],
            ["Policies you still owe", tower.policies_undecided],
            ["Failed background jobs", tower.failed_platform_events],
          ].map(([label, value]) => (
            <Card key={String(label)}>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">{label}</CardDescription>
                <CardTitle className="text-2xl">{Number(value)}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="gates">
        <TabsList className="flex-wrap">
          <TabsTrigger value="gates">Release gates</TabsTrigger>
          <TabsTrigger value="certification">Certification</TabsTrigger>
          <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
          <TabsTrigger value="handover">Handover</TabsTrigger>
          <TabsTrigger value="readiness">Fleet readiness</TabsTrigger>
          <TabsTrigger value="money">Money</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="governance">Policy governance</TabsTrigger>
          <TabsTrigger value="sla">Response times</TabsTrigger>
          <TabsTrigger value="corporate">Corporate control</TabsTrigger>
          <TabsTrigger value="truth">Booking truth</TabsTrigger>
          <TabsTrigger value="flow">Workflow</TabsTrigger>
        </TabsList>

        {/* RELEASE GATES */}
        <TabsContent value="gates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What still stands between rentals and going live</CardTitle>
              <CardDescription>
                Each gate clears only when every test under it is proven by a recorded result. Nothing here
                can be cleared by hand.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {gates.map((g) => (
                <div key={g.gate_code} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{g.label}</p>
                      <p className="text-xs text-muted-foreground">{g.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{g.passed}/{g.controls} proven</span>
                      <Badge variant={GATE_TONE[g.gate_status] ?? "outline"}>
                        {GATE_LABEL[g.gate_status] ?? g.gate_status}
                      </Badge>
                    </div>
                  </div>
                  {(g.reasons?.length ?? 0) > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                      {(g.reasons ?? []).map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  )}
                </div>
              ))}
              {gates.length === 0 && !loading && (
                <p className="text-sm text-muted-foreground">No gates recorded.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Decisions only you can make ({decisions.length})</CardTitle>
                <CardDescription>Each one holds the policy gate shut until you set the rule.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {decisions.map((d) => (
                  <div key={d.policy_code} className="rounded-md border p-2">
                    <p className="text-sm font-medium">{d.label}</p>
                    <p className="text-xs text-muted-foreground">
                      Applies at {d.evaluation_point.split("_").join(" ").toLowerCase()} · {d.state.split("_").join(" ").toLowerCase()}
                    </p>
                  </div>
                ))}
                {decisions.length === 0 && <p className="text-sm text-muted-foreground">Every rule is decided.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Evidence that must come from outside ({external.length})</CardTitle>
                <CardDescription>These cannot be proven from inside the running app.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {external.map((x) => (
                  <div key={x.control_code} className="rounded-md border p-2">
                    <p className="text-sm font-medium">{x.title}</p>
                    <p className="text-xs text-muted-foreground">Needs: {x.evidence_source}</p>
                  </div>
                ))}
                {external.length === 0 && <p className="text-sm text-muted-foreground">Nothing outstanding.</p>}
              </CardContent>
            </Card>
          </div>

          {consistency && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Do the numbers add up?</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {consistency.consistent
                  ? `Yes — ${consistency.verdict_sum} results across ${consistency.controls} tests, and every test belongs to a gate.`
                  : `No — ${consistency.verdict_sum} results recorded against ${consistency.controls} tests. Do not trust the summary until this is corrected.`}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* CERTIFICATION */}
        <TabsContent value="certification" className="space-y-4">
          {summary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Where the rental service stands</CardTitle>
                <CardDescription>
                  {summary.passed} proven · {summary.partial} partly proven · {summary.blocked} blocked ·{" "}
                  {summary.not_tested} not tested · {summary.requires_external_action} needing outside evidence ·{" "}
                  {summary.failed} failed. A control is only proven by a recorded test against the real database.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          {groups.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">The catalogue, by area</CardTitle>
                <CardDescription>
                  Every control belongs to one area. The figures below are counted from the recorded results, not typed in.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groups.map((g) => (
                  <div key={g.control_group} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {GROUP_LABEL[g.control_group] ?? g.control_group.split("_").join(" ")}
                      </span>
                      <Badge variant={g.failed > 0 ? "destructive" : g.passed === g.controls ? "default" : "secondary"}>
                        {g.passed}/{g.controls} proven
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {g.partial} partly proven · {g.blocked} blocked · {g.not_tested} not tested ·{" "}
                      {g.requires_external_action} needing outside evidence · {g.failed} failed
                    </p>
                    {g.open_p0 > 0 && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {g.open_p0} must-pass control
                        {g.open_p0 === 1 ? "" : "s"} still open
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="space-y-3 pt-6">
              {controls.map((c) => (
                <div key={c.control_code} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={VERDICT_TONE[c.verdict ?? "NOT_TESTED"] ?? "outline"} className="text-[10px] uppercase">
                      {VERDICT_LABEL[c.verdict ?? "NOT_TESTED"] ?? "Not tested yet"}
                    </Badge>
                    <span className="text-sm font-medium">{c.title}</span>
                    <span className="text-xs text-muted-foreground">{c.control_code} · {c.domain}</span>
                    {c.mandatory && <Badge variant="outline" className="text-[10px] uppercase">must pass</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.requirement}</p>
                  {c.blocked_reason && (
                    <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {c.blocked_reason}
                    </p>
                  )}
                  {c.evidence && (
                    <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px] text-muted-foreground">
                      {JSON.stringify(c.evidence, null, 2)}
                    </pre>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Last tested {when(c.executed_at)} {c.environment ? `· ${c.environment}` : ""}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* EXCEPTIONS */}
        <TabsContent value="exceptions" className="space-y-4">
          <ExceptionsPanel rows={exceptions} onDone={refresh} />
          <Card>
            <CardHeader><CardTitle className="text-base">Recovery runs</CardTitle>
              <CardDescription>Each attempt the service made to put a rental right by itself.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Workflow</TableHead><TableHead>Subject</TableHead><TableHead>State</TableHead>
                  <TableHead>Problem</TableHead><TableHead>Started</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {sagas.length === 0 && <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">Nothing has needed recovery.</TableCell></TableRow>}
                  {sagas.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs">{s.saga}</TableCell>
                      <TableCell className="text-xs">{s.subject_ref ?? "—"}</TableCell>
                      <TableCell><Badge variant={s.state === "ESCALATED" ? "destructive" : "outline"} className="text-[10px]">{s.state}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.last_error ?? "—"}</TableCell>
                      <TableCell className="text-xs">{when(s.started_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* HANDOVER */}
        <TabsContent value="handover">
          <HandoverPanel onDone={refresh} />
        </TabsContent>

        {/* READINESS */}
        <TabsContent value="readiness">
          <ReadinessPanel rows={readiness} checks={checks} onDone={refresh} />
        </TabsContent>

        {/* MONEY */}
        <TabsContent value="money" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Reconciliation</CardTitle>
              <CardDescription>
                Booking against our record of the money against what M-Pesa actually verified.
                {breaks.length > 0 ? ` ${breaks.length} need attention.` : " Everything matches."}
              </CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Booking</TableHead><TableHead>Status</TableHead><TableHead>Quoted</TableHead>
                  <TableHead>Paid</TableHead><TableHead>Cash recorded</TableHead><TableHead>M-Pesa verified</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {recon.length === 0 && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">No rental payments yet.</TableCell></TableRow>}
                  {recon.map((r) => (
                    <TableRow key={r.booking_reference}>
                      <TableCell className="text-xs font-medium">{r.booking_reference}</TableCell>
                      <TableCell className="text-xs">{r.booking_status}</TableCell>
                      <TableCell className="text-xs">{kes(r.total_kes)}</TableCell>
                      <TableCell className="text-xs">{kes(r.amount_paid_kes)}</TableCell>
                      <TableCell className="text-xs">{kes(r.ledger_cash_kes)}</TableCell>
                      <TableCell className="text-xs">{kes(r.provider_verified_kes)}</TableCell>
                      <TableCell>
                        <Badge variant={r.reconciliation_state === "RECONCILED" ? "default" : "destructive"} className="text-[10px]">
                          {r.reconciliation_state}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <RefundsPanel rows={refunds} onDone={refresh} />
        </TabsContent>

        {/* POLICIES */}
        <TabsContent value="policies">
          <Card>
            <CardHeader><CardTitle className="text-base">Rules the service applies</CardTitle>
              <CardDescription>
                {undecided.length > 0
                  ? `${undecided.length} rules have no decision from you, so the service refuses those situations rather than guessing.`
                  : "Every rule has a recorded decision."}
              </CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Rule</TableHead><TableHead>Applied at</TableHead><TableHead>State</TableHead><TableHead>Your decision</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {policies.map((p) => (
                    <TableRow key={p.policy_code}>
                      <TableCell className="text-xs"><span className="font-medium">{p.label}</span>
                        {p.note && <span className="block text-muted-foreground">{p.note}</span>}</TableCell>
                      <TableCell className="text-xs">{p.evaluation_point}</TableCell>
                      <TableCell><Badge variant={p.state === "ACTIVE" ? "default" : "secondary"} className="text-[10px]">{p.state}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.owner_decision ?? "Awaiting your decision"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* POLICY GOVERNANCE */}
        <TabsContent value="governance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rental rules, dated and versioned</CardTitle>
              <CardDescription>
                Every rule is a numbered version with its own start date and approval record. Proposed
                SAFARID defaults are recorded but do not take effect until you approve them here. Approving
                a version retires the one it replaces; past bookings keep the version they were made under.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Rule</TableHead><TableHead>Version</TableHead><TableHead>From</TableHead>
                  <TableHead>Status</TableHead><TableHead>Proposed terms</TableHead><TableHead className="text-right">Decision</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {versions.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="text-xs font-medium">{v.policy_code.split("_").join(" ").toLowerCase()}</TableCell>
                      <TableCell className="text-xs">v{v.version}</TableCell>
                      <TableCell className="text-xs">{v.effective_from}</TableCell>
                      <TableCell>
                        <Badge variant={v.state === "ACTIVE" ? "default" : v.state === "PENDING_BUSINESS_APPROVAL" ? "secondary" : "outline"}>
                          {POLICY_STATE_LABEL[v.state] ?? v.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-md text-[11px] text-muted-foreground">
                        <pre className="whitespace-pre-wrap break-words">{JSON.stringify(v.config ?? {}, null, 1)}</pre>
                      </TableCell>
                      <TableCell className="text-right">
                        {v.state === "PENDING_BUSINESS_APPROVAL" ? (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" onClick={async () => {
                              const r = await decidePolicyVersion(v.policy_code, v.version, "APPROVE");
                              if (r.ok) { toast.success("Rule approved and now in force."); void refresh(); }
                              else toast.error(r.message ?? "Could not approve this rule.");
                            }}>Approve</Button>
                            <Button size="sm" variant="outline" onClick={async () => {
                              const r = await decidePolicyVersion(v.policy_code, v.version, "REJECT");
                              if (r.ok) { toast.success("Rule rejected."); void refresh(); }
                              else toast.error(r.message ?? "Could not reject this rule.");
                            }}>Reject</Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{v.approved_at ? when(v.approved_at) : "—"}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Why each booking was allowed or stopped</CardTitle>
              <CardDescription>Every rule check is recorded with the version used, what was checked, the outcome and the reason. These records cannot be edited or removed.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>When</TableHead><TableHead>Checked at</TableHead><TableHead>Rule</TableHead>
                  <TableHead>Subject</TableHead><TableHead>Outcome</TableHead><TableHead>Reason</TableHead><TableHead>Decided by</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {policyLog.length === 0 && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">No rule checks recorded yet.</TableCell></TableRow>}
                  {policyLog.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs">{when(d.decided_at)}</TableCell>
                      <TableCell className="text-xs">{d.evaluation_point.split("_").join(" ").toLowerCase()}</TableCell>
                      <TableCell className="text-xs">{d.policy_code.split("_").join(" ").toLowerCase()} v{d.policy_version ?? "—"}</TableCell>
                      <TableCell className="text-xs">{d.subject_ref ?? "—"}</TableCell>
                      <TableCell><Badge variant={d.decision === "ALLOW" || d.decision === "APPROVED" ? "default" : "destructive"}>{d.decision}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{d.reason ?? "—"}</TableCell>
                      <TableCell className="text-xs">{d.actor_kind === "HUMAN" ? "A person" : "The system"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SLA */}
        <TabsContent value="sla" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What needs attention, and by when</CardTitle>
              <CardDescription>
                Each problem is sorted into what the system fixes by itself, what needs a person, what needs
                approval, and what the system cannot safely continue with. Each one has an owner, a deadline
                and an escalation contact.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Problem</TableHead><TableHead>Handling</TableHead><TableHead>Priority</TableHead>
                  <TableHead>Owner</TableHead><TableHead>Deadline</TableHead><TableHead>Standing</TableHead><TableHead>Escalates to</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {sla.length === 0 && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">Nothing outstanding.</TableCell></TableRow>}
                  {sla.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs">{s.label ?? s.exception_code}<div className="text-[11px] text-muted-foreground">{s.subject_ref ?? s.subject_type}</div></TableCell>
                      <TableCell className="text-xs">{DECISION_CLASS_LABEL[s.decision_class ?? ""] ?? "—"}</TableCell>
                      <TableCell className="text-xs">{s.severity}</TableCell>
                      <TableCell className="text-xs">{s.owner_role ?? "—"}</TableCell>
                      <TableCell className="text-xs">{when(s.sla_due_at)}</TableCell>
                      <TableCell>
                        <Badge variant={s.sla_status === "BREACHED" ? "destructive" : s.sla_status === "AT_RISK" ? "secondary" : s.sla_status === "RESOLVED" ? "outline" : "default"}>
                          {SLA_LABEL[s.sla_status] ?? s.sla_status}
                          {s.sla_status === "ON_TRACK" || s.sla_status === "AT_RISK" ? ` · ${s.minutes_remaining ?? 0} min left` : ""}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.escalated_to ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CORPORATE */}
        <TabsContent value="corporate" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Company accounts, credit and exposure</CardTitle>
              <CardDescription>
                A company booking above its approval limit, or beyond its available credit, is held and no
                vehicle is reserved until someone with authority approves it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Company</TableHead><TableHead>Standing</TableHead><TableHead>Credit limit</TableHead>
                  <TableHead>Outstanding</TableHead><TableHead>Available</TableHead><TableHead>Overdue</TableHead>
                  <TableHead>Bookings</TableHead><TableHead>Waiting approval</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {exposure.length === 0 && <TableRow><TableCell colSpan={8} className="text-sm text-muted-foreground">No company accounts registered for rentals yet.</TableCell></TableRow>}
                  {exposure.map((c) => (
                    <TableRow key={c.account_id}>
                      <TableCell className="text-xs font-medium">{c.legal_name}<div className="text-[11px] text-muted-foreground">{c.account_code}</div></TableCell>
                      <TableCell><Badge variant={c.status === "ACTIVE" ? "default" : "secondary"}>{c.status.split("_").join(" ").toLowerCase()}</Badge></TableCell>
                      <TableCell className="text-xs">{kes(c.credit_limit_kes)}</TableCell>
                      <TableCell className="text-xs">{kes(c.outstanding_kes)}</TableCell>
                      <TableCell className="text-xs">{kes(c.available_credit_kes)}</TableCell>
                      <TableCell className="text-xs">{kes(c.overdue_kes)}</TableCell>
                      <TableCell className="text-xs">{c.bookings}</TableCell>
                      <TableCell className="text-xs">{c.pending_approvals}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Company bookings waiting on approval</CardTitle>
              <CardDescription>Elevated approvals can only be granted by an administrator.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Reference</TableHead><TableHead>Value</TableHead><TableHead>Level</TableHead>
                  <TableHead>Standing</TableHead><TableHead>Raised</TableHead><TableHead className="text-right">Decision</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {approvals.length === 0 && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No company booking has needed approval yet.</TableCell></TableRow>}
                  {approvals.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{a.booking_reference ?? a.quote_reference ?? "—"}</TableCell>
                      <TableCell className="text-xs">{kes(a.amount_kes)}</TableCell>
                      <TableCell className="text-xs">{APPROVAL_LEVEL_LABEL[a.required_level] ?? a.required_level}</TableCell>
                      <TableCell><Badge variant={a.state === "APPROVED" ? "default" : a.state === "REJECTED" ? "destructive" : "secondary"}>{a.state.toLowerCase()}</Badge></TableCell>
                      <TableCell className="text-xs">{when(a.created_at)}</TableCell>
                      <TableCell className="text-right">
                        {a.state === "REQUESTED" ? (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" onClick={async () => {
                              const r = await decideCorporateApproval(a.id, "APPROVE");
                              if (r.ok) { toast.success("Booking approved."); void refresh(); }
                              else toast.error(r.message ?? "Could not approve this booking.");
                            }}>Approve</Button>
                            <Button size="sm" variant="outline" onClick={async () => {
                              const r = await decideCorporateApproval(a.id, "REJECT");
                              if (r.ok) { toast.success("Booking rejected."); void refresh(); }
                              else toast.error(r.message ?? "Could not reject this booking.");
                            }}>Reject</Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{a.decided_at ? when(a.decided_at) : "—"}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* BOOKING TRUTH */}
        <TabsContent value="truth">
          <BookingTruthPanel />
        </TabsContent>

        {/* WORKFLOW */}
        <TabsContent value="flow" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Who owns what</CardTitle>
              <CardDescription>Each part of the rental service has exactly one owner of the truth.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Area</TableHead><TableHead>Owner</TableHead><TableHead>Owns</TableHead><TableHead>May not change</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {authority.map((a) => (
                    <TableRow key={a.domain}>
                      <TableCell className="text-xs font-medium">{a.domain}</TableCell>
                      <TableCell className="text-xs">{a.authoritative_store}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.owns}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.may_not_write ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4" /> Recent activity</CardTitle>
              <CardDescription>Every rental step is recorded once and can be traced end to end.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>What happened</TableHead><TableHead>Subject</TableHead><TableHead>When</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {events.length === 0 && <TableRow><TableCell colSpan={3} className="text-sm text-muted-foreground">No rental activity recorded yet.</TableCell></TableRow>}
                  {events.map((e) => (
                    <TableRow key={e.event_uid}>
                      <TableCell className="text-xs">{e.event_type}</TableCell>
                      <TableCell className="text-xs">{e.entity_ref ?? e.entity_type}</TableCell>
                      <TableCell className="text-xs">{when(e.occurred_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ExceptionsPanel({ rows, onDone }: { rows: RentalException[]; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState<RentalException | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!open || note.trim().length < 5) return;
    setBusy(true);
    const res = await resolveException(open.id, note.trim());
    setBusy(false);
    if (!res.ok) return toast.error(res.message ?? "Could not resolve this.");
    toast.success("Exception resolved.");
    setOpen(null); setNote(""); await onDone();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Exceptions</CardTitle>
        <CardDescription>Routine problems are handled automatically. These are the ones needing judgement.</CardDescription></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Problem</TableHead><TableHead>Subject</TableHead><TableHead>Severity</TableHead>
            <TableHead>State</TableHead><TableHead>Tries</TableHead><TableHead>Opened</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">No exceptions.</TableCell></TableRow>}
            {rows.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="text-xs font-medium">{x.exception_code.split("_").join(" ").toLowerCase()}</TableCell>
                <TableCell className="text-xs">{x.subject_ref ?? x.subject_type}</TableCell>
                <TableCell><Badge variant={x.severity === "P0" ? "destructive" : "secondary"} className="text-[10px]">{x.severity}</Badge></TableCell>
                <TableCell className="text-xs">{x.state}</TableCell>
                <TableCell className="text-xs">{x.attempts}</TableCell>
                <TableCell className="text-xs">{when(x.opened_at)}</TableCell>
                <TableCell className="text-right">
                  {x.state !== "RESOLVED" && (
                    <Button size="sm" variant="outline" onClick={() => { setOpen(x); setNote(""); }}>Resolve</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Resolve exception</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="res">What did you do, and why?</Label>
            <Textarea id="res" value={note} onChange={(e) => setNote(e.target.value)} rows={4}
              placeholder="Recorded so anyone reviewing this later understands the decision." />
          </div>
          <DialogFooter>
            <Button onClick={() => void submit()} disabled={busy || note.trim().length < 5}>Record resolution</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function HandoverPanel({ onDone }: { onDone: () => Promise<void> }) {
  const [form, setForm] = useState({
    bookingReference: "", direction: "PICKUP" as "PICKUP" | "RETURN", location: "",
    odometerKm: "", fuelLevel: "FULL", conditionNote: "", customerName: "", damageFound: "NO",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const valid = useMemo(() =>
    form.bookingReference.trim().length > 3 && form.location.trim().length > 1 &&
    Number(form.odometerKm) > 0 && form.customerName.trim().length > 1, [form]);

  const submit = async () => {
    setBusy(true);
    const res = await recordHandover({
      bookingReference: form.bookingReference.trim().toUpperCase(),
      direction: form.direction,
      location: form.location.trim(),
      odometerKm: Math.trunc(Number(form.odometerKm)),
      fuelLevel: form.fuelLevel,
      conditionNote: form.conditionNote.trim(),
      customerName: form.customerName.trim(),
      damageFound: form.damageFound === "YES",
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.message ?? "Could not record this handover.");
    toast.success(form.direction === "PICKUP" ? "Collection recorded." : "Return recorded.");
    setForm((f) => ({ ...f, bookingReference: "", odometerKm: "", conditionNote: "", customerName: "" }));
    await onDone();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Record a collection or return</CardTitle>
        <CardDescription>
          A rental cannot move to collected or returned without these details, so there is always a record of the
          vehicle's condition at each handover.
        </CardDescription></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ref">Booking reference</Label>
          <Input id="ref" value={form.bookingReference} onChange={(e) => set("bookingReference")(e.target.value)} placeholder="RB-…" />
        </div>
        <div className="space-y-2">
          <Label>Handover</Label>
          <Select value={form.direction} onValueChange={(v) => set("direction")(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="PICKUP">Collection</SelectItem>
              <SelectItem value="RETURN">Return</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="loc">Place</Label>
          <Input id="loc" value={form.location} onChange={(e) => set("location")(e.target.value)} placeholder="Westlands branch" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="odo">Odometer (km)</Label>
          <Input id="odo" inputMode="numeric" value={form.odometerKm} onChange={(e) => set("odometerKm")(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Fuel level</Label>
          <Select value={form.fuelLevel} onValueChange={(v) => set("fuelLevel")(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["FULL", "THREE_QUARTER", "HALF", "QUARTER", "EMPTY"].map((f) => (
                <SelectItem key={f} value={f}>{f.split("_").join(" ").toLowerCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cust">Customer present</Label>
          <Input id="cust" value={form.customerName} onChange={(e) => set("customerName")(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Damage found</Label>
          <Select value={form.damageFound} onValueChange={(v) => set("damageFound")(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="NO">No</SelectItem>
              <SelectItem value="YES">Yes — raise an inspection</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="cond">Condition notes</Label>
          <Textarea id="cond" rows={3} value={form.conditionNote} onChange={(e) => set("conditionNote")(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Button onClick={() => void submit()} disabled={busy || !valid}>Record handover</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReadinessPanel({ rows, checks, onDone }: { rows: ReadinessRow[]; checks: ReadinessCheck[]; onDone: () => Promise<void> }) {
  const [unit, setUnit] = useState<ReadinessRow | null>(null);
  const [form, setForm] = useState({ checkCode: "", verdict: "PASS" as "PASS" | "FAIL", evidence: "", documentRef: "", validUntil: "" });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!unit || !form.checkCode || form.evidence.trim().length < 5) return;
    setBusy(true);
    const res = await recordReadinessEvidence({ unitId: unit.unit_id, ...form, evidence: form.evidence.trim() });
    setBusy(false);
    if (!res.ok) return toast.error(res.message ?? "Could not record that.");
    toast.success("Readiness evidence recorded.");
    setUnit(null); setForm({ checkCode: "", verdict: "PASS", evidence: "", documentRef: "", validUntil: "" });
    await onDone();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Fleet readiness</CardTitle>
        <CardDescription>
          A vehicle can only be offered once every check has real evidence behind it. Vehicles brought in from the old
          records stay off sale until then.
        </CardDescription></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Vehicle</TableHead><TableHead>Status</TableHead><TableHead>Details complete</TableHead>
            <TableHead>Checks passed</TableHead><TableHead>Outstanding</TableHead><TableHead>Sellable</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">No vehicles recorded.</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.unit_id}>
                <TableCell className="text-xs font-medium">{r.plate}</TableCell>
                <TableCell className="text-xs">{r.status}</TableCell>
                <TableCell className="text-xs">
                  {[["identity", r.identity_ok], ["class", r.class_ok], ["use", r.capability_ok], ["seats", r.seats_ok], ["branch", r.branch_ok]]
                    .filter(([, ok]) => !ok).map(([k]) => String(k)).join(", ") || "complete"}
                </TableCell>
                <TableCell className="text-xs">{r.evidence_passes}/{r.mandatory_checks}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {(r.outstanding_external_checks ?? []).join(", ") || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={r.may_be_activated ? "default" : "secondary"} className="text-[10px]">
                    {r.may_be_activated ? "yes" : "not yet"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setUnit(r)}>Record evidence</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={Boolean(unit)} onOpenChange={(o) => !o && setUnit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Readiness evidence — {unit?.plate}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Check</Label>
              <Select value={form.checkCode} onValueChange={(v) => setForm((f) => ({ ...f, checkCode: v }))}>
                <SelectTrigger><SelectValue placeholder="Choose a check" /></SelectTrigger>
                <SelectContent>
                  {checks.map((c) => <SelectItem key={c.check_code} value={c.check_code}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Result</Label>
              <Select value={form.verdict} onValueChange={(v) => setForm((f) => ({ ...f, verdict: v as "PASS" | "FAIL" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PASS">Passed</SelectItem>
                  <SelectItem value="FAIL">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev">Evidence</Label>
              <Textarea id="ev" rows={3} value={form.evidence} onChange={(e) => setForm((f) => ({ ...f, evidence: e.target.value }))}
                placeholder="What you checked and what you saw." />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="doc">Document reference</Label>
                <Input id="doc" value={form.documentRef} onChange={(e) => setForm((f) => ({ ...f, documentRef: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="val">Valid until</Label>
                <Input id="val" type="date" value={form.validUntil} onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void submit()} disabled={busy || !form.checkCode || form.evidence.trim().length < 5}>Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RefundsPanel({ rows, onDone }: { rows: RefundRow[]; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState<RefundRow | null>(null);
  const [form, setForm] = useState({ amount: "", basis: "", note: "" });
  const [busy, setBusy] = useState(false);

  const decide = async (decision: "AUTHORISE" | "DECLINE") => {
    if (!open) return;
    setBusy(true);
    const res = await decideRefund({
      refundId: open.id, decision,
      amountKes: decision === "AUTHORISE" ? Number(form.amount) : undefined,
      policyBasis: form.basis.trim() || undefined,
      note: form.note.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.message ?? "Could not record that decision.");
    toast.success("Refund decision recorded.");
    setOpen(null); setForm({ amount: "", basis: "", note: "" }); await onDone();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Refunds</CardTitle>
        <CardDescription>
          No refund amount is ever calculated automatically — you set the amount and the rule it rests on.
        </CardDescription></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Reason</TableHead><TableHead>Amount</TableHead><TableHead>State</TableHead>
            <TableHead>Basis</TableHead><TableHead>Raised</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No refunds requested.</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{r.reason ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.amount_kes == null ? "not set" : kes(r.amount_kes)}</TableCell>
                <TableCell className="text-xs">{r.state}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.policy_basis ?? "—"}</TableCell>
                <TableCell className="text-xs">{when(r.created_at)}</TableCell>
                <TableCell className="text-right">
                  {r.state !== "PAID" && r.state !== "DECLINED" && (
                    <Button size="sm" variant="outline" onClick={() => { setOpen(r); setForm({ amount: "", basis: "", note: "" }); }}>Decide</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Refund decision</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amt">Amount to refund (KSh)</Label>
              <Input id="amt" inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bas">Rule this rests on</Label>
              <Input id="bas" value={form.basis} onChange={(e) => setForm((f) => ({ ...f, basis: e.target.value }))}
                placeholder="e.g. cancelled 5 days ahead — full refund" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rn">Note</Label>
              <Textarea id="rn" rows={3} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => void decide("DECLINE")} disabled={busy}>Decline</Button>
            <Button onClick={() => void decide("AUTHORISE")} disabled={busy || !(Number(form.amount) > 0) || form.basis.trim().length < 5}>
              Authorise refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * BOOKING TRUTH — one screen that answers everything about a single booking,
 * read straight from the authoritative records.
 */
function BookingTruthPanel() {
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [truth, setTruth] = useState<Record<string, unknown> | null>(null);

  const look = async () => {
    if (!reference.trim()) return;
    setBusy(true);
    try {
      const data = await loadBookingTruth(reference.trim());
      setTruth(data);
      if (data && data.ok === false) {
        toast.error(String(data.reason_code) === "NOT_FOUND"
          ? "No booking or quote with that reference."
          : "You do not have permission to open this.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const section = (key: string, label: string) => {
    const value = truth?.[key];
    if (value === undefined || value === null) return null;
    const empty = Array.isArray(value) && value.length === 0;
    return (
      <div key={key} className="rounded-md border p-3">
        <div className="mb-1 text-xs font-semibold">{label}</div>
        {empty ? (
          <p className="text-xs text-muted-foreground">Nothing recorded.</p>
        ) : (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Booking truth</CardTitle>
        <CardDescription>
          Enter a booking or quote reference to see the customer, company account, the price they were
          quoted, the rules applied, the vehicle and provider, the reservation, the payment and its
          bookkeeping, pickup and return, changes, refunds, open problems and one time-ordered history.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grow">
            <Label htmlFor="truth-ref" className="text-xs">Booking or quote reference</Label>
            <Input id="truth-ref" value={reference} onChange={(e) => setReference(e.target.value)}
                   placeholder="e.g. RQ-2026-0001 or RB-2026-0001" />
          </div>
          <Button onClick={() => void look()} disabled={busy || !reference.trim()}>
            {busy ? "Looking…" : "Open"}
          </Button>
        </div>

        {truth?.ok === true && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">Current state: {String(truth.current_state ?? "—")}</Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["customer", "Customer"],
                ["corporate", "Company account"],
                ["quote", "Quote and price"],
                ["payment", "Payment"],
                ["vehicle", "Vehicle"],
                ["provider", "Provider"],
                ["reservation", "Reservation"],
                ["ledger", "Bookkeeping"],
                ["policy_decisions", "Rules applied"],
                ["corporate_approvals", "Company approvals"],
                ["fulfilment", "Pickup and return"],
                ["amendments", "Changes"],
                ["refunds", "Refunds"],
                ["exceptions", "Open problems"],
                ["sagas", "Workflow runs"],
                ["timeline", "History"],
              ].map(([k, l]) => section(k, l))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
