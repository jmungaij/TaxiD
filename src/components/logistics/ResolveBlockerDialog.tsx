/**
 * RESOLVE — the single remediation entry point for any readiness blocker.
 * The dialog renders the workflow the classification dictates. It never offers
 * a "mark as passed" control: evidence and a separate approver are mandatory.
 */
import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { CLASS_LABEL } from "@/lib/logistics/readiness/classification";
import type { CommandCenterControl } from "@/lib/logistics/readiness/execution";
import type { EvidenceSubmission } from "@/hooks/useReadinessExecution";
import { lgEvidencePrefill, validateLegalEvidenceForm } from "@/lib/logistics/legal";

export function ResolveBlockerDialog({
  control,
  onClose,
  onSubmitEvidence,
  onDecide,
  onRecordPilotRun,
  onRegisterTarget,
}: {
  control: CommandCenterControl | null;
  onClose: () => void;
  onSubmitEvidence: (s: EvidenceSubmission) => Promise<void>;
  onDecide: (controlId: string, decision: "APPROVE" | "REJECT" | "REQUEST_REVISION", comments?: string) => Promise<void>;
  onRecordPilotRun: (a: { scenario_id: string; expected_outcome: string; observed_outcome: string; result: "PASS" | "FAIL"; evidence_ref: string }) => Promise<void>;
  onRegisterTarget: (a: { target_role: "staging" | "restore"; label: string; endpoint_ref: string; synthetic_fixtures_loaded: boolean; isolation_verified: boolean; notes?: string }) => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [authoritative, setAuthoritative] = React.useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const isLegal = control?.track === "LEGAL_REGULATORY";
  React.useEffect(() => {
    setForm(control ? (lgEvidencePrefill(control.control_id) ?? {}) : {});
    setAuthoritative(false);
  }, [control?.control_id, control]);

  const legalErrors = React.useMemo(() => {
    if (!control || !isLegal) return [];
    return validateLegalEvidenceForm({
      control_id: control.control_id,
      evidence_ref: form.ref ?? "",
      approver_email: form.approver ?? "",
      document_path: form.doc ?? "",
      issuing_authority: form.authority ?? "",
      effective_at: form.eff ?? "",
      expiry_at: form.exp ?? "",
      comments: form.comments ?? "",
      authoritative_evidence: authoritative,
    });
  }, [control, isLegal, form, authoritative]);


  if (!control) return null;
  const cls = control.classification;

  const run = async (fn: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: success });
      onClose();
    } catch (e) {
      toast({ title: "Not recorded", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const evidenceForm = (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="ref">Evidence reference *</Label>
          <Input id="ref" value={form.ref ?? ""} onChange={set("ref")} placeholder="SOP-OPS-014 v1.2 / policy no." />
        </div>
        <div>
          <Label htmlFor="approver">Approver email *</Label>
          <Input id="approver" value={form.approver ?? ""} onChange={set("approver")} placeholder="director@taxid.us" />
        </div>
        <div>
          <Label htmlFor="doc">Document location</Label>
          <Input id="doc" value={form.doc ?? ""} onChange={set("doc")} placeholder="storage path or DMS link" />
        </div>
        <div>
          <Label htmlFor="authority">Issuing authority</Label>
          <Input id="authority" value={form.authority ?? ""} onChange={set("authority")} />
        </div>
        <div>
          <Label htmlFor="eff">Effective date</Label>
          <Input id="eff" type="date" value={form.eff ?? ""} onChange={set("eff")} />
        </div>
        <div>
          <Label htmlFor="exp">Expiry / review date</Label>
          <Input id="exp" type="date" value={form.exp ?? ""} onChange={set("exp")} />
        </div>
      </div>
      <div>
        <Label htmlFor="comments">Declaration &amp; comments</Label>
        <Textarea id="comments" value={form.comments ?? ""} onChange={set("comments")} placeholder="I confirm this evidence is accurate and authorised." />
      </div>
      {isLegal && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={authoritative}
              onChange={(e) => setAuthoritative(e.target.checked)}
            />
            <span>
              I am filing an authoritative document (regulator licence, insurer policy, executed contract or counsel
              determination) and the dates below are taken from that document. Leave unticked for a draft determination —
              dates must then stay blank.
            </span>
          </label>
          {legalErrors.length > 0 && (
            <ul className="list-inside list-disc text-xs text-destructive">
              {legalErrors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
      <Button
        disabled={busy || !form.ref?.trim() || !form.approver?.trim() || legalErrors.length > 0}
        onClick={() =>
          run(
            () =>
              onSubmitEvidence({
                control_id: control.control_id,
                remediation_class: cls.remediation_class,
                evidence_ref: form.ref!.trim(),
                approver_email: form.approver!.trim(),
                document_path: form.doc || null,
                issuing_authority: form.authority || null,
                jurisdiction: control.track === "LEGAL_REGULATORY" ? "KE" : null,
                effective_at: form.eff ? new Date(form.eff).toISOString() : null,
                expiry_at: form.exp ? new Date(form.exp).toISOString() : null,
                owner_role: control.owner,
                comments: form.comments || null,
              }),
            "Evidence submitted for approval",
          )
        }
      >
        Submit for approval
      </Button>
      {control.evidence_record?.workflow_state === "PENDING_APPROVAL" && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">
            Awaiting approval. Separation of duties applies: the approver must be a different signed-in user from the submitter.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => run(() => onDecide(control.control_id, "APPROVE", form.comments), "Approved")}>
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => onDecide(control.control_id, "REQUEST_REVISION", form.comments), "Revision requested")}>
              Request revision
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => onDecide(control.control_id, "REJECT", form.comments), "Rejected")}>
              Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  const pilotForm = (
    <div className="space-y-3">
      <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
        Expected outcome: {control.required_evidence}
      </p>
      <div>
        <Label htmlFor="observed">Observed outcome *</Label>
        <Textarea id="observed" value={form.observed ?? ""} onChange={set("observed")} />
      </div>
      <div>
        <Label htmlFor="pref">Evidence reference *</Label>
        <Input id="pref" value={form.pref ?? ""} onChange={set("pref")} placeholder="shipment / order / run id" />
      </div>
      <div className="flex gap-2">
        <Button
          disabled={busy || !form.observed?.trim() || !form.pref?.trim()}
          onClick={() =>
            run(
              () =>
                onRecordPilotRun({
                  scenario_id: control.control_id,
                  expected_outcome: control.required_evidence,
                  observed_outcome: form.observed!.trim(),
                  result: "PASS",
                  evidence_ref: form.pref!.trim(),
                }),
              "Pilot run recorded as PASS",
            )
          }
        >
          Record run — expected outcome met
        </Button>
        <Button
          variant="destructive"
          disabled={busy || !form.observed?.trim() || !form.pref?.trim()}
          onClick={() =>
            run(
              () =>
                onRecordPilotRun({
                  scenario_id: control.control_id,
                  expected_outcome: control.required_evidence,
                  observed_outcome: form.observed!.trim(),
                  result: "FAIL",
                  evidence_ref: form.pref!.trim(),
                }),
              "Pilot run recorded as FAIL",
            )
          }
        >
          Record run — outcome not met
        </Button>
      </div>
    </div>
  );

  const infraForm = (
    <div className="space-y-4">
      {(["staging", "restore"] as const).map((role) => (
        <div key={role} className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm font-medium capitalize">{role} instance</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="label" value={form[`${role}_label`] ?? ""} onChange={set(`${role}_label`)} />
            <Input placeholder="endpoint reference (non-production)" value={form[`${role}_ref`] ?? ""} onChange={set(`${role}_ref`)} />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !form[`${role}_ref`]?.trim() || !form[`${role}_label`]?.trim()}
            onClick={() =>
              run(
                () =>
                  onRegisterTarget({
                    target_role: role,
                    label: form[`${role}_label`]!.trim(),
                    endpoint_ref: form[`${role}_ref`]!.trim(),
                    synthetic_fixtures_loaded: role === "staging",
                    isolation_verified: true,
                    notes: form.comments,
                  }),
                `${role} target registered`,
              )
            }
          >
            Register &amp; verify isolation
          </Button>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Registering a target is an attestation that the instance exists, is not production and holds synthetic fixtures only. The
        database tests (ST-01…ST-15) still have to be executed against it — they are never cleared by this registration.
      </p>
    </div>
  );

  const engineeringNote = (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <p className="font-medium">Engineering remediation</p>
      <p className="text-muted-foreground">{control.remediation}</p>
      <p className="text-xs text-muted-foreground">
        This class is cleared by shipping the fix. The control re-evaluates automatically on the next certification run — no
        approval or attestation can clear it.
      </p>
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{control.control_id}</span>
            <Badge variant="outline">{CLASS_LABEL[cls.remediation_class]}</Badge>
          </DialogTitle>
          <DialogDescription className="text-left">{control.description}</DialogDescription>
        </DialogHeader>

        <dl className="grid gap-2 rounded-lg border border-border p-3 text-xs sm:grid-cols-2">
          <div><dt className="font-semibold">Why</dt><dd className="text-muted-foreground">{cls.why}</dd></div>
          <div><dt className="font-semibold">Who</dt><dd className="text-muted-foreground">{cls.who}</dd></div>
          <div><dt className="font-semibold">Action</dt><dd className="text-muted-foreground">{cls.action}</dd></div>
          <div><dt className="font-semibold">Authoritative evidence</dt><dd className="text-muted-foreground">{cls.evidence}</dd></div>
        </dl>

        {cls.workflow === "PILOT_EXECUTION" && pilotForm}
        {cls.workflow === "INFRASTRUCTURE_PROVISIONING" && infraForm}
        {(cls.workflow === "ENGINEERING_FIX" || cls.workflow === "DATABASE_CERTIFICATION") && engineeringNote}
        {["EVIDENCE_AND_APPROVAL", "LEGAL_REGISTER", "OPERATIONS_CERTIFICATION", "BUSINESS_TARGET"].includes(cls.workflow) && evidenceForm}
      </DialogContent>
    </Dialog>
  );
}
