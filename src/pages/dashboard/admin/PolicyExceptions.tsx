/**
 * Policy Assurance — Exceptions Register.
 * Document, approve, and time-box temporary authorization exceptions.
 * Includes full audit trail drawer and CSV bulk upload with conflict validation.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Loader2, ShieldOff, PlusCircle, Check, X, History, Upload, Download, FileDown } from "lucide-react";
import { format } from "date-fns";
import { AppButton } from "@/components/nav/AppButton";

type Exception = {
  id: string; resource: string; category: string; severity: string;
  justification: string; compensating_controls: string | null;
  status: "pending" | "approved" | "rejected" | "expired" | "revoked";
  expires_at: string; requested_by: string | null; approved_by: string | null;
  approved_at: string | null; linked_run_id: string | null;
  notes: string | null; created_at: string;
};

type ExceptionEvent = {
  id: string; exception_id: string; action: string;
  actor_id: string | null; reason: string | null;
  previous_status: string | null; new_status: string | null;
  metadata: any; created_at: string;
};

const sevColor: Record<string, string> = {
  critical: "bg-status-danger text-ice", high: "bg-status-warning text-ice",
  medium: "bg-status-warning text-ink", low: "bg-ai text-ice", info: "bg-muted-foreground text-ice",
};
const statusColor: Record<string, string> = {
  pending: "bg-status-warning text-ice", approved: "bg-status-success text-ice",
  rejected: "bg-muted-foreground text-ice", expired: "bg-muted-foreground text-ice", revoked: "bg-status-danger text-ice",
};
const actionColor: Record<string, string> = {
  submitted: "bg-ai text-ice", approved: "bg-status-success text-ice",
  rejected: "bg-muted-foreground text-ice", revoked: "bg-status-danger text-ice",
  expired: "bg-muted-foreground text-ice", edited: "bg-status-warning text-ink",
};
const CATEGORIES = [
  "rls_disabled","no_policies","permissive_true","anon_grant",
  "missing_service_grant","sensitive_realtime","definer_public_grant","other",
];

type CsvRow = {
  resource: string; category: string; severity: string;
  justification: string; expires_at: string;
  compensating_controls?: string; notes?: string;
  _issues: string[];
};

function parseCsv(text: string): { rows: CsvRow[]; header: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], header: [] };
  const parse = (line: string) => {
    const out: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = parse(lines[0]).map((h) => h.toLowerCase());
  const idx = (k: string) => header.indexOf(k);
  const rows = lines.slice(1).map((l) => {
    const p = parse(l);
    const get = (k: string) => (idx(k) >= 0 ? p[idx(k)] ?? "" : "");
    return {
      resource: get("resource"), category: get("category"), severity: get("severity"),
      justification: get("justification"), expires_at: get("expires_at"),
      compensating_controls: get("compensating_controls"), notes: get("notes"),
      _issues: [],
    } as CsvRow;
  });
  return { rows, header };
}

export default function PolicyExceptions() {
  const [rows, setRows] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [decisionModal, setDecisionModal] = useState<{ id: string; action: "approved" | "rejected" | "revoked" } | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [auditFor, setAuditFor] = useState<Exception | null>(null);
  const [auditEvents, setAuditEvents] = useState<ExceptionEvent[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFilters, setExportFilters] = useState({
    action: "all", approver: "", exception_id: "",
    from: "", to: "",
  });
  const [exporting, setExporting] = useState(false);

  const [form, setForm] = useState({
    resource: "", category: "rls_disabled", severity: "high",
    justification: "", compensating_controls: "",
    expires_at: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
    notes: "",
  });

  const load = async () => {
    const { data, error } = await supabase.from("paf_exceptions")
      .select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as Exception[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => filter === "all" ? rows : rows.filter((r) => r.status === filter),
    [rows, filter],
  );

  const submit = async () => {
    if (!form.resource || !form.justification) {
      toast.error("Resource and justification are required"); return;
    }
    setSaving(true);
    const { data: userRes } = await supabase.auth.getUser();
    const { error } = await supabase.from("paf_exceptions").insert({
      resource: form.resource, category: form.category, severity: form.severity,
      justification: form.justification,
      compensating_controls: form.compensating_controls || null,
      expires_at: new Date(form.expires_at).toISOString(),
      notes: form.notes || null,
      requested_by: userRes.user?.id ?? null,
      status: "pending",
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Exception submitted for approval");
    setOpen(false);
    setForm({ ...form, resource: "", justification: "", compensating_controls: "", notes: "" });
    await load();
  };

  const confirmDecision = async () => {
    if (!decisionModal) return;
    const { id, action } = decisionModal;
    if (!decisionReason.trim()) { toast.error("Reason required"); return; }
    const { data: userRes } = await supabase.auth.getUser();
    const patch: any = { status: action, notes: decisionReason };
    if (action === "approved") { patch.approved_by = userRes.user?.id ?? null; patch.approved_at = new Date().toISOString(); }
    const { error } = await supabase.from("paf_exceptions").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Exception ${action}`);
    setDecisionModal(null); setDecisionReason("");
    await load();
  };

  const openAudit = async (ex: Exception) => {
    setAuditFor(ex);
    const { data } = await supabase.from("paf_exception_events")
      .select("*").eq("exception_id", ex.id).order("created_at", { ascending: false });
    setAuditEvents((data as ExceptionEvent[]) ?? []);
  };

  const downloadTemplate = () => {
    const csv = "resource,category,severity,justification,expires_at,compensating_controls,notes\npublic.example_table,rls_disabled,high,Business exception — legacy migration,2026-08-15,Monitored via alert,\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "paf-exceptions-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const onCsvFile = async (file: File) => {
    const text = await file.text();
    const { rows: parsed } = parseCsv(text);
    // Validate
    const activeKeys = new Set(rows.filter((r) => r.status === "approved" || r.status === "pending")
      .map((r) => `${r.resource}::${r.category}`));
    const seen = new Set<string>();
    const validated = parsed.map((r) => {
      const issues: string[] = [];
      if (!r.resource) issues.push("resource required");
      if (!CATEGORIES.includes(r.category)) issues.push(`invalid category '${r.category}'`);
      if (!["critical","high","medium","low","info"].includes(r.severity)) issues.push(`invalid severity '${r.severity}'`);
      if (!r.justification) issues.push("justification required");
      if (!r.expires_at || isNaN(Date.parse(r.expires_at))) issues.push("invalid expires_at");
      else if (new Date(r.expires_at) < new Date()) issues.push("expires_at in past");
      const key = `${r.resource}::${r.category}`;
      if (activeKeys.has(key)) issues.push("conflict: active exception exists");
      if (seen.has(key)) issues.push("duplicate in CSV");
      seen.add(key);
      return { ...r, _issues: issues };
    });
    setCsvRows(validated);
  };

  const importValid = async () => {
    const valid = csvRows.filter((r) => r._issues.length === 0);
    if (!valid.length) { toast.error("No valid rows to import"); return; }
    const { data: userRes } = await supabase.auth.getUser();
    const payload = valid.map((r) => ({
      resource: r.resource, category: r.category, severity: r.severity,
      justification: r.justification,
      compensating_controls: r.compensating_controls || null,
      expires_at: new Date(r.expires_at).toISOString(),
      notes: r.notes || null,
      requested_by: userRes.user?.id ?? null,
      status: "pending",
    }));
    const { error } = await supabase.from("paf_exceptions").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(`Imported ${valid.length} exception(s)`);
    setBulkOpen(false); setCsvRows([]);
    await load();
  };

  const validCount = csvRows.filter((r) => r._issues.length === 0).length;

  const exportEvents = async () => {
    setExporting(true);
    let q = supabase.from("paf_exception_events")
      .select("id,exception_id,action,actor_id,reason,previous_status,new_status,metadata,created_at")
      .order("created_at", { ascending: false }).limit(10000);
    if (exportFilters.action !== "all") q = q.eq("action", exportFilters.action);
    if (exportFilters.approver) q = q.eq("actor_id", exportFilters.approver);
    if (exportFilters.exception_id) q = q.eq("exception_id", exportFilters.exception_id);
    if (exportFilters.from) q = q.gte("created_at", new Date(exportFilters.from).toISOString());
    if (exportFilters.to) q = q.lte("created_at", new Date(exportFilters.to + "T23:59:59").toISOString());
    const { data, error } = await q;
    setExporting(false);
    if (error) { toast.error(error.message); return; }
    const rows = (data ?? []) as any[];
    if (!rows.length) { toast.error("No events matched"); return; }
    const cols = ["id","exception_id","action","actor_id","reason","previous_status","new_status","created_at","metadata"];
    const esc = (v: any) => {
      if (v === null || v === undefined) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `paf-exception-events-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} event(s)`);
    setExportOpen(false);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ShieldOff className="text-primary" /> Exception Register
          </h1>
          <p className="text-muted-foreground">
            Time-boxed authorization exceptions. Approved entries suppress matching PAF findings until expiry.
          </p>
        </div>
        <div className="flex gap-2">
          <Button data-analytics="policyexceptions.export" variant="outline" onClick={() => setExportOpen(true)}>
            <FileDown className="mr-2 h-4 w-4" /> Export events
          </Button>
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Bulk import
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><PlusCircle className="mr-2 h-4 w-4" /> New exception</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Document a new exception</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Resource</Label>
                  <Input placeholder="e.g. public.some_table" value={form.resource}
                    onChange={(e) => setForm({ ...form, resource: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Category</Label>
                    <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div><Label>Severity</Label>
                    <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{["critical","high","medium","low","info"].map((s) =>
                        <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select></div>
                </div>
                <div><Label>Business justification</Label>
                  <Textarea rows={3} value={form.justification}
                    onChange={(e) => setForm({ ...form, justification: e.target.value })} /></div>
                <div><Label>Compensating controls</Label>
                  <Textarea rows={2} value={form.compensating_controls}
                    onChange={(e) => setForm({ ...form, compensating_controls: e.target.value })} /></div>
                <div><Label>Expires on</Label>
                  <Input type="date" value={form.expires_at}
                    onChange={(e) => setForm({ ...form, expires_at: e.target.value })} /></div>
                <div><Label>Notes (optional)</Label>
                  <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={submit} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Submit
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all","pending","approved","rejected","expired","revoked"].map((s) => (
          <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>{s}</Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center"><Loader2 className="animate-spin inline" /></div>
          ) : (
            <ScrollArea className="h-[600px]">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="p-2 text-left">Resource</th><th className="p-2 text-left">Category</th>
                    <th className="p-2 text-left">Severity</th><th className="p-2 text-left">Status</th>
                    <th className="p-2 text-left">Expires</th><th className="p-2 text-left">Justification</th>
                    <th className="p-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/40 align-top">
                      <td className="p-2 font-mono text-xs">{r.resource}</td>
                      <td className="p-2 font-mono text-xs">{r.category}</td>
                      <td className="p-2"><Badge className={sevColor[r.severity]}>{r.severity}</Badge></td>
                      <td className="p-2"><Badge className={statusColor[r.status]}>{r.status}</Badge></td>
                      <td className="p-2 text-xs">{format(new Date(r.expires_at), "PP")}</td>
                      <td className="p-2 max-w-md">{r.justification}</td>
                      <td className="p-2 whitespace-nowrap space-x-1">
                        {r.status === "pending" && (
                          <>
                            <Button size="sm" variant="default" onClick={() => { setDecisionModal({ id: r.id, action: "approved" }); setDecisionReason(""); }}>
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => { setDecisionModal({ id: r.id, action: "rejected" }); setDecisionReason(""); }}>
                              <X className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {r.status === "approved" && (
                          <Button size="sm" variant="outline" onClick={() => { setDecisionModal({ id: r.id, action: "revoked" }); setDecisionReason(""); }}>Revoke</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => openAudit(r)}>
                          <History className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No exceptions.</td></tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Decision reason dialog */}
      <Dialog open={!!decisionModal} onOpenChange={(v) => !v && setDecisionModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">{decisionModal?.action} exception</DialogTitle>
            <DialogDescription>Provide a reason — this is recorded in the audit trail.</DialogDescription>
          </DialogHeader>
          <Textarea rows={4} value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)}
            placeholder="Why are you making this decision?" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionModal(null)}>Cancel</Button>
            <Button onClick={confirmDecision}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit trail drawer */}
      <Sheet open={!!auditFor} onOpenChange={(v) => !v && setAuditFor(null)}>
        <SheetContent className="w-[500px] sm:max-w-[500px]">
          <SheetHeader><SheetTitle>Audit trail</SheetTitle></SheetHeader>
          {auditFor && (
            <div className="mt-4 space-y-4">
              <div className="text-xs font-mono">{auditFor.resource} · {auditFor.category}</div>
              <ScrollArea className="h-[calc(100vh-180px)]">
                <ol className="space-y-3 border-l-2 pl-4">
                  {auditEvents.map((e) => (
                    <li key={e.id} className="relative">
                      <span className="absolute -left-[22px] top-1 h-3 w-3 rounded-full bg-primary" />
                      <div className="flex items-center gap-2">
                        <Badge className={actionColor[e.action] ?? "bg-muted-foreground text-ice"}>{e.action}</Badge>
                        <span className="text-xs text-muted-foreground">{format(new Date(e.created_at), "PPp")}</span>
                      </div>
                      {(e.previous_status || e.new_status) && (
                        <div className="text-xs mt-1">{e.previous_status ?? "—"} → <strong>{e.new_status}</strong></div>
                      )}
                      {e.reason && <div className="text-sm mt-1">{e.reason}</div>}
                      {e.actor_id && <div className="text-[10px] font-mono text-muted-foreground mt-1">actor: {e.actor_id.slice(0,8)}…</div>}
                    </li>
                  ))}
                  {auditEvents.length === 0 && <div className="text-sm text-muted-foreground">No events recorded.</div>}
                </ol>
              </ScrollArea>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Bulk CSV import */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Bulk import exceptions</DialogTitle>
            <DialogDescription>Upload a CSV. We'll validate every row for conflicts, expired dates, and duplicates before importing.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 items-center">
            <Input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && onCsvFile(e.target.files[0])} />
            <Button variant="outline" size="sm" data-analytics="admin.policy_exceptions.download_csv_template" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" /> Download CSV template
            </Button>
          </div>
          {csvRows.length > 0 && (
            <>
              <div className="text-sm">
                <span className="text-status-success font-medium">{validCount} valid</span> · <span className="text-status-danger font-medium">{csvRows.length - validCount} invalid</span>
              </div>
              <ScrollArea className="h-[350px] border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0"><tr>
                    <th className="p-2 text-left">Resource</th><th className="p-2 text-left">Category</th>
                    <th className="p-2 text-left">Sev</th><th className="p-2 text-left">Expires</th>
                    <th className="p-2 text-left">Issues</th>
                  </tr></thead>
                  <tbody>
                    {csvRows.map((r, i) => (
                      <tr key={i} className={`border-b ${r._issues.length ? "bg-status-danger/10 dark:bg-status-danger/20" : ""}`}>
                        <td className="p-2 font-mono">{r.resource}</td>
                        <td className="p-2 font-mono">{r.category}</td>
                        <td className="p-2">{r.severity}</td>
                        <td className="p-2">{r.expires_at}</td>
                        <td className="p-2 text-status-danger">{r._issues.join("; ") || "✓"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkOpen(false); setCsvRows([]); }}>Cancel</Button>
            <Button onClick={importValid} disabled={validCount === 0}>Import {validCount} valid row(s)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export events dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Export exception audit trail</DialogTitle>
            <DialogDescription>Filter events and download as CSV. Up to 10,000 rows per export.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Action</Label>
              <Select value={exportFilters.action} onValueChange={(v) => setExportFilters({ ...exportFilters, action: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {["submitted","approved","rejected","revoked","expired","edited"].map((a) =>
                    <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Approver / actor (user id)</Label>
              <Input placeholder="uuid — leave blank for any" value={exportFilters.approver}
                onChange={(e) => setExportFilters({ ...exportFilters, approver: e.target.value })} />
            </div>
            <div>
              <Label>Exception ID</Label>
              <Input placeholder="uuid — leave blank for any" value={exportFilters.exception_id}
                onChange={(e) => setExportFilters({ ...exportFilters, exception_id: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>From</Label>
                <Input type="date" value={exportFilters.from}
                  onChange={(e) => setExportFilters({ ...exportFilters, from: e.target.value })} /></div>
              <div><Label>To</Label>
                <Input type="date" value={exportFilters.to}
                  onChange={(e) => setExportFilters({ ...exportFilters, to: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>Cancel</Button>
            <AppButton analytics="admin_policy_exception_events_csv_download" action="submit" onClick={exportEvents} disabled={exporting}>
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
              Download CSV
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
