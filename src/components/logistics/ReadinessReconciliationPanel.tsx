/**
 * CERTIFICATION RECONCILIATION PANEL.
 *
 * One authoritative projection, shown three ways:
 *  1. OLD STATE → NEW STATE reconciliation with evidence identity per control.
 *  2. The evidence register (approval state, approver, timestamps, expiry).
 *  3. The RPO/RTO business-target workflow for ST-12 / ST-13 — templates are
 *     offered as references, never pre-approved, and nothing here marks a
 *     control PASS: it writes a submission and an approval decision through the
 *     existing guarded RPCs, which the append-only audit trail records.
 */
import * as React from "react";
import { Download, FileCheck2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  reconcileReadiness,
  renderReconciliationMarkdown,
  RECOVERY_TARGET_TEMPLATES,
} from "@/lib/logistics/readiness/reconciliation";
import type { CommandCenterView } from "@/lib/logistics/readiness/execution";
import type { EvidenceRecord } from "@/lib/logistics/readiness/execution";
import type { EvidenceSubmission, ReadinessAuditRecord } from "@/hooks/useReadinessExecution";

const TONE: Record<string, string> = {
  PASS: "bg-status-success/15 text-status-success",
  VALID: "bg-status-success/15 text-status-success",
  FAIL: "bg-destructive/15 text-destructive",
  EXPIRED: "bg-destructive/10 text-destructive",
  INVALIDATED: "bg-destructive/10 text-destructive",
  BUSINESS_APPROVAL_REQUIRED: "bg-status-info/15 text-status-info",
};

function saveFile(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  view: CommandCenterView;
  evidence: EvidenceRecord[];
  audit: ReadinessAuditRecord[];
  onSubmitEvidence: (s: EvidenceSubmission) => Promise<void>;
  onDecide: (controlId: string, decision: "APPROVE" | "REJECT" | "REQUEST_REVISION", comments?: string) => Promise<void>;
}

