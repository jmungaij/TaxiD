/**
 * LG LEGAL DOSSIER WORKSPACE — LG-01…LG-15 + LG-GOODS.
 *
 * Renders the Documents 360 legal dossier over the EXISTING readiness engine
 * and evidence register. It offers no PASS control: every row either downloads
 * the controlled draft for filing in Documents 360, or opens the existing
 * Resolve workflow prefilled with the dossier's non-fabricated metadata.
 */
import * as React from "react";
import { Download, FileText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { LgApprovalDialog } from "@/components/logistics/LgApprovalDialog";
import { LgApproverMatrixPanel } from "@/components/logistics/LgApproverMatrixPanel";
import { LegalControlStatusMatrix } from "@/components/logistics/LegalControlStatusMatrix";

import {
  LG_DOSSIER,
  LG_CORRESPONDENCE_EMAIL,
  LG_DRAFT_WATERMARK,
  lgDossierCsv,
  reconcileLgDossier,
  renderLgDraft,
  type LgControlEvidenceState,
  type LgDossierEntry,
} from "@/lib/logistics/legal";
import {
  dispatchLgNotifications,
  fetchLgApprovals,
  fetchLgAudit,
  fetchLgGate,
  fetchLgNotifications,
  lgChangeSummary,
  lgDraftFileName,
  lgRequiredApprovers,
  lgSpineGate,
  seedLgDossier,
  type LgApprovalRow,
  type LgAuditRow,
  type LgGateRow,
  type LgNotificationRow,
} from "@/lib/logistics/legal/dossierControl";

import type { CommandCenterView } from "@/lib/logistics/readiness/execution";

const STATE_TONE: Record<string, string> = {
  APPROVED_EVIDENCE_OF_RECORD: "bg-status-success/15 text-status-success",
  PENDING_APPROVAL: "bg-status-info/15 text-status-info",
  LEGAL_REVIEW_REQUIRED: "bg-status-warning/15 text-status-warning",
  INSURANCE_EVIDENCE_REQUIRED: "bg-status-warning/15 text-status-warning",
  EVIDENCE_REQUIRED: "bg-status-warning/15 text-status-warning",
  REGULATOR_ACTION_REQUIRED: "bg-status-info/15 text-status-info",
  OWNER_APPROVAL_REQUIRED: "bg-status-info/15 text-status-info",
};

const GATE_TONE: Record<string, string> = {
  EFFECTIVE: "bg-status-success/15 text-status-success",
  PENDING_EFFECTIVE: "bg-status-info/15 text-status-info",
  BLOCKED: "bg-status-warning/15 text-status-warning",
};

function download(name: string, body: string, mime: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function LegalDossierPanel({
  view,
  onResolve,
}: {
  view: CommandCenterView;
  onResolve: (controlId: string) => void;
}) {
  const states: LgControlEvidenceState[] = React.useMemo(
    () =>
      LG_DOSSIER.map((d) => {
        const control = view.controls.find((c) => c.control_id === d.control_id);
        const rec = control?.evidence_record ?? null;
        return {
          control_id: d.control_id,
          approved: control?.status === "PASS",
          hasEvidence: !!rec,
        };
      }),
    [view.controls],
  );

  const recon = React.useMemo(() => reconcileLgDossier(states), [states]);
  const stateOf = (entry: LgDossierEntry) => {
    const st = states.find((s) => s.control_id === entry.control_id);
    return st?.approved ? "APPROVED_EVIDENCE_OF_RECORD" : st?.hasEvidence ? "PENDING_APPROVAL" : entry.draft_state;
  };

  const { toast } = useToast();
  const [gate, setGate] = React.useState<LgGateRow[]>([]);
  const [approvals, setApprovals] = React.useState<LgApprovalRow[]>([]);
  const [audit, setAudit] = React.useState<LgAuditRow[]>([]);
  const [notices, setNotices] = React.useState<LgNotificationRow[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [approvalTarget, setApprovalTarget] = React.useState<LgGateRow | null>(null);

  const reload = React.useCallback(async () => {
    try {
      const [g, a, l, n] = await Promise.all([
        fetchLgGate(),
        fetchLgApprovals(),
        fetchLgAudit(),
        fetchLgNotifications(),
      ]);
      setGate(g);
      setApprovals(a);
      setAudit(l);
      setNotices(n);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "The legal dossier control layer could not be read.");
    }
  }, []);

  const sendNotices = async () => {
    setSending(true);
    try {
      const res = await dispatchLgNotifications();
      toast({
        title: "Stakeholder notifications dispatched",
        description: `${res.sent} sent, ${res.failed} failed, ${res.skipped} skipped (no mailbox on the account).`,
      });
      await reload();
    } catch (e) {
      toast({
        title: "Dispatch failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };


  React.useEffect(() => {
    void reload();
  }, [reload]);

  const seed = async () => {
    setBusy(true);
    try {
      const res = await seedLgDossier();
      toast(
        res.failed.length
          ? { title: "Seeding incomplete", description: `${res.seeded} filed, ${res.failed.length} refused: ${res.failed[0].error}`, variant: "destructive" }
          : { title: "Dossier filed in Documents 360", description: `${res.seeded} draft determinations filed as DRAFT / legal review required.` },
      );
      await reload();
    } catch (e) {
      toast({ title: "Seeding failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const bookingGate = React.useMemo(() => lgSpineGate("booking", gate), [gate]);
  const dispatchGate = React.useMemo(() => lgSpineGate("dispatch", gate), [gate]);
  const gateOf = (controlId: string) => gate.find((g) => g.control_id === controlId) ?? null;

  const stat = (label: string, value: number) => (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );

  const stageCard = (label: string, g: ReturnType<typeof lgSpineGate>) => (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <Badge variant="secondary" className={g.open ? GATE_TONE.EFFECTIVE : GATE_TONE.BLOCKED}>
          {g.open ? "OPEN" : "BLOCKED"}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {g.open
          ? "Every dossier determination is approved and effective."
          : `${g.blocking.length + g.unseeded.length} control(s) hold this stage closed${
              g.unseeded.length ? ` — ${g.unseeded.length} not yet filed` : ""
            }.`}
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Legal dossier reconciliation — Documents 360</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={seed} disabled={busy}>
              <ShieldCheck className="mr-1 h-4 w-4" aria-hidden />
              {busy ? "Filing…" : "File drafts into Documents 360"}
            </Button>
            <Button data-analytics="legal_dossier_export_csv"
              size="sm"
              variant="outline"
              onClick={() => download("yalla-lg-dossier.csv", lgDossierCsv(states), "text/csv")}
            >
              <Download className="mr-1 h-4 w-4" aria-hidden /> Export dossier
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {stat("Total controls", recon.totalControls)}
            {stat("Draft documents", recon.draftDocumentsAvailable)}
            {stat("Authoritative documents", recon.authoritativeDocumentsFound)}
            {stat("Legal review required", recon.legalReviewRequired)}
            {stat("Owner approval required", recon.ownerApprovalRequired)}
            {stat("Insurer evidence required", recon.insuranceEvidenceRequired)}
            {stat("Regulator action required", recon.externalRegulatorActionRequired)}
            {stat("Operational linkages defined", recon.operationalControlsLinked)}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {stageCard("Booking gate", bookingGate)}
            {stageCard("Dispatch gate", dispatchGate)}
          </div>
          <p className="text-xs text-muted-foreground">
            {LG_DRAFT_WATERMARK}. Drafts are filed in Documents 360 for authorised legal review; they are not licences,
            insurance policies, legal opinions or regulatory approvals. Official correspondence: {LG_CORRESPONDENCE_EMAIL}.
            A control clears only through the existing evidence + independent approval workflow, and booking and dispatch
            stay closed for every determination that is not approved and effective.
          </p>
          {loadError && <p className="text-xs text-destructive">{loadError}</p>}
        </CardContent>
      </Card>

      <LgApproverMatrixPanel onChanged={() => void reload()} />

      <LegalControlStatusMatrix approvals={approvals} />





      {LG_DOSSIER.map((d) => {
        const state = stateOf(d);
        const inRegister = view.controls.some((c) => c.control_id === d.control_id);
        const g = gateOf(d.control_id);
        const decisions = approvals.filter((a) => a.control_id === d.control_id);
        return (
          <Card key={d.control_id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{d.control_id}</span>
                    <span className="font-mono text-xs text-muted-foreground">{d.document_id}</span>
                    <Badge variant="secondary" className={STATE_TONE[state] ?? ""}>{state.split("_").join(" ")}</Badge>
                    <Badge variant="secondary" className={g ? GATE_TONE[g.gate_state] ?? "" : GATE_TONE.BLOCKED}>
                      {g ? `GATE ${g.gate_state}` : "NOT FILED"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{d.evidence_type}</Badge>
                    <Badge variant="outline" className="text-[10px]">{d.provenance}</Badge>
                  </div>
                  <p className="mt-1 text-sm font-medium">{d.title}</p>
                  <p className="text-xs text-muted-foreground">
                    <strong>Documents 360:</strong> {d.folder}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <strong>Filed as:</strong> {g ? `${g.file_name} (v${g.version})` : lgDraftFileName(d)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <strong>Issuing authority:</strong> {d.issuing_authority}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <strong>Declaration:</strong> {d.declaration}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <strong>Operational linkage:</strong> {d.operational_linkage}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <strong>Required approvals:</strong>{" "}
                    {lgRequiredApprovers(d.control_id)
                      .map((k) => {
                        const held =
                          k === "legal_reviewer" ? g?.legal_reviewer_approved : k === "insurer" ? g?.insurer_approved : g?.owner_approved;
                        return `${k.split("_").join(" ")} — ${held ? "recorded" : "outstanding"}`;
                      })
                      .join(" · ")}
                    {g?.reason_code ? ` · ${g.reason_code}` : ""}
                  </p>
                  {d.authoritative_fields.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <strong>Awaiting authoritative source:</strong> {d.authoritative_fields.join(", ")}
                    </p>
                  )}
                  {d.regulatory_references.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <strong>References:</strong> {d.regulatory_references.join(" · ")}
                    </p>
                  )}
                  {decisions.length > 0 && (
                    <ul className="mt-2 space-y-1 border-l-2 border-border pl-3 text-xs text-muted-foreground">
                      {decisions.map((a) => (
                        <li key={a.id}>
                          v{a.document_version} · {a.approver_kind.split("_").join(" ")} · {a.decision} ·{" "}
                          {a.decided_by_email ?? "authorised approver"} · {new Date(a.decided_at).toLocaleString("en-KE")}
                          {a.effective_from ? ` · effective ${a.effective_from.slice(0, 10)}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      download(g?.file_name ?? lgDraftFileName(d), renderLgDraft(d), "text/markdown;charset=utf-8")
                    }
                  >
                    <FileText className="mr-1 h-4 w-4" aria-hidden /> Draft
                  </Button>
                  {g && g.gate_state !== "EFFECTIVE" && (
                    <Button size="sm" onClick={() => setApprovalTarget(g)} data-analytics="admin.legal.approve">
                      Record decision
                    </Button>
                  )}
                  {inRegister && state !== "APPROVED_EVIDENCE_OF_RECORD" && (
                    <Button size="sm" variant="secondary" onClick={() => onResolve(d.control_id)} data-analytics="admin.legal.resolve">
                      File evidence
                    </Button>
                  )}
                </div>
              </div>
              {!inRegister && (
                <p className="text-xs text-muted-foreground">
                  Master policy document — it has no standalone readiness control; its approval is evidenced through the
                  goods controls it governs (LG-07, LG-08).
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Immutable determination audit trail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {audit.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No dossier activity recorded yet. Filing the drafts writes the first entries.
            </p>
          )}
          {audit.map((row) => (
            <div key={row.id} className="rounded-md border border-border p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{row.control_id}</span>
                <Badge variant="outline" className="text-[10px]">{row.action.split("_").join(" ")}</Badge>
                {row.approver_kind && (
                  <Badge variant="outline" className="text-[10px]">
                    {row.approver_kind.split("_").join(" ")} · {row.decision}
                  </Badge>
                )}
                <span className="text-muted-foreground">
                  v{row.document_version ?? "—"} · {row.content_hash?.slice(0, 12) ?? "—"} ·{" "}
                  {row.actor_email ?? "system"} · {new Date(row.created_at).toLocaleString("en-KE")}
                </span>
              </div>
              {row.detail && <p className="mt-1 text-muted-foreground">{row.detail}</p>}
              {lgChangeSummary(row).length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {lgChangeSummary(row).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Stakeholder notifications</CardTitle>
          <Button size="sm" variant="outline" onClick={sendNotices} disabled={sending}>
            {sending ? "Dispatching…" : "Dispatch pending emails"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Every seeding, supersession, decision and effectiveness transition raises an in-app notice for each mapped
            stakeholder and queues an email to the same recipients. Recipients come from the approver &amp; insurer
            mapping above — switch a grant's “Notify” off to stop its emails.
          </p>
          {notices.length === 0 && (
            <p className="text-xs text-muted-foreground">No notifications raised yet.</p>
          )}
          {notices.map((n) => (
            <div key={n.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-xs">
              <span className="font-mono font-semibold">{n.control_id}</span>
              <Badge variant="outline" className="text-[10px]">{n.event.split("_").join(" ")}</Badge>
              <Badge variant="outline" className="text-[10px]">{n.channel === "in_app" ? "in app" : "email"}</Badge>
              <Badge
                variant="secondary"
                className={
                  n.status === "sent"
                    ? GATE_TONE.EFFECTIVE
                    : n.status === "failed"
                      ? "bg-destructive/15 text-destructive"
                      : GATE_TONE.PENDING_EFFECTIVE
                }
              >
                {n.status}
              </Badge>
              <span className="text-muted-foreground">
                {n.recipient_role ?? "—"} · {n.recipient_email ?? "no mailbox"} ·{" "}
                {new Date(n.created_at).toLocaleString("en-KE")}
              </span>
              {n.last_error && <span className="w-full text-destructive">{n.last_error}</span>}
            </div>
          ))}
        </CardContent>
      </Card>



      <LgApprovalDialog
        row={approvalTarget}
        open={!!approvalTarget}
        onOpenChange={(o) => !o && setApprovalTarget(null)}
        onRecorded={() => void reload()}
      />
    </div>
  );

}
