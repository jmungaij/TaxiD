import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Gavel, ShieldAlert, CheckCircle2, RotateCcw, UserCheck,
  Upload, FileText, Download, Snowflake, Sun,
} from "lucide-react";
import { toast } from "sonner";
import { AppButton } from "@/components/nav/AppButton";

type Recon = {
  id: string;
  corp_reference: string;
  proof_reference: string | null;
  mpesa_receipt: string | null;
  expected_amount_cents: number;
  proof_amount_cents: number | null;
  wallet_amount_cents: number | null;
  cash_ledger_amount_cents: number | null;
  amount_difference_cents: number;
  reconciliation_status: string;
  mismatch_reason: string | null;
  severity: string;
  confidence_score: number;
  duplicate_receipt: boolean;
  created_at: string;
  corporate_id: string | null;
};

type CaseRow = {
  id: string;
  case_number: string;
  status: string;
  severity: string;
  assigned_to: string | null;
  escalation_level: number;
  resolution_notes: string | null;
  reversed: boolean;
  created_at: string;
};

type Activity = {
  id: string;
  action_type: string;
  previous_status: string | null;
  new_status: string | null;
  note: string | null;
  actor_email: string | null;
  created_at: string;
};

const KES = (c: number | null | undefined) =>
  c == null ? "—" : `KES ${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

type Evidence = {
  id: string; file_name: string; storage_path: string; mime_type: string | null;
  file_size: number | null; version: number; description: string | null;
  uploaded_by_email: string | null; created_at: string;
};
type Freeze = {
  id: string; freeze_type: string; reason: string; active: boolean;
  created_at: string; released_at: string | null; initiated_by_system: boolean;
};

export default function ReconciliationCase() {
  const { id } = useParams<{ id: string }>();
  const [recon, setRecon] = useState<Recon | null>(null);
  const [caseRow, setCaseRow] = useState<CaseRow | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [resolutionNote, setResolutionNote] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [freezes, setFreezes] = useState<Freeze[]>([]);
  const [evidenceDesc, setEvidenceDesc] = useState("");
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function exportPackage() {
    if (!caseRow) return;
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-reconciliation-package", {
        body: { case_id: caseRow.id },
      });
      if (error) throw error;
      const { filename, zip_base64, sha256, byte_size } = data as {
        filename: string; zip_base64: string; sha256: string; byte_size: number;
      };
      const bin = atob(zip_base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${filename} (${(byte_size / 1024).toFixed(1)} KB)`, {
        description: `SHA-256: ${sha256.slice(0, 24)}…`,
      });
      void load();
    } catch (e) {
      toast.error("Export failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
    }
  }

  async function load() {
    if (!id) return;
    const { data: r } = await supabase
      .from("corporate_financial_reconciliation").select("*").eq("id", id).maybeSingle();
    setRecon(r as Recon | null);
    const { data: c } = await supabase
      .from("reconciliation_cases").select("*").eq("reconciliation_id", id).maybeSingle();
    setCaseRow(c as CaseRow | null);
    if (c) {
      const { data: acts } = await supabase
        .from("reconciliation_case_activities").select("*").eq("case_id", c.id).order("created_at", { ascending: false });
      setActivities((acts ?? []) as Activity[]);
      const { data: ev } = await supabase
        .from("reconciliation_evidence").select("*").eq("case_id", c.id).is("deleted_at", null).order("created_at", { ascending: false });
      setEvidence((ev ?? []) as Evidence[]);
    }
    if (r?.corporate_id) {
      const { data: fz } = await supabase
        .from("wallet_freezes").select("*").eq("corporate_id", r.corporate_id).order("created_at", { ascending: false }).limit(10);
      setFreezes((fz ?? []) as Freeze[]);
    }
  }
  useEffect(() => { void load(); }, [id]);

  // Realtime per case
  useEffect(() => {
    if (!id) return;
    const ch = supabase.channel(`case-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "reconciliation_case_activities" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "reconciliation_evidence" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_freezes" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  async function logActivity(action_type: string, payload: Partial<Activity> & { metadata?: Record<string, unknown> } = {}) {
    if (!caseRow) return;
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("reconciliation_case_activities").insert({
      case_id: caseRow.id,
      actor: u.user?.id ?? null,
      actor_email: u.user?.email ?? null,
      action_type,
      previous_status: payload.previous_status ?? caseRow.status,
      new_status: payload.new_status ?? null,
      note: payload.note ?? null,
      metadata: (payload.metadata ?? {}) as never,
    });
  }

  async function assignToMe() {
    if (!caseRow) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase.from("reconciliation_cases").update({
      assigned_to: u.user.id, status: "IN_PROGRESS",
    }).eq("id", caseRow.id);
    await logActivity("assigned", { new_status: "IN_PROGRESS", note: "Assigned to " + (u.user.email ?? "self") });
    toast.success("Case assigned");
    void load();
  }

  async function escalate() {
    if (!caseRow) return;
    await supabase.from("reconciliation_cases").update({
      status: "ESCALATED",
      escalation_level: caseRow.escalation_level + 1,
    }).eq("id", caseRow.id);
    await logActivity("escalated", { new_status: "ESCALATED", note: `Escalation level ${caseRow.escalation_level + 1}` });
    toast.success("Case escalated");
    void load();
  }

  async function resolve() {
    if (!caseRow || !resolutionNote.trim()) {
      toast.error("Resolution note required");
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("reconciliation_cases").update({
      status: "RESOLVED",
      resolved_by: u.user?.id ?? null,
      resolved_at: new Date().toISOString(),
      resolution_notes: resolutionNote,
    }).eq("id", caseRow.id);
    await logActivity("resolved", { new_status: "RESOLVED", note: resolutionNote });
    toast.success("Case resolved");
    setResolutionNote("");
    void load();
  }

  async function reverse() {
    if (!caseRow) return;
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("reconciliation_cases").update({
      status: "REVERSED",
      reversed: true,
      reversed_at: new Date().toISOString(),
      reversed_by: u.user?.id ?? null,
    }).eq("id", caseRow.id);
    await logActivity("reversed", { new_status: "REVERSED", note: "Posting reversed" });
    toast.success("Case reversed");
    void load();
  }

  // ============== Evidence upload ==============
  async function handleUploadEvidence(file: File) {
    if (!recon || !caseRow) {
      toast.error("Case must exist before uploading evidence");
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    const ts = Date.now();
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `cases/${caseRow.id}/${ts}_${safe}`;

    // Compute checksum
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const checksum = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

    const { error: upErr } = await supabase.storage.from("reconciliation-evidence").upload(path, file, {
      contentType: file.type, upsert: false,
    });
    if (upErr) { toast.error("Upload failed: " + upErr.message); return; }

    // Version = previous max + 1 for same file_name in this case
    const { data: prev } = await supabase
      .from("reconciliation_evidence").select("version")
      .eq("case_id", caseRow.id).eq("file_name", file.name)
      .order("version", { ascending: false }).limit(1);
    const nextVersion = ((prev?.[0]?.version as number | undefined) ?? 0) + 1;

    const { error: insErr } = await supabase.from("reconciliation_evidence").insert({
      case_id: caseRow.id,
      reconciliation_id: recon.id,
      corporate_id: recon.corporate_id ?? null,
      file_name: file.name,
      storage_path: path,
      file_type: file.type.split("/")[0] || "file",
      mime_type: file.type || null,
      file_size: file.size,
      uploaded_by: u.user?.id ?? null,
      uploaded_by_email: u.user?.email ?? null,
      description: evidenceDesc || null,
      version: nextVersion,
      checksum,
    });
    if (insErr) { toast.error(insErr.message); return; }
    await logActivity("evidence_uploaded", { note: `${file.name} v${nextVersion}` });
    setEvidenceDesc("");
    toast.success(`Uploaded ${file.name} (v${nextVersion})`);
    void load();
  }

  async function downloadEvidence(e: Evidence) {
    const { data, error } = await supabase.storage.from("reconciliation-evidence")
      .createSignedUrl(e.storage_path, 300);
    if (error || !data?.signedUrl) { toast.error("Download link failed"); return; }
    window.open(data.signedUrl, "_blank");
    await logActivity("evidence_downloaded", { note: e.file_name });
  }

  // ============== Wallet freeze controls ==============
  const activeFreeze = freezes.find((f) => f.active);

  async function manualFreeze() {
    if (!recon?.corporate_id) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("wallet_freezes").insert({
      corporate_id: recon.corporate_id,
      reconciliation_id: recon.id,
      case_id: caseRow?.id ?? null,
      reason: "Manual freeze by admin",
      freeze_type: "WITHDRAWAL_ONLY",
      initiated_by: u.user?.id ?? null,
      initiated_by_system: false,
      active: true,
    });
    if (error) { toast.error(error.message); return; }
    await logActivity("wallet_frozen", { note: "Manual freeze" });
    toast.success("Wallet frozen");
    void load();
  }

  async function releaseFreeze(f: Freeze) {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("wallet_freezes").update({
      active: false,
      released_at: new Date().toISOString(),
      released_by: u.user?.id ?? null,
      release_reason: "Released after review",
    }).eq("id", f.id);
    if (error) { toast.error(error.message); return; }
    await logActivity("wallet_unfrozen", { note: `Released ${f.freeze_type}` });
    toast.success("Wallet released");
    void load();
  }


  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/dashboard/admin/reconciliation"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
        </Button>
        <h1 className="text-xl font-bold font-mono">{recon.proof_reference ?? recon.corp_reference}</h1>
        <Badge variant="outline">{recon.reconciliation_status}</Badge>
        <Badge variant="outline">{recon.severity}</Badge>
        {recon.duplicate_receipt && <Badge variant="destructive"><ShieldAlert className="h-3 w-3 mr-1" />Duplicate M-Pesa</Badge>}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h2 className="font-semibold mb-3">Financial snapshot</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted-foreground">M-Pesa receipt</dt><dd className="font-mono">{recon.mpesa_receipt ?? "—"}</dd>
            <dt className="text-muted-foreground">Expected</dt><dd>{KES(recon.expected_amount_cents)}</dd>
            <dt className="text-muted-foreground">Proof</dt><dd>{KES(recon.proof_amount_cents)}</dd>
            <dt className="text-muted-foreground">Wallet</dt><dd>{KES(recon.wallet_amount_cents)}</dd>
            <dt className="text-muted-foreground">Ledger</dt><dd>{KES(recon.cash_ledger_amount_cents)}</dd>
            <dt className="text-muted-foreground font-semibold">Difference</dt>
            <dd className="font-semibold">{KES(recon.amount_difference_cents)}</dd>
            <dt className="text-muted-foreground">Confidence</dt><dd>{recon.confidence_score}%</dd>
            <dt className="text-muted-foreground">Reason</dt><dd>{recon.mismatch_reason ?? "—"}</dd>
          </dl>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold mb-3">Case</h2>
          {!caseRow ? (
            <p className="text-sm text-muted-foreground">No case opened (RECONCILED outcome).</p>
          ) : (
            <>
              <div className="text-sm space-y-1 mb-4">
                <div><span className="text-muted-foreground">Case #:</span> <span className="font-mono">{caseRow.case_number}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline">{caseRow.status}</Badge></div>
                <div><span className="text-muted-foreground">Escalation level:</span> {caseRow.escalation_level}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={assignToMe}><UserCheck className="h-4 w-4 mr-1" />Assign to me</Button>
                <Button size="sm" variant="outline" onClick={escalate}><Gavel className="h-4 w-4 mr-1" />Escalate</Button>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="default"><CheckCircle2 className="h-4 w-4 mr-1" />Resolve</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Resolve case {caseRow.case_number}</DialogTitle></DialogHeader>
                    <Textarea placeholder="Resolution notes (required)" value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} />
                    <DialogFooter><Button onClick={resolve}>Confirm resolve</Button></DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button size="sm" variant="destructive" onClick={reverse}><RotateCcw className="h-4 w-4 mr-1" />Reverse</Button>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Wallet freeze panel */}
      {recon.corporate_id && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Snowflake className="h-4 w-4 text-ai" />Wallet freeze controls
            </h2>
            {activeFreeze ? (
              <Button size="sm" variant="outline" onClick={() => releaseFreeze(activeFreeze)}>
                <Sun className="h-4 w-4 mr-1" />Release freeze
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={manualFreeze}>
                <Snowflake className="h-4 w-4 mr-1" />Freeze wallet
              </Button>
            )}
          </div>
          {freezes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No freezes on this corporate wallet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {freezes.map((f) => (
                <li key={f.id} className="flex items-center justify-between border rounded p-2">
                  <div>
                    <Badge variant={f.active ? "destructive" : "outline"} className="mr-2">
                      {f.active ? "ACTIVE" : "RELEASED"}
                    </Badge>
                    <span className="font-medium">{f.freeze_type}</span>
                    <span className="text-muted-foreground"> — {f.reason}</span>
                    {f.initiated_by_system && <Badge variant="outline" className="ml-2 text-xs">AUTO</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(f.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Evidence vault */}
      {caseRow && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />Evidence vault
              <Badge variant="outline" className="ml-1">{evidence.length}</Badge>
            </h2>
            <AppButton analytics="admin_reconciliation_evidence_package_download" action="submit" size="sm" variant="outline" onClick={exportPackage} disabled={exporting}>
              <Download className="h-4 w-4 mr-1" />{exporting ? "Building ZIP…" : "Export investigation package"}
            </AppButton>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <Input
              placeholder="Description (optional)"
              value={evidenceDesc}
              onChange={(e) => setEvidenceDesc(e.target.value)}
              className="flex-1 min-w-[200px]"
            />
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUploadEvidence(f);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <Button size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1" />Upload evidence
            </Button>
          </div>
          {evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">No evidence files attached yet.</p>
          ) : (
            <ul className="space-y-2">
              {evidence.map((e) => (
                <li key={e.id} className="flex items-center justify-between border rounded p-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {e.file_name} <Badge variant="outline" className="ml-1 text-xs">v{e.version}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {e.mime_type ?? "file"} • {e.file_size ? (e.file_size / 1024).toFixed(1) + " KB" : ""} •
                      uploaded by {e.uploaded_by_email ?? "—"} • {new Date(e.created_at).toLocaleString()}
                    </div>
                    {e.description && <div className="text-xs text-muted-foreground mt-0.5">{e.description}</div>}
                  </div>
                  <Button size="sm" variant="outline" data-analytics="admin.reconciliation_case.download_evidence" onClick={() => downloadEvidence(e)}>
                    <Download className="h-4 w-4 mr-1" />Download evidence
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}


      <Card className="p-4">
        <h2 className="font-semibold mb-3">Immutable activity timeline</h2>
        {activities.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
        <ol className="space-y-2">
          {activities.map((a) => (
            <li key={a.id} className="border-l-2 border-primary/40 pl-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold uppercase text-xs">{a.action_type}</span>
                {a.new_status && <Badge variant="outline" className="text-xs">{a.new_status}</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">{new Date(a.created_at).toLocaleString()}</span>
              </div>
              {a.note && <p className="text-muted-foreground mt-0.5">{a.note}</p>}
              <p className="text-xs text-muted-foreground">{a.actor_email ?? "system"}</p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
