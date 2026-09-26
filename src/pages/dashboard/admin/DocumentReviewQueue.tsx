import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  FileCheck, CheckCircle2, XCircle, AlertTriangle, Clock, Search, Filter,
  Upload, MessageSquare, ShieldAlert, RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

type QueueRow = {
  id: string;
  driver_id: string | null;
  document_type: string;
  kyc_stage: string;
  status: string;
  priority: string;
  file_url: string | null;
  assigned_to: string | null;
  submitted_at: string;
  decided_at: string | null;
  decision_reason: string | null;
};

const STAGES = ["all","initial","enhanced","renewal","periodic_review","reverification"] as const;
const STATUSES = [
  "all","draft","submitted","pending_review","under_investigation",
  "approved","rejected","expired","suspended","fraud_review","resubmission_required",
] as const;
const DOC_TYPES = [
  "national_id","driving_licence","good_conduct","ntsa_psv_badge","psv_licence",
  "insurance","vehicle_inspection","driver_photo","kra_pin","medical_exam",
];

const STATUS_COLOR: Record<string, string> = {
  submitted: "bg-ai/15 text-ai dark:text-ai",
  pending_review: "bg-status-warning/15 text-status-warning dark:text-status-warning",
  under_investigation: "bg-ai/15 text-ai dark:text-ai",
  approved: "bg-status-success/15 text-status-success dark:text-status-success",
  rejected: "bg-status-danger/15 text-status-danger dark:text-status-danger",
  expired: "bg-muted text-muted-foreground",
  suspended: "bg-status-danger/15 text-status-danger dark:text-status-danger",
  fraud_review: "bg-ai/20 text-ai dark:text-ai",
  resubmission_required: "bg-status-warning/15 text-status-warning dark:text-status-warning",
  draft: "bg-muted text-muted-foreground",
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: "bg-status-danger/20 text-status-danger dark:text-status-danger",
  high: "bg-status-warning/15 text-status-warning dark:text-status-warning",
  normal: "bg-muted text-muted-foreground",
  low: "bg-muted text-muted-foreground",
};

