/**
 * Phase 8.4.13 — Commercial Financial Capture & Review.
 *
 * The finance audit surface for the transaction spine. Every money figure shown
 * here was captured server-side from `service_line_financial_terms` against an
 * authoritative booking; nothing is estimated in the browser. Recognition stays
 * blocked until the captured fields are complete, a payment reference exists,
 * and finance signs off — both on the transaction and on the recognition rule.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BadgeCheck, CircleSlash, DatabaseZap, FileWarning,
  Landmark, RefreshCw, ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { untypedDb } from "@/integrations/supabase/untyped";
import {
  CAPTURE_FIELD_LABEL, approveRecognitionRule, asStringList, checkEligibility, formatCents,
  reviewTransactionFinancials, runFinancialBackfill, summariseCapture,
  type BackfillRunRow, type EligibilityCheckRow, type FinancialTermsRow,
  type RecognitionRuleRow, type SpineTransactionRow,
} from "@/lib/staff/phase84/financialCapture";

const db = untypedDb;

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "approved" ? "bg-success/15 text-success border-success/30"
    : status === "rejected" ? "bg-destructive/15 text-destructive border-destructive/30"
    : status === "not_required" ? "bg-muted text-muted-foreground border-border"
    : "bg-warning/15 text-warning-foreground border-warning/30";
  return <Badge variant="outline" className={tone}>{status.replace("_", " ")}</Badge>;
}

export default function StaffFinancialCapture() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SpineTransactionRow[]>([]);
  const [terms, setTerms] = useState<FinancialTermsRow[]>([]);
  const [rules, setRules] = useState<RecognitionRuleRow[]>([]);
  const [checks, setChecks] = useState<EligibilityCheckRow[]>([]);
  const [runs, setRuns] = useState<BackfillRunRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [tx, tm, rl, ck, rn] = await Promise.all([
      db.from("commercial_transactions").select("*").order("created_at", { ascending: false }).limit(200),
      db.from("service_line_financial_terms").select("*").order("service_line"),
      db.from("revenue_recognition_rules").select("*").order("service_line"),
      db.from("revenue_eligibility_checks").select("*").order("checked_at", { ascending: false }).limit(100),
      db.from("commercial_financial_backfill_runs").select("*").order("started_at", { ascending: false }).limit(10),
    ]);
    setRows((tx.data ?? []) as SpineTransactionRow[]);
    setTerms((tm.data ?? []) as FinancialTermsRow[]);
    setRules((rl.data ?? []) as RecognitionRuleRow[]);
    setChecks((ck.data ?? []) as EligibilityCheckRow[]);
    setRuns((rn.data ?? []) as BackfillRunRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => summariseCapture(rows), [rows]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.transaction_ref.toLowerCase().includes(q) ||
      r.service_line.toLowerCase().includes(q) ||
      (r.payment_ref ?? "").toLowerCase().includes(q));
  }, [rows, filter]);
  const current = useMemo(() => rows.find((r) => r.id === selected) ?? null, [rows, selected]);
  const currentChecks = useMemo(
    () => (current ? checks.filter((c) => c.transaction_ref === current.transaction_ref) : []),
    [checks, current],
  );

  const decide = async (decision: "approved" | "rejected") => {
    if (!current) return;
    setBusy(true);
    const res = await reviewTransactionFinancials(current.id, decision, notes || undefined);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error === "economics_incomplete"
        ? `Cannot approve — still missing ${res.missingFields.map((f) => CAPTURE_FIELD_LABEL[f] ?? f).join(", ") || "required fields"}.`
        : res.reason || "Review could not be recorded.");
      return;
    }
    toast.success(res.eligible
      ? `${res.transactionRef} approved and now eligible for a revenue event.`
      : `${res.transactionRef} recorded as ${decision}. Recognition still blocked: ${res.reason}`);
    setNotes("");
    void load();
  };

  const recheck = async (id: string) => {
    setBusy(true);
    const res = await checkEligibility(id, "manual_review");
    setBusy(false);
    toast[res.eligible ? "success" : "info"](res.reason || "Eligibility re-checked.");
    void load();
  };

  const backfill = async (dryRun: boolean) => {
    setBusy(true);
    const res = await runFinancialBackfill(dryRun);
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? "Backfill was refused."); return; }
    toast.success(`${dryRun ? "Dry run" : "Backfill"}: ${res.attempted} attempted, ${res.populated} populated, ${res.stillIncomplete} still incomplete.`);
    void load();
  };

  const signOff = async (ruleKey: string, approve: boolean) => {
    setBusy(true);
    const res = await approveRecognitionRule(ruleKey, approve);
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? "Sign-off failed."); return; }
    toast.success(`${ruleKey} ${approve ? "signed off" : "sign-off withdrawn"}.`);
    void load();
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Landmark className="h-4 w-4" /> Phase 8.4.13 · Financial capture & recognition gate
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Commercial Financial Capture & Review</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Currency, tax, platform commission and partner entitlement are captured at source on every trip and
          charter booking. Revenue is recognised only when those fields are complete, an authoritative payment
          reference exists, finance has approved the figures, and the recognition rule itself is signed off.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Transactions", value: summary.total, icon: DatabaseZap },
          { label: "Economics complete", value: summary.complete, icon: BadgeCheck },
          { label: "Awaiting finance review", value: summary.awaitingReview, icon: FileWarning },
          { label: "Missing payment reference", value: summary.missingPayment, icon: CircleSlash },
          { label: "Recognition eligible", value: summary.eligible, icon: ShieldCheck },
        ].map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2 text-xs">
                <k.icon className="h-3.5 w-3.5" /> {k.label}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 text-2xl font-semibold tabular-nums">
              {loading ? <Skeleton className="h-7 w-12" /> : k.value}
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="review">
        <TabsList>
          <TabsTrigger value="review">Review queue</TabsTrigger>
          <TabsTrigger value="gaps">Remaining gaps</TabsTrigger>
          <TabsTrigger value="terms">Terms & rules</TabsTrigger>
          <TabsTrigger value="backfill">Backfill runs</TabsTrigger>
        </TabsList>

        <TabsContent value="review" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by transaction, service line or payment reference"
              className="max-w-sm"
              aria-label="Filter transactions"
            />
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Captured figures</CardTitle>
                <CardDescription>Server-captured economics per commercial transaction.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? <Skeleton className="h-40 w-full" /> : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Transaction</TableHead>
                        <TableHead>Service line</TableHead>
                        <TableHead className="text-right">Charge</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                        <TableHead className="text-right">Commission</TableHead>
                        <TableHead className="text-right">Partner</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead>Review</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((r) => (
                        <TableRow
                          key={r.id}
                          onClick={() => { setSelected(r.id); setNotes(""); }}
                          className={`cursor-pointer ${selected === r.id ? "bg-muted/60" : ""}`}
                        >
                          <TableCell className="font-medium">{r.transaction_ref}</TableCell>
                          <TableCell className="capitalize">{r.service_line.replace("_", " ")}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCents(r.customer_charge_cents, r.currency)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCents(r.tax_cents, r.currency)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCents(r.platform_revenue_cents, r.currency)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCents(r.partner_entitlement_cents, r.currency)}</TableCell>
                          <TableCell className="text-xs">
                            {r.payment_ref ? `${r.payment_ref} · ${r.payment_status ?? "unknown"}` : (
                              <span className="text-destructive">no payment reference</span>
                            )}
                          </TableCell>
                          <TableCell><StatusBadge status={r.financial_review_status} /></TableCell>
                        </TableRow>
                      ))}
                      {visible.length === 0 ? (
                        <TableRow><TableCell colSpan={8} className="text-sm text-muted-foreground">No transactions match this filter.</TableCell></TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Finance decision</CardTitle>
                <CardDescription>
                  {current ? `${current.transaction_ref} · ${current.provenance}` : "Select a transaction to audit its captured fields."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!current ? (
                  <p className="text-sm text-muted-foreground">Nothing selected.</p>
                ) : (
                  <>
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <dt className="text-muted-foreground">Net (ex-tax)</dt>
                      <dd className="text-right tabular-nums">{formatCents(current.gross_transaction_value_cents, current.currency)}</dd>
                      <dt className="text-muted-foreground">Payment cost</dt>
                      <dd className="text-right tabular-nums">{formatCents(current.payment_cost_cents, current.currency)}</dd>
                      <dt className="text-muted-foreground">Contribution</dt>
                      <dd className="text-right tabular-nums">{formatCents(current.contribution_cents, current.currency)}</dd>
                      <dt className="text-muted-foreground">Fulfilled</dt>
                      <dd className="text-right">{current.fulfilled_at ? new Date(current.fulfilled_at).toLocaleString() : "not fulfilled"}</dd>
                      <dt className="text-muted-foreground">Captured via</dt>
                      <dd className="text-right">{current.financials_source ?? "not captured"}</dd>
                    </dl>

                    {asStringList(current.missing_fields).length > 0 ? (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                        <div className="mb-1 flex items-center gap-2 font-medium text-destructive">
                          <AlertTriangle className="h-4 w-4" /> Missing at source
                        </div>
                        <ul className="list-inside list-disc text-xs text-muted-foreground">
                          {asStringList(current.missing_fields).map((f) => (
                            <li key={f}>{CAPTURE_FIELD_LABEL[f] ?? f}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success">
                        All required financial fields are captured.
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">{current.eligibility_reason ?? "No eligibility check recorded yet."}</p>

                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Reviewer note (stored on the transaction)"
                      rows={3}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => void decide("approved")} disabled={busy}>Approve figures</Button>
                      <Button size="sm" variant="destructive" onClick={() => void decide("rejected")} disabled={busy}>Reject</Button>
                      <Button size="sm" variant="outline" onClick={() => void recheck(current.id)} disabled={busy}>Re-check eligibility</Button>
                    </div>

                    <Separator />
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">Eligibility audit trail</div>
                      {currentChecks.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No checks logged for this transaction.</p>
                      ) : currentChecks.slice(0, 6).map((c) => (
                        <div key={c.id} className="rounded-md border p-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{c.eligible ? "Eligible" : "Blocked"} · {c.source}</span>
                            <span className="text-muted-foreground">{new Date(c.checked_at).toLocaleString()}</span>
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {asStringList(c.blockers).join(" ") || "No blockers recorded."}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="gaps">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fields still missing at source</CardTitle>
              <CardDescription>Counted across the {summary.total} transactions loaded. These are real gaps, not rounding.</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.missingTally.length === 0 ? (
                <p className="text-sm text-muted-foreground">No missing fields across the loaded transactions.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Field</TableHead><TableHead className="text-right">Transactions blocked</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.missingTally.map(([field, count]) => (
                      <TableRow key={field}>
                        <TableCell>{CAPTURE_FIELD_LABEL[field] ?? field}</TableCell>
                        <TableCell className="text-right tabular-nums">{count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="terms" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Service line financial terms</CardTitle>
              <CardDescription>The authoritative rates used to capture tax, commission and partner entitlement.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service line</TableHead><TableHead>Currency</TableHead>
                    <TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Commission</TableHead>
                    <TableHead className="text-right">Payment cost</TableHead><TableHead>Contract</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terms.map((t) => (
                    <TableRow key={t.service_line}>
                      <TableCell className="capitalize">{t.service_line.replace("_", " ")}</TableCell>
                      <TableCell>{t.currency}</TableCell>
                      <TableCell className="text-right tabular-nums">{(t.tax_rate_bps / 100).toFixed(2)}% {t.tax_inclusive ? "incl." : "excl."}</TableCell>
                      <TableCell className="text-right tabular-nums">{(t.commission_bps / 100).toFixed(2)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{(t.payment_cost_bps / 100).toFixed(2)}%</TableCell>
                      <TableCell>{t.principal_contract ? "Principal" : "Agent"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recognition rules</CardTitle>
              <CardDescription>Recognition stays blocked until finance signs off on the rule.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead><TableHead>Service line</TableHead>
                    <TableHead>Basis</TableHead><TableHead>Requires</TableHead>
                    <TableHead>Sign-off</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((r) => (
                    <TableRow key={r.rule_key}>
                      <TableCell className="font-medium">{r.rule_key}</TableCell>
                      <TableCell className="capitalize">{r.service_line.replace("_", " ")}</TableCell>
                      <TableCell>{r.recognise_gross ? "Gross" : "Net platform"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[r.requires_payment && "payment", r.requires_invoice && "invoice", r.requires_settlement && "settlement"]
                          .filter(Boolean).join(", ") || "fulfilment only"}
                      </TableCell>
                      <TableCell>
                        {r.approved_at
                          ? <Badge variant="outline" className="bg-success/15 text-success border-success/30">signed off</Badge>
                          : <Badge variant="outline" className="bg-warning/15 text-warning-foreground border-warning/30">pending</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant={r.approved_at ? "outline" : "default"} disabled={busy}
                          onClick={() => void signOff(r.rule_key, !r.approved_at)}>
                          {r.approved_at ? "Withdraw" : "Sign off"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backfill" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Controlled backfill</CardTitle>
              <CardDescription>
                Re-derives the money fields for existing bookings from the service line terms and reports the
                remaining gaps. Restricted to finance and super admins.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void backfill(true)} disabled={busy}>Dry run</Button>
                <Button size="sm" onClick={() => void backfill(false)} disabled={busy}>Run backfill</Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead><TableHead>Mode</TableHead>
                    <TableHead className="text-right">Attempted</TableHead>
                    <TableHead className="text-right">Populated</TableHead>
                    <TableHead className="text-right">Still incomplete</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.started_at).toLocaleString()}</TableCell>
                      <TableCell>{r.dry_run ? "Dry run" : "Applied"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.attempted}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.populated}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.still_incomplete}</TableCell>
                    </TableRow>
                  ))}
                  {runs.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">No backfill runs recorded.</TableCell></TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