export function ReadinessReconciliationPanel({ view, evidence, audit, onSubmitEvidence, onDecide }: Props) {
  const report = React.useMemo(() => reconcileReadiness(view), [view]);
  const [rpo, setRpo] = React.useState("");
  const [rto, setRto] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [approver, setApprover] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const applyTemplate = (rpoM: number, rtoM: number, label: string) => {
    setRpo(String(rpoM));
    setRto(String(rtoM));
    setNotes((n) => n || `Reference template: ${label}. Confirmed as SAFARID's business requirement by the accountable approver.`);
  };

  const submitTargets = async () => {
    const rpoM = Number(rpo);
    const rtoM = Number(rto);
    if (!Number.isFinite(rpoM) || rpoM <= 0 || !Number.isFinite(rtoM) || rtoM <= 0) {
      toast({ title: "Enter both targets", description: "RPO and RTO must be positive numbers of minutes.", variant: "destructive" });
      return;
    }
    if (!ref.trim() || !approver.trim()) {
      toast({ title: "Evidence reference and approver required", description: "Both are recorded in the audit trail.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      for (const [control, minutes] of [["ST-12", rpoM], ["ST-13", rtoM]] as const) {
        await onSubmitEvidence({
          control_id: control,
          remediation_class: "BUSINESS_TARGET_REQUIRED",
          evidence_ref: ref.trim(),
          approver_email: approver.trim(),
          owner_role: "operations",
          comments: notes.trim() || null,
          payload: {
            control,
            metric: control === "ST-12" ? "RPO" : "RTO",
            minutes,
            rpo_minutes: rpoM,
            rto_minutes: rtoM,
          },
        });
      }
      toast({ title: "Recovery targets submitted", description: "ST-12 and ST-13 are now pending authorised approval." });
    } catch (e) {
      toast({ title: "Submission refused", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const approve = async (control: string) => {
    setBusy(true);
    try {
      await onDecide(control, "APPROVE", notes.trim() || undefined);
      toast({ title: `${control} approved`, description: "Recorded in the append-only readiness audit trail." });
    } catch (e) {
      toast({ title: "Approval refused", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const recovery = evidence.filter((e) => e.control_id === "ST-12" || e.control_id === "ST-13");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Authoritative state after reconciliation</CardTitle>
          <Button size="sm" variant="outline" onClick={() => saveFile("yalla-certification-reconciliation.md", renderReconciliationMarkdown(report))}>
            <Download className="mr-2 h-4 w-4" aria-hidden /> Reconciliation report
          </Button>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(report.states).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k.replace(/([A-Z])/g, " $1")}</p>
              <p className="text-sm">{v}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">OLD STATE → NEW STATE ({report.transitions.length} transitions of {report.rows.length} controls)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {report.transitions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No control changed state: the projection already consumes the latest sealed evidence.
            </p>
          )}
          {report.transitions.map((t) => (
            <div key={t.control_id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold">{t.control_id}</span>
                <Badge variant="outline" className="text-[10px]">{t.previous_state.split("_").join(" ")}</Badge>
                <span aria-hidden>→</span>
                <Badge variant="secondary" className={TONE[t.current_state] ?? ""}>{t.current_state.split("_").join(" ")}</Badge>
                <Badge variant="outline" className={`text-[10px] ${TONE[t.evidence_validity] ?? ""}`}>{t.evidence_validity}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t.reason}</p>
              <p className="break-all text-[11px] text-muted-foreground">
                evidence {t.evidence_id ?? "—"} · executed {t.executed_at ?? "—"} · target identity {t.target_identity ?? "—"} · certificate {t.certificate_reference ?? "—"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Approve the recovery targets — ST-12 (RPO) &amp; ST-13 (RTO)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            These are business decisions. The templates below are references drawn from common recovery
            architectures — they are not SAFARID's targets until an accountable approver confirms them.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {RECOVERY_TARGET_TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => applyTemplate(t.rpo_minutes, t.rto_minutes, t.label)}
                className="rounded-lg border border-border p-3 text-left text-sm hover:bg-muted"
              >
                <span className="font-medium">{t.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{t.description}</span>
                <span className="mt-1 block text-xs font-semibold">RPO {t.rpo_minutes} min · RTO {t.rto_minutes} min</span>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="rpo">Approved RPO (minutes of committed data loss)</Label>
              <Input id="rpo" inputMode="numeric" value={rpo} onChange={(e) => setRpo(e.target.value)} placeholder="e.g. 15" />
            </div>
            <div>
              <Label htmlFor="rto">Approved RTO (minutes to restore service)</Label>
              <Input id="rto" inputMode="numeric" value={rto} onChange={(e) => setRto(e.target.value)} placeholder="e.g. 60" />
            </div>
            <div>
              <Label htmlFor="ref">Evidence reference (board/exec decision record)</Label>
              <Input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. EXCO-2026-08-DR-TARGETS" />
            </div>
            <div>
              <Label htmlFor="approver">Accountable approver email</Label>
              <Input id="approver" type="email" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="name@safarid.org" />
            </div>
          </div>
          <div>
            <Label htmlFor="notes">Basis of the decision</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={submitTargets} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <FileCheck2 className="mr-2 h-4 w-4" aria-hidden />}
              Submit RPO &amp; RTO for approval
            </Button>
            <Button size="sm" variant="outline" onClick={() => approve("ST-12")} disabled={busy}>Approve ST-12</Button>
            <Button size="sm" variant="outline" onClick={() => approve("ST-13")} disabled={busy}>Approve ST-13</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Submission and approval are separate acts and the register enforces who may perform each.
            Approval only clears the control once the database recovery measurement is executed against the
            approved target.
          </p>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current recovery-target records</p>
            {recovery.length === 0 && <p className="text-sm text-muted-foreground">No RPO/RTO record exists yet.</p>}
            {recovery.map((r) => (
              <div key={r.control_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-xs">
                <span className="font-mono font-semibold">{r.control_id}</span>
                <Badge variant="secondary" className={TONE[r.workflow_state] ?? ""}>{r.workflow_state.split("_").join(" ")}</Badge>
                <span>{r.evidence_ref ?? "no reference"}</span>
                <span className="text-muted-foreground">approver {r.approver_email ?? "—"} · decided {r.decided_at?.slice(0, 19).replace("T", " ") ?? "—"}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Evidence register ({evidence.length} entries)</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {evidence.length === 0 && <p className="text-sm text-muted-foreground">The evidence register is empty — no business approval has been recorded yet.</p>}
          {evidence.map((e) => (
            <div key={e.control_id} className="rounded-lg border border-border p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{e.control_id}</span>
                <Badge variant="secondary" className={TONE[e.workflow_state] ?? ""}>{e.workflow_state.split("_").join(" ")}</Badge>
                <span>{e.remediation_class.split("_").join(" ").toLowerCase()}</span>
              </div>
              <p className="text-muted-foreground">
                {e.evidence_ref ?? "no reference"} · approver {e.approver_email ?? "—"} · decided {e.decided_at?.slice(0, 19).replace("T", " ") ?? "—"} ·
                effective {e.effective_at?.slice(0, 10) ?? "—"} · expires {e.expiry_at?.slice(0, 10) ?? "—"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Approval audit trail (append-only)</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {audit.length === 0 && <p className="text-sm text-muted-foreground">No approval activity recorded yet.</p>}
          {audit.slice(0, 60).map((a, i) => (
            <div key={`${a.control_id}-${a.created_at}-${i}`} className="rounded-lg border border-border p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{a.control_id}</span>
                <Badge variant="outline" className="text-[10px]">{a.action.split("_").join(" ")}</Badge>
                <span className="text-muted-foreground">
                  {(a.from_state ?? "—").split("_").join(" ")} → {(a.to_state ?? "—").split("_").join(" ")}
                </span>
                <span className="text-muted-foreground">{a.actor_email ?? "actor recorded by id"} · {a.created_at.slice(0, 19).replace("T", " ")}</span>
              </div>
              {a.payload && Object.keys(a.payload).length > 0 && (
                <p className="break-all text-muted-foreground">values {JSON.stringify(a.payload)}</p>
              )}
              {a.comments && <p className="text-muted-foreground">{a.comments}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default ReadinessReconciliationPanel;
