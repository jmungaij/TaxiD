/**
 * Remediation Review Modal — preview generated SQL, approve/reject per item,
 * export approved SQL, and apply approved SQL with confirmation + audit logging.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Download, Check, X, PlayCircle, Undo2, Loader2 } from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";

type Remediation = { resource: string; severity: string; sql: string };
type Approval = {
  id: string; resource: string; severity: string; sql_text: string;
  decision: string; run_id: string;
};
type Application = {
  id: string; approval_id: string; resource: string; severity: string;
  status: string; applied_at: string; rows_affected: number | null;
  error_message: string | null; rollback_sql: string | null;
};

const sevColor: Record<string, string> = {
  critical: "bg-status-danger text-ice",
  high: "bg-status-warning text-ice",
  medium: "bg-status-warning text-ink",
  low: "bg-ai text-ice",
};

async function hash(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function RemediationReviewModal({
  open, onOpenChange, runId, items,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  runId: string;
  items: Remediation[];
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(items.map((_, i) => i)));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmApply, setConfirmApply] = useState<{ approval: Approval; rollback: string; confirm: string; idem: string } | null>(null);
  const [bulkApply, setBulkApply] = useState<{ ids: string[]; confirm: string; idem: string } | null>(null);
  const [selectedApprovals, setSelectedApprovals] = useState<Set<string>>(new Set());
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [tab, setTab] = useState<"review" | "apply" | "history">("review");

  const approved = useMemo(
    () => items.filter((_, i) => selected.has(i)),
    [items, selected],
  );

  const loadApprovals = async () => {
    const { data: appr } = await supabase.from("paf_remediation_approvals")
      .select("id,resource,severity,sql_text,decision,run_id")
      .eq("run_id", runId).eq("decision", "approved");
    setApprovals((appr as Approval[]) ?? []);
    const ids = (appr ?? []).map((a: any) => a.id);
    if (ids.length) {
      const { data: apps } = await supabase.from("paf_remediation_applications")
        .select("id,approval_id,resource,severity,status,applied_at,rows_affected,error_message,rollback_sql")
        .in("approval_id", ids).order("applied_at", { ascending: false });
      setApplications((apps as Application[]) ?? []);
    } else setApplications([]);
  };

  useEffect(() => { if (open) loadApprovals(); }, [open, runId]);

  const toggle = (i: number) => {
    const n = new Set(selected);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    setSelected(n);
  };

  const recordDecisions = async (decision: "approved" | "rejected") => {
    setSubmitting(true);
    const { data: userRes } = await supabase.auth.getUser();
    const target = decision === "approved" ? approved : items.filter((_, i) => !selected.has(i));
    const rows = await Promise.all(target.map(async (r) => ({
      run_id: runId, resource: r.resource, severity: r.severity,
      sql_text: r.sql, sql_hash: await hash(r.sql),
      reviewed_by: userRes.user?.id ?? null,
      decision, decision_notes: notes || null,
      exported_at: decision === "approved" ? new Date().toISOString() : null,
    })));
    if (rows.length) {
      const { error } = await supabase.from("paf_remediation_approvals").insert(rows);
      if (error) { toast.error(error.message); setSubmitting(false); return false; }
    }
    setSubmitting(false);
    await loadApprovals();
    return true;
  };

  const exportApproved = async () => {
    if (approved.length === 0) { toast.error("Select at least one remediation"); return; }
    const ok = await recordDecisions("approved");
    if (!ok) return;
    const sql = approved.map((r) => `-- [${r.severity}] ${r.resource}\n${r.sql}`).join("\n\n");
    const blob = new Blob([`-- PAF remediation export\n-- Run: ${runId}\n\n${sql}\n`], { type: "text/sql" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `paf-remediation-${runId}.sql`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${approved.length} approved remediation(s)`);
  };

  const rejectRest = async () => {
    const ok = await recordDecisions("rejected");
    if (ok) toast.success("Recorded rejections");
  };

  const applyApproval = async () => {
    if (!confirmApply) return;
    if (confirmApply.confirm !== "APPLY") { toast.error('Type APPLY to confirm'); return; }
    if (!confirmApply.idem.trim()) { toast.error("Idempotency run ID is required"); return; }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("paf_apply_remediation", {
      _approval_id: confirmApply.approval.id,
      _confirmation: "APPLY",
      _notes: notes || null,
      _rollback_sql: confirmApply.rollback || null,
      _idempotency_key: confirmApply.idem,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    const res = data as { ok: boolean; error?: string; rows_affected?: number; idempotent_replay?: boolean };
    if (res.idempotent_replay) toast.info(`Idempotent replay — returned prior result (${res.rows_affected ?? 0} rows)`);
    else if (res.ok) toast.success(`Applied — ${res.rows_affected ?? 0} row(s) affected`);
    else toast.error(`Apply failed: ${res.error ?? "unknown"}`);
    setConfirmApply(null);
    await loadApprovals();
  };

  const applyBulk = async () => {
    if (!bulkApply) return;
    if (bulkApply.confirm !== "APPLY") { toast.error('Type APPLY to confirm'); return; }
    if (!bulkApply.idem.trim()) { toast.error("Idempotency run ID is required"); return; }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("paf_apply_remediations_bulk", {
      _approval_ids: bulkApply.ids,
      _confirmation: "APPLY",
      _notes: notes || null,
      _idempotency_key: bulkApply.idem,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    const res = data as { ok: boolean; success: number; failed: number; batch_id: string; idempotent_replay?: boolean };
    if (res.idempotent_replay) toast.info(`Idempotent replay — batch ${res.batch_id.slice(0,8)}`);
    else toast.success(`Bulk applied — ${res.success} ok, ${res.failed} failed (batch ${res.batch_id.slice(0,8)})`);
    setBulkApply(null);
    setSelectedApprovals(new Set());
    await loadApprovals();
  };

  const rollback = async (appId: string) => {
    const confirm = window.prompt('Type ROLLBACK to confirm rollback:');
    if (confirm !== "ROLLBACK") return;
    const { data, error } = await supabase.rpc("paf_rollback_remediation", {
      _application_id: appId, _confirmation: "ROLLBACK",
    });
    if (error) { toast.error(error.message); return; }
    const res = data as { ok: boolean; error?: string };
    if (res.ok) toast.success("Rolled back successfully");
    else toast.error(`Rollback failed: ${res.error}`);
    await loadApprovals();
  };

  const appliedIds = new Set(applications.filter((a) => a.status === "success").map((a) => a.approval_id));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Remediation Review — {items.length} statement(s)</DialogTitle>
            <DialogDescription>Review, approve, export, and apply generated SQL. Every action is audit-logged.</DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 border-b">
            {(["review","apply","history"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-2 text-sm capitalize ${tab === t ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}>
                {t === "apply" ? `Apply approved (${approvals.length})` : t === "history" ? `History (${applications.length})` : "Review"}
              </button>
            ))}
          </div>

          {tab === "review" && (
            <>
              <ScrollArea className="h-[420px] border rounded">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 w-8"></th>
                      <th className="p-2 text-left">Severity</th>
                      <th className="p-2 text-left">Resource</th>
                      <th className="p-2 text-left">SQL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r, i) => (
                      <tr key={i} className="border-b align-top hover:bg-muted/40">
                        <td className="p-2"><Checkbox checked={selected.has(i)} onCheckedChange={() => toggle(i)} /></td>
                        <td className="p-2"><Badge className={sevColor[r.severity]}>{r.severity}</Badge></td>
                        <td className="p-2 font-mono text-xs">{r.resource}</td>
                        <td className="p-2"><pre className="text-xs bg-muted-foreground text-muted-foreground p-2 rounded overflow-auto">{r.sql}</pre></td>
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No remediation needed.</td></tr>
                    )}
                  </tbody>
                </table>
              </ScrollArea>
              <Textarea placeholder="Reviewer notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              <DialogFooter className="flex flex-wrap gap-2">
                <div className="text-xs text-muted-foreground mr-auto self-center">
                  {selected.size} approved · {items.length - selected.size} to reject
                </div>
                <Button variant="outline" onClick={rejectRest} disabled={submitting || selected.size === items.length}>
                  <X className="mr-2 h-4 w-4" /> Record rejections
                </Button>
                <Button data-analytics="remediationreviewmodal.export" onClick={exportApproved} disabled={submitting || approved.length === 0}>
                  <Check className="mr-2 h-4 w-4" /><Download className="mr-2 h-4 w-4" /> Approve & export
                </Button>
              </DialogFooter>
            </>
          )}

          {tab === "apply" && (
            <>
              <div className="flex items-center justify-between p-2 border rounded bg-muted/40">
                <div className="text-sm">
                  <strong>{selectedApprovals.size}</strong> selected for bulk apply
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline"
                    onClick={() => setSelectedApprovals(new Set(approvals.filter((a) => !appliedIds.has(a.id)).map((a) => a.id)))}>
                    Select all pending
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSelectedApprovals(new Set())}>
                    Clear
                  </Button>
                  <AppButton analytics="admin_remediation_bulk_apply_dialog_open" action="dialog" size="sm" disabled={selectedApprovals.size === 0}
                    onClick={() => setBulkApply({
                      ids: Array.from(selectedApprovals),
                      confirm: "", idem: `bulk-${crypto.randomUUID()}`,
                    })}>
                    <PlayCircle className="mr-1 h-3 w-3" /> Bulk apply ({selectedApprovals.size})
                  </AppButton>
                </div>
              </div>
              <ScrollArea className="h-[460px] border rounded mt-2">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0"><tr>
                    <th className="p-2 w-8"></th>
                    <th className="p-2 text-left">Severity</th><th className="p-2 text-left">Resource</th>
                    <th className="p-2 text-left">SQL</th><th className="p-2 text-left">Status</th><th className="p-2"></th>
                  </tr></thead>
                  <tbody>
                    {approvals.map((a) => {
                      const applied = appliedIds.has(a.id);
                      const checked = selectedApprovals.has(a.id);
                      return (
                        <tr key={a.id} className="border-b align-top">
                          <td className="p-2">
                            {!applied && (
                              <Checkbox checked={checked} onCheckedChange={() => {
                                const n = new Set(selectedApprovals);
                                if (n.has(a.id)) n.delete(a.id);
                                else n.add(a.id);
                                setSelectedApprovals(n);
                              }} />
                            )}
                          </td>
                          <td className="p-2"><Badge className={sevColor[a.severity]}>{a.severity}</Badge></td>
                          <td className="p-2 font-mono text-xs">{a.resource}</td>
                          <td className="p-2"><pre className="text-xs bg-muted-foreground text-muted-foreground p-2 rounded overflow-auto max-w-md">{a.sql_text}</pre></td>
                          <td className="p-2">{applied ? <Badge className="bg-status-success text-ice">Applied</Badge> : <Badge variant="outline">Pending</Badge>}</td>
                          <td className="p-2">
                            {!applied && (
                              <AppButton analytics="admin_remediation_apply_dialog_open" action="dialog" size="sm" onClick={() => setConfirmApply({
                                approval: a, rollback: "", confirm: "",
                                idem: `apply-${a.id}-${Date.now()}`,
                              })}>
                                <PlayCircle className="mr-1 h-3 w-3" /> Apply
                              </AppButton>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {approvals.length === 0 && (
                      <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No approved remediations yet. Approve items on the Review tab first.</td></tr>
                    )}
                  </tbody>
                </table>
              </ScrollArea>
            </>
          )}

          {tab === "history" && (
            <ScrollArea className="h-[500px] border rounded">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0"><tr>
                  <th className="p-2 text-left">When</th><th className="p-2 text-left">Resource</th>
                  <th className="p-2 text-left">Status</th><th className="p-2 text-left">Rows</th>
                  <th className="p-2 text-left">Error</th><th className="p-2"></th>
                </tr></thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.id} className="border-b align-top">
                      <td className="p-2 text-xs">{new Date(a.applied_at).toLocaleString()}</td>
                      <td className="p-2 font-mono text-xs">{a.resource}</td>
                      <td className="p-2"><Badge className={a.status === "success" ? "bg-status-success text-ice" : a.status === "rolled_back" ? "bg-muted-foreground text-ice" : "bg-status-danger text-ice"}>{a.status}</Badge></td>
                      <td className="p-2 text-xs">{a.rows_affected ?? "—"}</td>
                      <td className="p-2 text-xs text-status-danger">{a.error_message ?? "—"}</td>
                      <td className="p-2">
                        {a.status === "success" && a.rollback_sql && (
                          <Button size="sm" variant="outline" onClick={() => rollback(a.id)}>
                            <Undo2 className="mr-1 h-3 w-3" /> Rollback
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {applications.length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No application history yet.</td></tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm apply modal */}
      <Dialog open={!!confirmApply} onOpenChange={(v) => !v && setConfirmApply(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-status-danger">Confirm apply — production change</DialogTitle>
            <DialogDescription>This executes the approved SQL against the live database. The idempotency key prevents duplicate execution if you retry the same request.</DialogDescription>
          </DialogHeader>
          {confirmApply && (
            <>
              <pre className="text-xs bg-muted-foreground text-muted-foreground p-3 rounded overflow-auto max-h-40">{confirmApply.approval.sql_text}</pre>
              <div>
                <label className="text-xs font-medium">Idempotency run ID (auto-generated, editable)</label>
                <Input value={confirmApply.idem}
                  onChange={(e) => setConfirmApply({ ...confirmApply, idem: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium">Rollback SQL (optional but recommended)</label>
                <Textarea rows={3} placeholder="-- inverse statement" value={confirmApply.rollback}
                  onChange={(e) => setConfirmApply({ ...confirmApply, rollback: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium">Type <code className="bg-muted px-1">APPLY</code> to confirm</label>
                <Input value={confirmApply.confirm} onChange={(e) => setConfirmApply({ ...confirmApply, confirm: e.target.value })} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmApply(null)}>Cancel</Button>
                <AppButton analytics="admin_remediation_apply_approved_fix" action="submit" variant="destructive" onClick={applyApproval} disabled={submitting || confirmApply.confirm !== "APPLY"}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Apply now
                </AppButton>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk apply confirm modal */}
      <Dialog open={!!bulkApply} onOpenChange={(v) => !v && setBulkApply(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-status-danger">Bulk apply — {bulkApply?.ids.length} remediation(s)</DialogTitle>
            <DialogDescription>All selected items execute in one transactional call. A single grouped audit entry is recorded. Idempotent — replaying with the same key returns the prior batch.</DialogDescription>
          </DialogHeader>
          {bulkApply && (
            <>
              <div>
                <label className="text-xs font-medium">Idempotency run ID</label>
                <Input value={bulkApply.idem}
                  onChange={(e) => setBulkApply({ ...bulkApply, idem: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium">Type <code className="bg-muted px-1">APPLY</code> to confirm</label>
                <Input value={bulkApply.confirm}
                  onChange={(e) => setBulkApply({ ...bulkApply, confirm: e.target.value })} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBulkApply(null)}>Cancel</Button>
                <AppButton analytics="admin_remediation_apply_bulk_fixes" action="submit" variant="destructive" onClick={applyBulk} disabled={submitting || bulkApply.confirm !== "APPLY"}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Apply {bulkApply.ids.length}
                </AppButton>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
