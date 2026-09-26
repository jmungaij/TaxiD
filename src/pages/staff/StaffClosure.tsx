/**
 * Phase 8.5 — Transaction, Revenue & Control Closure.
 *
 * The closure surface over the YTX spine: where the economic chain breaks,
 * what it is worth, who owns it, and whether the phase certifies. Deliberately
 * uncluttered — five questions, each answerable from authoritative data.
 * Anything the source records cannot prove is shown as a gap, never filled in.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BadgeCheck, Banknote, GitBranch, Link2, Radar, RefreshCw,
  ScanSearch, ShieldCheck, Siren, Sparkles, TrendingUp, XCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  LINEAGE_STAGES, certifyPhase85, createSettlementObligation, emitEligibleRevenueEvents,
  emitRevenueEvent, escalateBreachedExceptions, firstBreak, formatCents, loadIntegrity,
  loadMorningBrief, loadRevenueAtRisk, loadRevenueExplain, loadTrace, runMoneyReconciliation,
  type CertificationResult, type ExceptionItem, type IntegrityReport, type MorningBrief,
  type RevenueExplain, type TransactionTrace,
} from "@/lib/staff/phase85";
import FinanceGovernancePanel from "@/components/staff/FinanceGovernancePanel";
import ExceptionSlaInbox from "@/components/staff/ExceptionSlaInbox";
import PriorityBriefPanel from "@/components/staff/PriorityBriefPanel";

interface SpineRow {
  id: string;
  transaction_ref: string;
  service_line: string;
  status: string;
  currency: string | null;
  customer_charge_cents: number | null;
  platform_revenue_cents: number | null;
  partner_entitlement_cents: number | null;
  fulfilled_at: string | null;
  payment_ref: string | null;
  invoice_id: string | null;
  settlement_id: string | null;
  revenue_event_id: string | null;
  economics_complete: boolean;
  financially_eligible: boolean;
  financial_review_status: string;
  eligibility_reason: string | null;
  lineage: { completeness_pct?: number; stages_present?: number } | null;
}

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: typeof Radar }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2 text-xs"><Icon className="h-3.5 w-3.5" /> {label}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const tone =
    severity === "critical" ? "bg-destructive/15 text-destructive border-destructive/30"
    : severity === "high" ? "bg-warning/15 text-warning-foreground border-warning/30"
    : severity === "medium" ? "bg-info/15 text-info border-info/30"
    : "bg-muted text-muted-foreground border-border";
  return <Badge variant="outline" className={tone}>{severity}</Badge>;
}

export default function StaffClosure() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [rows, setRows] = useState<SpineRow[]>([]);
  const [risk, setRisk] = useState<{ totalCents: number; items: ExceptionItem[] }>({ totalCents: 0, items: [] });
  const [explain, setExplain] = useState<RevenueExplain | null>(null);
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [cert, setCert] = useState<CertificationResult | null>(null);
  const [traceRef, setTraceRef] = useState("");
  const [trace, setTrace] = useState<TransactionTrace | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [i, tx, r, e] = await Promise.all([
      loadIntegrity(),
      (supabase as any).from("commercial_transactions").select(
        "id,transaction_ref,service_line,status,currency,customer_charge_cents,platform_revenue_cents," +
        "partner_entitlement_cents,fulfilled_at,payment_ref,invoice_id,settlement_id,revenue_event_id," +
        "economics_complete,financially_eligible,financial_review_status,eligibility_reason,lineage",
      ).order("created_at", { ascending: false }).limit(200),
      loadRevenueAtRisk(),
      loadRevenueExplain(),
    ]);
    setIntegrity(i);
    setRows(((tx.data ?? []) as SpineRow[]));
    setRisk({ totalCents: r.totalCents, items: r.items });
    setExplain(e);
    setLoading(false);
    if (i.error) toast.error(`Integrity read refused: ${i.error}`);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const chainBreaks = useMemo(() => {
    const tally = new Map<string, { count: number; exposure: number }>();
    for (const row of rows) {
      const stage =
        !row.fulfilled_at ? "fulfilment"
        : !row.invoice_id && !row.payment_ref ? "invoice"
        : !row.payment_ref ? "payment"
        : !row.settlement_id && (row.partner_entitlement_cents ?? 0) > 0 ? "settlement"
        : !row.revenue_event_id ? "revenue_event"
        : null;
      if (!stage) continue;
      const prev = tally.get(stage) ?? { count: 0, exposure: 0 };
      tally.set(stage, { count: prev.count + 1, exposure: prev.exposure + (row.customer_charge_cents ?? 0) });
    }
    return [...tally.entries()].sort((a, b) => b[1].exposure - a[1].exposure);
  }, [rows]);

  const runRecon = async () => {
    setBusy(true);
    const res = await runMoneyReconciliation();
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? "Reconciliation refused."); return; }
    toast.success(`Scanned ${res.scanned} transactions · ${res.exceptionsRaised} exceptions · ${formatCents(res.exposureCents)} exposure.`);
    void load();
  };

  const runEmitter = async () => {
    setBusy(true);
    const res = await emitEligibleRevenueEvents();
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? "Emitter refused."); return; }
    toast[res.emitted > 0 ? "success" : "info"](
      res.emitted > 0
        ? `${res.emitted} revenue events emitted, ${res.skipped} refused by the gate.`
        : `Nothing emitted — ${res.skipped} transactions were refused by the eligibility gate.`);
    void load();
  };

  const emitOne = async (row: SpineRow) => {
    setBusy(true);
    const res = await emitRevenueEvent(row.id);
    setBusy(false);
    if (res.emitted) toast.success(`${row.transaction_ref}: ${formatCents(res.amountCents)} recognised under ${res.ruleKey}.`);
    else if (res.idempotent) toast.info(`${row.transaction_ref} already has a revenue event — no duplicate created.`);
    else toast.error(`${row.transaction_ref} refused: ${res.reason}`);
    void load();
  };

  const settleOne = async (row: SpineRow) => {
    setBusy(true);
    const res = await createSettlementObligation(row.id);
    setBusy(false);
    if (!res.ok) { toast.error(`${row.transaction_ref}: ${res.reason}`); return; }
    toast.success(res.idempotent
      ? `${row.transaction_ref} already has a settlement obligation.`
      : `${row.transaction_ref}: ${formatCents(res.entitlementCents)} partner payable raised.`);
    void load();
  };

  const escalate = async () => {
    setBusy(true);
    const res = await escalateBreachedExceptions();
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? "Escalation refused."); return; }
    toast[res.escalated > 0 ? "success" : "info"](`${res.escalated} SLA-breached exceptions escalated.`);
    void load();
  };

  const doTrace = async () => {
    const ref = traceRef.trim().toUpperCase();
    if (!ref) return;
    setBusy(true);
    const res = await loadTrace(ref);
    setBusy(false);
    setTrace(res);
    if (!res.ok) toast.error(res.error === "transaction_not_found" ? `${ref} does not exist on the spine.` : (res.error ?? "Trace failed."));
  };

  const doBrief = async () => {
    setBusy(true);
    const res = await loadMorningBrief();
    setBusy(false);
    setBrief(res);
    if (res.error) toast.error(res.error);
  };

  const doCertify = async () => {
    setBusy(true);
    const res = await certifyPhase85();
    setBusy(false);
    setCert(res);
    if (res.error) { toast.error(res.error); return; }
    toast[res.verdict === "PASS" ? "success" : "error"](
      `Phase 8.5 certification: ${res.verdict} (${res.criteriaPassed}/${res.criteriaTotal} criteria).`);
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <GitBranch className="h-4 w-4" /> Phase 8.5 · Transaction, revenue &amp; control closure
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Economic Closure Control Tower</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          One authoritative chain: demand through booking, fulfilment, money, settlement, revenue, outcome and
          learning. The Control Tower reads the ledger — it never becomes a second financial truth. Where the
          source records cannot prove a stage, the gap is reported rather than filled.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void runRecon()} disabled={busy}>
          <ScanSearch className="mr-2 h-4 w-4" /> Run money reconciliation
        </Button>
        <Button size="sm" variant="outline" onClick={() => void runEmitter()} disabled={busy}>
          <Banknote className="mr-2 h-4 w-4" /> Emit eligible revenue
        </Button>
        <Button size="sm" variant="outline" onClick={() => void escalate()} disabled={busy}>
          <Siren className="mr-2 h-4 w-4" /> Escalate SLA breaches
        </Button>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !integrity ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)
        ) : (
          <>
            <Stat label="Revenue integrity" value={`${integrity.scorePct}%`}
              sub={`${integrity.recognised} recognised of ${integrity.eligible} eligible`} icon={ShieldCheck} />
            <Stat label="Recognised revenue" value={formatCents(integrity.revenueEventsCents)}
              sub={integrity.ledgerReconciles ? "Reconciles to the ledger" : "LEDGER MISMATCH"} icon={TrendingUp} />
            <Stat label="Revenue at risk" value={formatCents(risk.totalCents)}
              sub={`${risk.items.length} open exceptions`} icon={AlertTriangle} />
            <Stat label="Lineage completeness" value={`${integrity.lineageCompletenessPct}%`}
              sub={`${integrity.transactions} transactions on the spine`} icon={Link2} />
          </>
        )}
      </div>

      <Tabs defaultValue="chain">
        <TabsList className="flex-wrap">
          <TabsTrigger value="chain">Chain closure</TabsTrigger>
          <TabsTrigger value="trace">14-stage trace</TabsTrigger>
          <TabsTrigger value="risk">Revenue at risk</TabsTrigger>
          <TabsTrigger value="why">Why? drill-down</TabsTrigger>
          <TabsTrigger value="brief">Morning brief</TabsTrigger>
          <TabsTrigger value="inbox">SLA inbox</TabsTrigger>
          <TabsTrigger value="priority">Priority brief</TabsTrigger>
          <TabsTrigger value="governance">Finance governance</TabsTrigger>
          <TabsTrigger value="cert">Certification</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox">
          <ExceptionSlaInbox onTrace={(ref) => setTraceRef(ref)} />
        </TabsContent>

        <TabsContent value="priority">
          <PriorityBriefPanel onTrace={(ref) => setTraceRef(ref)} />
        </TabsContent>

        <TabsContent value="chain" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Where the chain breaks</CardTitle>
              <CardDescription>
                First unproven stage per transaction, ranked by the money exposed. These are the real records —
                nothing was seeded to make this look healthier.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-32 w-full" /> : chainBreaks.length === 0 ? (
                <p className="text-sm text-success">No open chain breaks across the loaded transactions.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Break stage</TableHead>
                      <TableHead className="text-right">Transactions</TableHead>
                      <TableHead className="text-right">Exposure</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {chainBreaks.map(([stage, v]) => (
                      <TableRow key={stage}>
                        <TableCell className="capitalize">{stage.replace("_", " ")}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.count}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCents(v.exposure)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transaction spine</CardTitle>
              <CardDescription>Emit revenue or raise a partner payable only where the gate allows it.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {loading ? <Skeleton className="h-40 w-full" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transaction</TableHead>
                      <TableHead>Service line</TableHead>
                      <TableHead className="text-right">Charge</TableHead>
                      <TableHead>Lineage</TableHead>
                      <TableHead>Gate</TableHead>
                      <TableHead className="text-right">Close</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          <button className="underline-offset-2 hover:underline" onClick={() => { setTraceRef(row.transaction_ref); void loadTrace(row.transaction_ref).then(setTrace); }}>
                            {row.transaction_ref}
                          </button>
                        </TableCell>
                        <TableCell className="capitalize">{row.service_line.replace("_", " ")}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCents(row.customer_charge_cents, row.currency ?? "KES")}</TableCell>
                        <TableCell className="w-32">
                          <div className="flex items-center gap-2">
                            <Progress value={row.lineage?.completeness_pct ?? 0} className="h-1.5" />
                            <span className="text-xs tabular-nums text-muted-foreground">{row.lineage?.completeness_pct ?? 0}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[22rem] text-xs text-muted-foreground">
                          {row.revenue_event_id ? (
                            <span className="text-success">Revenue recognised</span>
                          ) : row.financially_eligible ? (
                            <span className="text-info">Eligible — awaiting emission</span>
                          ) : (
                            row.eligibility_reason ?? "Not yet checked"
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" disabled={busy || !!row.revenue_event_id}
                              onClick={() => void emitOne(row)}>Emit</Button>
                            <Button size="sm" variant="ghost" disabled={busy || !!row.settlement_id}
                              onClick={() => void settleOne(row)}>Settle</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trace" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Production trace</CardTitle>
              <CardDescription>Every stage carries an authoritative id, timestamp, status and source.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input value={traceRef} onChange={(e) => setTraceRef(e.target.value)}
                  placeholder="YTX-2026-000001" className="max-w-xs" aria-label="Transaction reference" />
                <Button size="sm" onClick={() => void doTrace()} disabled={busy}>Trace</Button>
              </div>

              {!trace?.ok ? (
                <p className="text-sm text-muted-foreground">Enter a YTX reference to trace the full economic chain.</p>
              ) : (
                <>
                  {firstBreak(trace.stages) ? (
                    <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
                      Chain breaks at stage {firstBreak(trace.stages)!.stage_no} —{" "}
                      <span className="font-medium capitalize">{firstBreak(trace.stages)!.stage_key.replace("_", " ")}</span>.
                      No authoritative record exists beyond this point.
                    </div>
                  ) : (
                    <div className="rounded-md border border-success/40 bg-success/5 p-3 text-sm text-success">
                      Complete chain: all 14 stages carry an authoritative record.
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">#</TableHead><TableHead>Stage</TableHead>
                        <TableHead>Status</TableHead><TableHead>Authoritative id</TableHead>
                        <TableHead>When</TableHead><TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {LINEAGE_STAGES.map((def) => {
                        const s = trace.stages.find((x) => x.stage_no === def.no);
                        const missing = !s || s.status === "missing";
                        return (
                          <TableRow key={def.no} className={missing ? "text-muted-foreground" : ""}>
                            <TableCell className="tabular-nums">{def.no}</TableCell>
                            <TableCell>{def.label}</TableCell>
                            <TableCell>
                              {missing
                                ? <Badge variant="outline" className="border-border bg-muted text-muted-foreground">missing</Badge>
                                : <Badge variant="outline" className="border-success/30 bg-success/15 text-success">recorded</Badge>}
                            </TableCell>
                            <TableCell className="max-w-[16rem] truncate font-mono text-xs">{s?.authoritative_id ?? "—"}</TableCell>
                            <TableCell className="text-xs">{s?.occurred_at ? new Date(s.occurred_at).toLocaleString() : "—"}</TableCell>
                            <TableCell className="text-xs">{s?.source ?? "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  <Separator />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border p-3 text-sm">
                      <div className="mb-1 font-medium">Settlement</div>
                      {trace.settlement ? (
                        <p className="text-xs text-muted-foreground">
                          {formatCents(Number(trace.settlement.entitlement_cents))} · {String(trace.settlement.status)}
                          {trace.settlement.variance_cents ? ` · variance ${formatCents(Number(trace.settlement.variance_cents))}` : ""}
                        </p>
                      ) : <p className="text-xs text-muted-foreground">No partner payable raised.</p>}
                    </div>
                    <div className="rounded-md border p-3 text-sm">
                      <div className="mb-1 font-medium">Revenue event</div>
                      {trace.revenueEvent ? (
                        <p className="text-xs text-muted-foreground">
                          {formatCents(Number(trace.revenueEvent.gross_amount_cents))} · {String(trace.revenueEvent.status)}
                        </p>
                      ) : <p className="text-xs text-muted-foreground">No revenue recognised.</p>}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue at risk — {formatCents(risk.totalCents)}</CardTitle>
              <CardDescription>
                Ranked by exposure × urgency × probability of loss × customer impact, not by age.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {risk.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open exceptions. Run the money reconciliation to detect breaks.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Exception</TableHead><TableHead>Transaction</TableHead>
                      <TableHead>Stage</TableHead><TableHead>Severity</TableHead>
                      <TableHead className="text-right">Exposure</TableHead>
                      <TableHead className="text-right">Priority</TableHead>
                      <TableHead>Owner</TableHead><TableHead>SLA due</TableHead>
                      <TableHead>Recommended action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {risk.items.map((x) => (
                      <TableRow key={x.exception_ref}>
                        <TableCell className="font-mono text-xs">{x.exception_ref}</TableCell>
                        <TableCell className="font-medium">{x.transaction_ref ?? "—"}</TableCell>
                        <TableCell className="capitalize">{x.stage.replace("_", " ")}</TableCell>
                        <TableCell><SeverityBadge severity={x.severity} /></TableCell>
                        <TableCell className="text-right tabular-nums">{formatCents(x.exposure_cents)}</TableCell>
                        <TableCell className="text-right tabular-nums">{x.priority_score ?? "—"}</TableCell>
                        <TableCell>{x.owner_team ?? "unassigned"}</TableCell>
                        <TableCell className="text-xs">{x.sla_due_at ? new Date(x.sla_due_at).toLocaleString() : "—"}</TableCell>
                        <TableCell className="max-w-[20rem] text-xs text-muted-foreground">{x.recommended_action}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="why" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recognised revenue — {formatCents(explain?.totalCents ?? 0)}</CardTitle>
              <CardDescription>Last 30 days, decomposed from the revenue ledger down to individual events.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!explain || explain.totalCents === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No revenue has been recognised yet, so there is nothing to decompose. This is the honest state of the
                  ledger — not a rendering gap.
                </p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Service line</TableHead><TableHead className="text-right">Events</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {explain.byServiceLine.map((s) => (
                        <TableRow key={s.service_line}>
                          <TableCell className="capitalize">{s.service_line?.replace("_", " ")}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.events}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCents(s.amount_cents)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Separator />
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Transaction</TableHead><TableHead>Rule</TableHead><TableHead>Payment</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Recognised</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {explain.events.map((e) => (
                        <TableRow key={e.transaction_ref}>
                          <TableCell className="font-medium">{e.transaction_ref}</TableCell>
                          <TableCell className="text-xs">{e.rule_key ?? "—"}</TableCell>
                          <TableCell className="text-xs">{e.payment_ref ?? "no gateway receipt"}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCents(e.amount_cents)}</TableCell>
                          <TableCell className="text-xs">{new Date(e.recognized_at).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="brief">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Morning commercial brief</CardTitle>
              <CardDescription>Yesterday's money, today's priorities, and what the organisation learned.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button size="sm" onClick={() => void doBrief()} disabled={busy}>
                <Sparkles className="mr-2 h-4 w-4" /> Generate brief
              </Button>
              {brief?.ok ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {[
                      ["Revenue", formatCents(brief.yesterday.revenueCents)],
                      ["Contribution", formatCents(brief.yesterday.contributionCents)],
                      ["Collections", formatCents(brief.yesterday.collectionsCents)],
                      ["Transactions", String(brief.yesterday.transactions)],
                      ["Fulfilments", String(brief.yesterday.fulfilments)],
                      ["Exceptions", String(brief.yesterday.exceptions)],
                    ].map(([l, v]) => (
                      <div key={l} className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{l}</div>
                        <div className="text-lg font-semibold tabular-nums">{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border p-3 text-sm">
                      <div className="font-medium">Required approvals</div>
                      <p className="text-xs text-muted-foreground">{brief.approvalsRequired} transactions awaiting finance review.</p>
                    </div>
                    <div className="rounded-md border p-3 text-sm">
                      <div className="font-medium">Critical incidents</div>
                      <p className="text-xs text-muted-foreground">{brief.criticalIncidents} critical exceptions open.</p>
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Top revenue risks today</div>
                    {brief.topRisks.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No open risks recorded.</p>
                    ) : brief.topRisks.map((x) => (
                      <div key={x.exception_ref} className="mb-2 rounded-md border p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{x.transaction_ref ?? x.exception_ref} · {x.kind}</span>
                          <span className="tabular-nums">{formatCents(x.exposure_cents)}</span>
                        </div>
                        <div className="text-muted-foreground">{x.recommended_action}</div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Learning</div>
                    {brief.learning.length === 0
                      ? <p className="text-xs text-muted-foreground">No learning has been recorded yet.</p>
                      : brief.learning.map((l, i) => (
                        <p key={i} className="text-xs text-muted-foreground">{l.learning}</p>
                      ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="governance">
          <FinanceGovernancePanel />
        </TabsContent>

        <TabsContent value="cert">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Phase 8.5 certification gate</CardTitle>
              <CardDescription>
                The phase passes only when the money reconciles end to end. A working interface is not a pass.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button size="sm" onClick={() => void doCertify()} disabled={busy}>
                <BadgeCheck className="mr-2 h-4 w-4" /> Run certification
              </Button>
              {cert ? (
                <>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={cert.verdict === "PASS"
                      ? "border-success/30 bg-success/15 text-success"
                      : "border-destructive/30 bg-destructive/15 text-destructive"}>
                      {cert.verdict}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {cert.criteriaPassed} of {cert.criteriaTotal} criteria · {cert.scorePct}%
                    </span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Criterion</TableHead><TableHead>Result</TableHead><TableHead>Evidence</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {cert.criteria.map((c) => (
                        <TableRow key={c.key}>
                          <TableCell>{c.label}</TableCell>
                          <TableCell>
                            {c.pass
                              ? <span className="flex items-center gap-1 text-success"><BadgeCheck className="h-4 w-4" /> pass</span>
                              : <span className="flex items-center gap-1 text-destructive"><XCircle className="h-4 w-4" /> fail</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{c.detail}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
