/**
 * Finance governance panel — audit trail, Gate H pre-check, sign-off automation.
 *
 * Read-only for anyone without finance authority: the controls are hidden, and
 * the database refuses the call regardless. Auto sign-off defaults to a dry run
 * so a reviewer sees the decisions before any of them are written.
 */
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, FileClock, Gavel, PlayCircle, RefreshCw, ScanSearch, ShieldAlert, Wand2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  FIELD_CLASS_LABELS, approveRecognitionRule, autoApproveCapture, gatePrecheck, isFinanceApprover,
  loadAutoApprovalRuns, loadFinanceAudit, loadRecognitionRules, runFinancialBackfill,
  type AutoApprovalRun, type FinanceAuditEntry, type FinanceFieldClass, type GatePrecheck,
} from "@/lib/staff/phase85";

const CLASSES: (FinanceFieldClass | "all")[] = [
  "all", "currency", "tax", "commission", "partner_entitlement", "recognition_rule", "review",
];

export default function FinanceGovernancePanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [approver, setApprover] = useState(false);
  const [entries, setEntries] = useState<FinanceAuditEntry[]>([]);
  const [fieldClass, setFieldClass] = useState<FinanceFieldClass | "all">("all");
  const [rules, setRules] = useState<Record<string, unknown>[]>([]);
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [precheckRef, setPrecheckRef] = useState("");
  const [precheck, setPrecheck] = useState<GatePrecheck | null>(null);
  const [threshold, setThreshold] = useState(85);
  const [dryRun, setDryRun] = useState(true);
  const [lastRun, setLastRun] = useState<AutoApprovalRun | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [auth, audit, r, rr] = await Promise.all([
      isFinanceApprover(),
      loadFinanceAudit(fieldClass === "all" ? {} : { fieldClass }),
      loadRecognitionRules(),
      loadAutoApprovalRuns(),
    ]);
    setApprover(auth);
    setEntries(audit.entries);
    setRules(r.rules);
    setRuns(rr.runs);
    setLoading(false);
    if (!audit.ok && audit.error) toast.error(`Audit trail unavailable: ${audit.error}`);
  }, [fieldClass]);

  useEffect(() => { void load(); }, [load]);

  const doPrecheck = async () => {
    const ref = precheckRef.trim().toUpperCase();
    if (!ref) return;
    setBusy(true);
    const res = await gatePrecheck({ ref });
    setBusy(false);
    setPrecheck(res);
    if (!res.ok) toast.error(res.error === "transaction_not_found" ? `${ref} is not on the spine.` : (res.error ?? "Pre-check failed."));
  };

  const doAutoApprove = async () => {
    setBusy(true);
    const res = await autoApproveCapture({ dryRun, threshold, limit: 200 });
    setBusy(false);
    setLastRun(res);
    if (!res.ok) { toast.error(res.error ?? "Auto sign-off refused."); return; }
    toast.success(
      `${dryRun ? "Dry run" : "Applied"}: ${res.auto_approved} auto signed off, ${res.left_for_review} held for manual review of ${res.scanned} scanned.`);
    if (!dryRun) void load();
  };

  const doBackfill = async (apply: boolean) => {
    setBusy(true);
    const res = await runFinancialBackfill({ dryRun: !apply, limit: 500 });
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? "Backfill refused."); return; }
    toast.success(`${apply ? "Backfill" : "Dry run"}: ${res.attempted} attempted, ${res.populated} populated, ${res.stillIncomplete} still incomplete.`);
    if (apply) void load();
  };

  const doSignOff = async (ruleKey: string, approve: boolean) => {
    setBusy(true);
    const res = await approveRecognitionRule(ruleKey, approve);
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? "Sign-off refused."); return; }
    toast.success(`${ruleKey} ${approve ? "signed off" : "sign-off withdrawn"}.`);
    void load();
  };

  return (
    <div className="space-y-4">
      {!loading && !approver ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            You are viewing finance governance in read-only mode. Rule sign-off, backfill jobs and
            automated approvals require finance authority and are refused by the database for other roles.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanSearch className="h-4 w-4" /> Gate H pre-check
          </CardTitle>
          <CardDescription>
            Read-only and side-effect free — the same contract other services call before attempting recognition.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={precheckRef} onChange={(e) => setPrecheckRef(e.target.value)}
              placeholder="YTX-2026-000020" className="max-w-xs" aria-label="Transaction reference to pre-check" />
            <Button size="sm" onClick={() => void doPrecheck()} disabled={busy}>Pre-check</Button>
          </div>
          {precheck?.ok ? (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{precheck.transaction_ref}</span>
                <Badge variant="outline" className="capitalize">{precheck.service_line?.replace("_", " ")}</Badge>
                <Badge variant="outline" className={precheck.eligible
                  ? "border-success/30 bg-success/15 text-success"
                  : "border-warning/40 bg-warning/10 text-warning-foreground"}>
                  {precheck.eligible ? "eligible" : "not eligible"}
                </Badge>
                <Badge variant="outline">{precheck.rule_key ?? "no rule"}</Badge>
                <Badge variant="outline">review: {precheck.review_status}</Badge>
              </div>
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">Missing fields</div>
                {precheck.missing_fields?.length
                  ? <p className="font-mono text-xs">{precheck.missing_fields.join(", ")}</p>
                  : <p className="text-xs text-success">None — economics complete.</p>}
              </div>
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">Blockers</div>
                {precheck.blockers?.length
                  ? <ul className="list-inside list-disc text-xs text-muted-foreground">
                      {precheck.blockers.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                  : <p className="text-xs text-success">None.</p>}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4" /> Automated finance sign-off
          </CardTitle>
          <CardDescription>
            Signs off only transactions where every required field is populated, the terms are approved, payment
            evidence is confirmed and the waterfall reconciles. Anything ambiguous stays with a human, with the
            reason recorded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="threshold" className="text-xs">Confidence threshold</Label>
              <Input id="threshold" type="number" min={60} max={100} value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))} className="w-24" />
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch id="dry" checked={dryRun} onCheckedChange={setDryRun} />
              <Label htmlFor="dry" className="text-xs">Dry run</Label>
            </div>
            <Button size="sm" onClick={() => void doAutoApprove()} disabled={busy || !approver}>
              <PlayCircle className="mr-2 h-4 w-4" /> Run sign-off
            </Button>
            <Separator orientation="vertical" className="h-8" />
            <Button size="sm" variant="outline" onClick={() => void doBackfill(false)} disabled={busy || !approver}>
              Backfill dry run
            </Button>
            <Button size="sm" variant="outline" data-analytics="staff.finance.apply_backfill" onClick={() => void doBackfill(true)} disabled={busy || !approver}>
              Apply backfill
            </Button>
          </div>

          {lastRun?.ok ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Scanned", lastRun.scanned],
                  ["Auto signed off", lastRun.auto_approved],
                  ["Held for review", lastRun.left_for_review],
                ].map(([l, v]) => (
                  <div key={String(l)} className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{l}</div>
                    <div className="text-lg font-semibold tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead><TableHead>Confidence</TableHead>
                    <TableHead>Decision</TableHead><TableHead>Why it needs a human</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lastRun.decisions.map((d) => (
                    <TableRow key={d.transaction_ref}>
                      <TableCell className="font-medium">{d.transaction_ref}</TableCell>
                      <TableCell className="tabular-nums">{d.confidence}</TableCell>
                      <TableCell>
                        {d.decision === "auto_approved"
                          ? <Badge variant="outline" className="border-success/30 bg-success/15 text-success">auto signed off</Badge>
                          : <Badge variant="outline">manual review</Badge>}
                      </TableCell>
                      <TableCell className="max-w-[28rem] text-xs text-muted-foreground">
                        {d.ambiguities?.length ? d.ambiguities.join(" ") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : null}

          {runs.length ? (
            <div>
              <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Recent runs</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead><TableHead>Mode</TableHead><TableHead>Threshold</TableHead>
                    <TableHead className="text-right">Scanned</TableHead>
                    <TableHead className="text-right">Signed off</TableHead>
                    <TableHead className="text-right">Held</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={String(r.id)}>
                      <TableCell className="text-xs">{new Date(String(r.started_at)).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{r.dry_run ? "dry run" : "applied"}</TableCell>
                      <TableCell className="tabular-nums">{String(r.threshold)}</TableCell>
                      <TableCell className="text-right tabular-nums">{String(r.scanned)}</TableCell>
                      <TableCell className="text-right tabular-nums">{String(r.auto_approved)}</TableCell>
                      <TableCell className="text-right tabular-nums">{String(r.left_for_review)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gavel className="h-4 w-4" /> Recognition rule sign-off
          </CardTitle>
          <CardDescription>Finance authority only. Every sign-off and withdrawal is audited.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? <Skeleton className="h-32 w-full" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead><TableHead>Service line</TableHead>
                  <TableHead>Basis</TableHead><TableHead>Signed off</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => {
                  const signed = !!r.approved_by;
                  const key = String(r.rule_key);
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{key}</TableCell>
                      <TableCell className="capitalize">{String(r.service_line).replace("_", " ")}</TableCell>
                      <TableCell className="text-xs">{r.recognise_gross ? "gross" : "net"}</TableCell>
                      <TableCell>
                        {signed
                          ? <span className="flex items-center gap-1 text-xs text-success">
                              <BadgeCheck className="h-3.5 w-3.5" />
                              {r.approved_at ? new Date(String(r.approved_at)).toLocaleDateString() : "yes"}
                            </span>
                          : <span className="text-xs text-muted-foreground">not signed off</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant={signed ? "ghost" : "outline"} disabled={busy || !approver}
                          onClick={() => void doSignOff(key, !signed)}>
                          {signed ? "Withdraw" : "Sign off"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileClock className="h-4 w-4" /> Immutable finance audit trail
            </CardTitle>
            <CardDescription>
              Every change to currency, tax, commission, partner entitlement and sign-off, with reviewer identity
              and before/after values. Entries cannot be edited or deleted.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select value={fieldClass} onValueChange={(v) => setFieldClass(v as FinanceFieldClass | "all")}>
              <SelectTrigger className="w-[13rem]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CLASSES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c === "all" ? "All change types" : FIELD_CLASS_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="icon" variant="outline" onClick={() => void load()} aria-label="Refresh audit trail">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? <Skeleton className="h-40 w-full" /> : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No changes recorded for this filter yet. The trail starts from the moment auditing was enabled — it is
              not backfilled, because earlier before/after values cannot be proven.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead><TableHead>Entity</TableHead><TableHead>Field</TableHead>
                  <TableHead>Type</TableHead><TableHead>Before</TableHead><TableHead>After</TableHead>
                  <TableHead>Reviewer</TableHead><TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs">{new Date(e.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{e.entity_key}</div>
                      <div className="text-muted-foreground">{e.entity_kind.replace(/_/g, " ")}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.field}</TableCell>
                    <TableCell><Badge variant="outline">{FIELD_CLASS_LABELS[e.field_class]}</Badge></TableCell>
                    <TableCell className="max-w-[12rem] truncate font-mono text-xs">{e.value_before ?? "—"}</TableCell>
                    <TableCell className="max-w-[12rem] truncate font-mono text-xs">{e.value_after ?? "—"}</TableCell>
                    <TableCell className="max-w-[14rem] truncate text-xs">
                      {e.changed_by_email ?? (e.changed_by ? e.changed_by.slice(0, 8) : "system")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{e.change_source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
