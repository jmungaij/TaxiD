import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { RefreshCcw, ExternalLink, Search, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

type Recon = {
  id: string;
  corp_reference: string | null;
  proof_reference: string | null;
  proof_id: string | null;
  mpesa_receipt: string | null;
  expected_amount_cents: number | null;
  proof_amount_cents: number | null;
  wallet_amount_cents: number | null;
  cash_ledger_amount_cents: number | null;
  amount_difference_cents: number | null;
  proof_status: string | null;
  wallet_status: string | null;
  cash_posting_status: string | null;
  proof_exists: boolean | null;
  wallet_posted: boolean | null;
  ledger_posted: boolean | null;
  duplicate_receipt: boolean | null;
  reconciliation_status: string | null;
  mismatch_reason: string | null;
  severity: string | null;
  confidence_score: number | null;
  investigated: boolean | null;
  last_reconciled_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type Attempt = {
  id: string; state: string; amount_cents: number; currency: string;
  mpesa_receipt_number: string | null; checkout_request_id: string | null;
  merchant_request_id: string | null; wallet_posted: boolean | null;
  failure_reason: string | null; initiated_at: string; completed_at: string | null;
  user_id: string; wallet_id: string | null;
};

type AuditRow = {
  id: string; action: string; actor: string | null; actor_user_id: string | null;
  request_id: string | null; correlation_id: string | null;
  payload: Record<string, unknown> | null; created_at: string;
};

function cents(n: number | null | undefined) {
  if (n == null) return "—";
  return `KES ${(n / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const SEV: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "secondary", medium: "outline", high: "destructive", critical: "destructive",
};

export default function ReconciliationMismatches() {
  const [rows, setRows] = useState<Recon[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState<string>("mismatched");
  const [search, setSearch] = useState("");
  const [drill, setDrill] = useState<Recon | null>(null);
  const [drillAttempts, setDrillAttempts] = useState<Attempt[]>([]);
  const [drillAudit, setDrillAudit] = useState<AuditRow[]>([]);

  async function load() {
    setLoading(true);
    let q = supabase.from("corporate_financial_reconciliation")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (status === "mismatched") q = q.neq("reconciliation_status", "RECONCILED" as never);
    else if (status !== "all") q = q.eq("reconciliation_status", status as never);
    if (severity !== "all") q = q.eq("severity", severity as never);
    const { data, error } = await q;
    if (error) console.warn(error.message);
    setRows((data ?? []) as Recon[]);
    setLoading(false);
  }
  useEffect(() => { void load();   }, [severity, status]);

  const visible = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter((r) =>
      (r.corp_reference ?? "").toLowerCase().includes(s) ||
      (r.mpesa_receipt ?? "").toLowerCase().includes(s) ||
      (r.proof_reference ?? "").toLowerCase().includes(s) ||
      (r.mismatch_reason ?? "").toLowerCase().includes(s));
  }, [rows, search]);

  const stats = useMemo(() => {
    const mismatched = rows.filter((r) => r.reconciliation_status && r.reconciliation_status !== "RECONCILED").length;
    const dupes = rows.filter((r) => r.duplicate_receipt).length;
    const missingWallet = rows.filter((r) => r.proof_exists && !r.wallet_posted).length;
    const missingLedger = rows.filter((r) => r.proof_exists && !r.ledger_posted).length;
    return { mismatched, dupes, missingWallet, missingLedger };
  }, [rows]);

  async function openDrill(r: Recon) {
    setDrill(r); setDrillAttempts([]); setDrillAudit([]);
    // Attempts linked by mpesa receipt (strongest) then corp_reference/account_reference.
    const orClauses: string[] = [];
    if (r.mpesa_receipt) orClauses.push(`mpesa_receipt_number.eq.${r.mpesa_receipt}`);
    if (r.corp_reference) orClauses.push(`account_reference.eq.${r.corp_reference}`);
    let attempts: Attempt[] = [];
    if (orClauses.length) {
      const { data } = await supabase
        .from("payment_attempts")
        .select("id,state,amount_cents,currency,mpesa_receipt_number,checkout_request_id,merchant_request_id,wallet_posted,failure_reason,initiated_at,completed_at,user_id,wallet_id")
        .or(orClauses.join(","))
        .order("initiated_at", { ascending: false })
        .limit(20);
      attempts = (data ?? []) as Attempt[];
    }
    setDrillAttempts(attempts);

    // Audit: attempts + reconciliation row.
    const attemptIds = attempts.map((a) => a.id);
    const auditFilters: string[] = [];
    if (attemptIds.length) auditFilters.push(`payment_attempt_id.in.(${attemptIds.join(",")})`);
    if (r.mpesa_receipt) auditFilters.push(`payload->>mpesa_receipt.eq.${r.mpesa_receipt}`);
    let audit: AuditRow[] = [];
    if (auditFilters.length) {
      const { data } = await supabase
        .from("payment_audit_logs_v2")
        .select("id,action,actor,actor_user_id,request_id,correlation_id,payload,created_at")
        .or(auditFilters.join(","))
        .order("created_at", { ascending: false })
        .limit(50);
      audit = (data ?? []) as AuditRow[];
    }
    setDrillAudit(audit);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reconciliation Mismatches</h1>
          <p className="text-sm text-muted-foreground">Investigate proof / wallet / ledger gaps. Each case links to payment attempts and the immutable audit trail.</p>
        </div>
        <Button variant="outline" onClick={() => load()} disabled={loading}>
          <RefreshCcw className="h-4 w-4 mr-2" />Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Mismatched" value={stats.mismatched} tone="warn" />
        <Stat label="Duplicate receipts" value={stats.dupes} tone="danger" />
        <Stat label="Missing wallet post" value={stats.missingWallet} tone="warn" />
        <Stat label="Missing ledger post" value={stats.missingLedger} tone="warn" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Cases ({visible.length})</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Receipt / reference…" className="pl-7 w-56" />
              </div>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Severity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severity</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mismatched">Mismatched only</SelectItem>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="PENDING_REVIEW">Pending review</SelectItem>
                  <SelectItem value="MISMATCH">Mismatch</SelectItem>
                  <SelectItem value="ORPHAN">Orphan</SelectItem>
                  <SelectItem value="FRAUD_ALERT">Fraud alert</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="RECONCILED">Reconciled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Proof</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead>Δ</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="text-right">Investigate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => openDrill(r)}>
                  <TableCell className="font-mono text-xs">{r.mpesa_receipt ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.corp_reference ?? r.proof_reference ?? "—"}</TableCell>
                  <TableCell className="text-xs">{cents(r.expected_amount_cents)}</TableCell>
                  <TableCell className="text-xs">{cents(r.proof_amount_cents)}</TableCell>
                  <TableCell className="text-xs">{cents(r.wallet_amount_cents)}</TableCell>
                  <TableCell className={`text-xs font-mono ${r.amount_difference_cents ? "text-destructive" : ""}`}>{cents(r.amount_difference_cents)}</TableCell>
                  <TableCell><Badge variant={r.reconciliation_status === "RECONCILED" ? "default" : "outline"}>{r.reconciliation_status ?? "—"}</Badge></TableCell>
                  <TableCell className="text-xs max-w-[220px] truncate">{r.mismatch_reason ?? "—"}</TableCell>
                  <TableCell>{r.severity ? <Badge variant={SEV[r.severity.toLowerCase()] ?? "outline"}>{r.severity}</Badge> : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openDrill(r); }}>
                      <AlertTriangle className="h-3 w-3 mr-1" />Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No mismatches.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          {drill && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{drill.mpesa_receipt ?? drill.corp_reference ?? drill.id.slice(0, 8)}</SheetTitle>
                <SheetDescription>{drill.mismatch_reason ?? "Reconciliation case"}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <Info label="Expected" value={cents(drill.expected_amount_cents)} />
                  <Info label="Proof" value={cents(drill.proof_amount_cents)} />
                  <Info label="Wallet" value={cents(drill.wallet_amount_cents)} />
                  <Info label="Cash ledger" value={cents(drill.cash_ledger_amount_cents)} />
                  <Info label="Δ" value={cents(drill.amount_difference_cents)} highlight={!!drill.amount_difference_cents} />
                  <Info label="Confidence" value={drill.confidence_score != null ? `${(Number(drill.confidence_score) * 100).toFixed(0)}%` : "—"} />
                  <Info label="Proof exists" value={drill.proof_exists ? "✓" : "✗"} />
                  <Info label="Wallet posted" value={drill.wallet_posted ? "✓" : "✗"} />
                  <Info label="Ledger posted" value={drill.ledger_posted ? "✓" : "✗"} />
                  <Info label="Duplicate receipt" value={drill.duplicate_receipt ? "⚠︎ yes" : "no"} highlight={!!drill.duplicate_receipt} />
                </div>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Linked payment attempts ({drillAttempts.length})</CardTitle></CardHeader>
                  <CardContent className="max-h-72 overflow-y-auto">
                    {drillAttempts.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No payment attempts matched by receipt or reference.</div>
                    ) : (
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>Attempt</TableHead><TableHead>State</TableHead><TableHead>Amount</TableHead>
                          <TableHead>Wallet</TableHead><TableHead>Initiated</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {drillAttempts.map((a) => (
                            <TableRow key={a.id}>
                              <TableCell className="font-mono text-xs">{a.id.slice(0, 8)}</TableCell>
                              <TableCell><Badge variant={a.state === "COMPLETED" ? "default" : "outline"}>{a.state}</Badge></TableCell>
                              <TableCell className="text-xs">{cents(a.amount_cents)}</TableCell>
                              <TableCell className="text-xs">{a.wallet_posted ? "✓" : "—"}</TableCell>
                              <TableCell className="text-xs">{new Date(a.initiated_at).toLocaleString()}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 flex-row items-center justify-between">
                    <CardTitle className="text-sm">Audit trail ({drillAudit.length})</CardTitle>
                    <Link to="/dashboard/admin/audit-log" className="text-xs text-primary inline-flex items-center gap-1">
                      Full audit log <ExternalLink className="h-3 w-3" />
                    </Link>
                  </CardHeader>
                  <CardContent className="max-h-72 overflow-y-auto space-y-2">
                    {drillAudit.length === 0 && <div className="text-xs text-muted-foreground">No audit events for these attempts.</div>}
                    {drillAudit.map((e) => (
                      <div key={e.id} className="border rounded p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="font-mono">{e.action}</div>
                          <div className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</div>
                        </div>
                        <div className="text-muted-foreground">actor: {e.actor ?? e.actor_user_id ?? "system"} · req {e.request_id?.slice(0, 8) ?? "—"}</div>
                        {e.payload && (
                          <pre className="mt-1 bg-muted p-2 rounded overflow-x-auto max-h-24">{JSON.stringify(e.payload, null, 2)}</pre>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "danger" }) {
  const color = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-status-warning" : tone === "ok" ? "text-status-success" : "text-foreground";
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${color}`}>{value}</div>
    </CardContent></Card>
  );
}
function Info({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="border rounded p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className={`font-mono ${highlight ? "text-destructive font-semibold" : ""}`}>{value}</div>
    </div>
  );
}