export default function DocumentReviewQueue() {
  const { user } = useAuth();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<string>("all");
  const [status, setStatus] = useState<string>("pending_review");
  const [docType, setDocType] = useState<string>("all");
  const [selected, setSelected] = useState<QueueRow | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");

  // Upload dialog
  const [openUpload, setOpenUpload] = useState(false);
  const [uDriverId, setUDriverId] = useState("");
  const [uDocType, setUDocType] = useState(DOC_TYPES[0]);
  const [uStage, setUStage] = useState("initial");
  const [uPriority, setUPriority] = useState("normal");
  const [uFileUrl, setUFileUrl] = useState("");

  useEffect(() => { void load(); }, [stage, status, docType]);

  async function load() {
    setLoading(true);
    const sb = supabase as never as {
      from: (n: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => unknown;
          order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: QueueRow[] | null; error: { message: string } | null }> };
        };
      };
    };
    let chain: unknown = sb.from("document_review_queue").select("*");
    if (stage !== "all") chain = (chain as { eq: (c: string, v: string) => unknown }).eq("kyc_stage", stage);
    if (status !== "all") chain = (chain as { eq: (c: string, v: string) => unknown }).eq("status", status);
    if (docType !== "all") chain = (chain as { eq: (c: string, v: string) => unknown }).eq("document_type", docType);
    const res = await (chain as {
      order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: QueueRow[] | null; error: { message: string } | null }> };
    }).order("submitted_at", { ascending: false }).limit(200);
    if (res.error) { toast.error(res.error.message); setLoading(false); return; }
    setRows((res.data ?? []) as QueueRow[]);
    setLoading(false);
  }

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, fraud: 0, total: rows.length };
    for (const r of rows) {
      if (r.status === "pending_review" || r.status === "submitted") c.pending++;
      else if (r.status === "approved") c.approved++;
      else if (r.status === "rejected") c.rejected++;
      else if (r.status === "fraud_review" || r.status === "under_investigation") c.fraud++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const needle = q.toLowerCase();
    return rows.filter(r =>
      (r.driver_id ?? "").toLowerCase().includes(needle) ||
      r.document_type.toLowerCase().includes(needle) ||
      r.kyc_stage.toLowerCase().includes(needle)
    );
  }, [rows, q]);

  async function logAction(queue_id: string, action_type: string, payload: Record<string, unknown> = {}, reasonText?: string) {
    await (supabase as never as { from: (n: string) => { insert: (v: unknown) => Promise<{ error: { message: string } | null }> } })
      .from("document_review_actions")
      .insert({ queue_id, action_type, actor_id: user?.id ?? null, payload, reason: reasonText ?? null });
  }

  async function setRowStatus(row: QueueRow, newStatus: string, reasonText?: string) {
    const patch: Record<string, unknown> = {
      status: newStatus,
      decided_at: ["approved","rejected","expired","suspended","resubmission_required"].includes(newStatus) ? new Date().toISOString() : null,
      decided_by: user?.id ?? null,
      decision_reason: reasonText ?? null,
    };
    const { error } = await (supabase as never as { from: (n: string) => { update: (v: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } } })
      .from("document_review_queue")
      .update(patch)
      .eq("id", row.id);
    if (error) return toast.error(error.message);
    await logAction(row.id, newStatus === "approved" ? "approve" : newStatus === "rejected" ? "reject" : newStatus === "resubmission_required" ? "request_resubmission" : "note", { status: newStatus }, reasonText);
    toast.success(`Marked ${newStatus}`);
    void load();
    setSelected(null);
    setReason("");
  }

  async function assignToMe(row: QueueRow) {
    if (!user) return;
    const { error } = await (supabase as never as { from: (n: string) => { update: (v: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } } })
      .from("document_review_queue")
      .update({ assigned_to: user.id, assigned_at: new Date().toISOString(), status: "pending_review" })
      .eq("id", row.id);
    if (error) return toast.error(error.message);
    await logAction(row.id, "assign", { assigned_to: user.id });
    toast.success("Assigned to you");
    void load();
  }

  async function escalate(row: QueueRow) {
    const { error } = await (supabase as never as { from: (n: string) => { insert: (v: unknown) => Promise<{ error: { message: string } | null }> } })
      .from("document_escalations")
      .insert({ queue_id: row.id, opened_by: user?.id ?? null, severity: "high", reason: reason || "Manual escalation" });
    if (error) return toast.error(error.message);
    await (supabase as never as { from: (n: string) => { update: (v: unknown) => { eq: (c: string, v: string) => Promise<unknown> } } })
      .from("document_review_queue")
      .update({ status: "under_investigation" })
      .eq("id", row.id);
    await logAction(row.id, "escalate", {}, reason);
    toast.success("Escalated");
    setReason("");
    setSelected(null);
    void load();
  }

  async function addNote(row: QueueRow) {
    if (!note.trim()) return;
    const { error } = await (supabase as never as { from: (n: string) => { insert: (v: unknown) => Promise<{ error: { message: string } | null }> } })
      .from("document_review_notes")
      .insert({ queue_id: row.id, author_id: user?.id ?? null, body: note.trim() });
    if (error) return toast.error(error.message);
    await logAction(row.id, "note", {}, note.trim());
    toast.success("Note added");
    setNote("");
  }

  async function submitUpload() {
    if (!uDriverId || !uFileUrl) return toast.error("Driver ID and file URL are required");
    const { error } = await (supabase as never as { from: (n: string) => { insert: (v: unknown) => Promise<{ error: { message: string } | null }> } })
      .from("document_review_queue")
      .insert({
        driver_id: uDriverId,
        document_type: uDocType,
        kyc_stage: uStage,
        priority: uPriority,
        file_url: uFileUrl,
        status: "submitted",
      });
    if (error) return toast.error(error.message);
    toast.success("Document queued for review");
    setOpenUpload(false);
    setUDriverId(""); setUFileUrl("");
    void load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileCheck className="h-6 w-6 text-primary" /> Driver Center · Compliance Operations
          </h1>
          <p className="text-sm text-muted-foreground">
            Append-only KYC workflow. Every approval, rejection, escalation, and resubmission writes an
            immutable audit row linked to the hash-chain.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => load()}><RefreshCcw className="h-4 w-4 mr-1" /> Refresh</Button>
          <Dialog open={openUpload} onOpenChange={setOpenUpload}>
            <DialogTrigger asChild><Button><Upload className="h-4 w-4 mr-1" /> Upload Document</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Queue a new driver document</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Driver ID (UUID)</Label><Input value={uDriverId} onChange={(e) => setUDriverId(e.target.value)} placeholder="driver row id" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Document type</Label>
                    <Select value={uDocType} onValueChange={setUDocType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>KYC stage</Label>
                    <Select value={uStage} onValueChange={setUStage}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{STAGES.filter(s => s !== "all").map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Priority</Label>
                  <Select value={uPriority} onValueChange={setUPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["low","normal","high","critical"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>File URL</Label><Input value={uFileUrl} onChange={(e) => setUFileUrl(e.target.value)} placeholder="https://..." /></div>
                <Button onClick={submitUpload}>Queue for review</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi icon={Clock} label="Pending" value={counts.pending} tone="amber" />
        <Kpi icon={CheckCircle2} label="Approved" value={counts.approved} tone="emerald" />
        <Kpi icon={XCircle} label="Rejected" value={counts.rejected} tone="rose" />
        <Kpi icon={ShieldAlert} label="Fraud / Investigation" value={counts.fraud} tone="purple" />
        <Kpi icon={FileCheck} label="Loaded" value={counts.total} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search driver id, type, stage" className="pl-8" />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="KYC stage" /></SelectTrigger>
                <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s}>{s === "all" ? "All stages" : s}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Doc type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
                {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nothing in this view.</TableCell></TableRow>}
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.submitted_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{r.driver_id?.slice(0, 8) ?? "—"}</TableCell>
                    <TableCell><div className="text-sm">{r.document_type}</div>{r.file_url && <a href={r.file_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">view file</a>}</TableCell>
                    <TableCell><Badge variant="outline">{r.kyc_stage}</Badge></TableCell>
                    <TableCell><Badge className={STATUS_COLOR[r.status] ?? "bg-muted"}>{r.status}</Badge></TableCell>
                    <TableCell><Badge className={PRIORITY_COLOR[r.priority] ?? "bg-muted"}>{r.priority}</Badge></TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => assignToMe(r)}>Take</Button>
                      <Button size="sm" variant="outline" onClick={() => setSelected(r)}>Review</Button>
                      <Button size="sm" onClick={() => setRowStatus(r, "approved")}>
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Review document</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-xs text-muted-foreground">Driver</div><div className="font-mono text-xs">{selected.driver_id}</div></div>
                <div><div className="text-xs text-muted-foreground">Document</div><div>{selected.document_type}</div></div>
                <div><div className="text-xs text-muted-foreground">Stage</div><div>{selected.kyc_stage}</div></div>
                <div><div className="text-xs text-muted-foreground">Status</div><Badge className={STATUS_COLOR[selected.status]}>{selected.status}</Badge></div>
              </div>
              {selected.file_url && (
                <a href={selected.file_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">Open document file</a>
              )}
              <div>
                <Label className="text-xs">Decision reason / note</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why approving / rejecting / escalating?" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setRowStatus(selected, "approved", reason)}><CheckCircle2 className="h-4 w-4 mr-1" /> Approve</Button>
                <Button variant="outline" onClick={() => setRowStatus(selected, "rejected", reason)}><XCircle className="h-4 w-4 mr-1" /> Reject</Button>
                <Button variant="outline" onClick={() => setRowStatus(selected, "resubmission_required", reason)}>Request resubmission</Button>
                <Button variant="outline" onClick={() => escalate(selected)}><AlertTriangle className="h-4 w-4 mr-1" /> Escalate</Button>
              </div>
              <div className="border-t pt-3 space-y-2">
                <Label className="text-xs flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Add internal note</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal-only note" />
                <Button size="sm" variant="secondary" onClick={() => addNote(selected)}>Add note</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: typeof FileCheck; label: string; value: number; tone?: string }) {
  const cls =
    tone === "emerald" ? "text-status-success" :
    tone === "amber" ? "text-status-warning" :
    tone === "rose" ? "text-status-danger" :
    tone === "purple" ? "text-ai" : "text-primary";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${cls}`} />
        </div>
        <div className="text-2xl font-bold mt-1">{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}
