/**
 * LG determination approval dialog.
 *
 * Records a version-bound decision by an authorised legal reviewer, the insurer
 * (LG-05 / LG-06) or the owner. It offers no "mark PASS" control: the decision
 * is written to the append-only approval ledger and the gate is recomputed by
 * the database from the required approvals and the effective date.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import {
  allowedApproverKinds,
  fetchLgApproverMap,
  type LgApproverMapRow,
} from "@/lib/logistics/legal/approverMap";
import {
  lgRequiredApprovers,
  recordLgApproval,
  validateLgApproval,
  type LgApproverKind,
  type LgDecision,
  type LgGateRow,
} from "@/lib/logistics/legal/dossierControl";

const KIND_LABEL: Record<LgApproverKind, string> = {
  legal_reviewer: "Authorised legal reviewer",
  insurer: "Insurer / broker evidence",
  owner: "Owner approval",
};


export function LgApprovalDialog({
  row,
  open,
  onOpenChange,
  onRecorded,
}: {
  row: LgGateRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRecorded: () => void;
}) {
  const { roles } = useAuth();
  const [kind, setKind] = React.useState<LgApproverKind>("legal_reviewer");
  const [decision, setDecision] = React.useState<LgDecision>("approved");
  const [comments, setComments] = React.useState("");
  const [conditions, setConditions] = React.useState("");
  const [evidenceRef, setEvidenceRef] = React.useState("");
  const [issuingAuthority, setIssuingAuthority] = React.useState("");
  const [effectiveFrom, setEffectiveFrom] = React.useState("");
  const [effectiveUntil, setEffectiveUntil] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [map, setMap] = React.useState<LgApproverMapRow[]>([]);
  const [mapError, setMapError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    fetchLgApproverMap()
      .then((rows) => {
        setMap(rows);
        setMapError(null);
      })
      .catch((e) => setMapError(e instanceof Error ? e.message : "The approver mapping could not be read."));
  }, [open]);

  // Only the approver roles the administered mapping grants this user, for this
  // control, may be selected. The database enforces the same rule.
  const permitted = React.useMemo(
    () =>
      row
        ? allowedApproverKinds({
            rows: map,
            roles: roles ?? [],
            controlId: row.control_id,
            requiresInsurer: row.requires_insurer_approval,
          })
        : [],
    [map, roles, row],
  );

  React.useEffect(() => {
    if (!open) return;
    setDecision("approved");
    setComments("");
    setConditions("");
    setEvidenceRef("");
    setIssuingAuthority("");
    setEffectiveFrom("");
    setEffectiveUntil("");
    setErrors([]);
  }, [open, row?.document_version_id]);

  React.useEffect(() => {
    if (permitted.length && !permitted.includes(kind)) setKind(permitted[0]);
  }, [permitted, kind]);

  if (!row) return null;
  const required = lgRequiredApprovers(row.control_id);
  const kinds = permitted;


  const submit = async () => {
    const input = {
      documentVersionId: row.document_version_id,
      approverKind: kind,
      decision,
      comments,
      conditions: conditions || undefined,
      evidenceRef: evidenceRef || undefined,
      issuingAuthority: issuingAuthority || undefined,
      effectiveFrom: effectiveFrom || undefined,
      effectiveUntil: effectiveUntil || undefined,
    };
    const local = validateLgApproval(input);
    if (local.length) {
      setErrors(local);
      return;
    }
    setBusy(true);
    try {
      await recordLgApproval(input);
      onRecorded();
      onOpenChange(false);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "The decision could not be recorded."]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Record a determination decision — {row.control_id} · {row.document_id} v{row.version}
          </DialogTitle>
          <DialogDescription>
            The decision is bound to this exact document version and written to the immutable approval trail. It becomes
            operationally effective only once every required approver has decided and the effective date has passed.
          </DialogDescription>
        </DialogHeader>

        {kinds.length === 0 && (
          <div
            className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-xs"
            data-testid="lg-approval-unmapped"
          >
            Your roles are not mapped to any approver authority for {row.control_id}. The approvals this control still
            needs are: {required.map((k) => KIND_LABEL[k].toLowerCase()).join(", ")}. An administrator must grant the
            authority in the approver &amp; insurer mapping before a decision can be recorded.
          </div>
        )}

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="lg-kind">Approver role</Label>
              <select
                id="lg-kind"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={kind}
                disabled={kinds.length === 0}
                onChange={(e) => setKind(e.target.value as LgApproverKind)}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Authority is granted per control by an administrator in the approver &amp; insurer mapping.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="lg-decision">Decision</Label>
              <select
                id="lg-decision"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={decision}
                onChange={(e) => setDecision(e.target.value as LgDecision)}
              >
                <option value="approved">Approved</option>
                <option value="approved_with_conditions">Approved with conditions</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="lg-eff">Effective from {decision !== "rejected" ? "(required)" : "(n/a)"}</Label>
              <Input id="lg-eff" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lg-exp">Expiry / review date (optional)</Label>
              <Input id="lg-exp" type="date" value={effectiveUntil} onChange={(e) => setEffectiveUntil(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lg-ref">Evidence reference</Label>
              <Input
                id="lg-ref"
                value={evidenceRef}
                onChange={(e) => setEvidenceRef(e.target.value)}
                placeholder="Licence / policy / opinion reference"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lg-auth">Issuing authority</Label>
              <Input
                id="lg-auth"
                value={issuingAuthority}
                onChange={(e) => setIssuingAuthority(e.target.value)}
                placeholder="Actual authority, insurer or counsel"
              />
            </div>
          </div>

          {decision === "approved_with_conditions" && (
            <div className="space-y-1">
              <Label htmlFor="lg-cond">Conditions</Label>
              <Textarea id="lg-cond" value={conditions} onChange={(e) => setConditions(e.target.value)} rows={2} />
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="lg-comments">Evidentiary basis of the decision</Label>
            <Textarea
              id="lg-comments"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={4}
              placeholder="State the documents relied upon and what they establish. Generic declarations are rejected."
            />
          </div>

          {mapError && <p className="text-xs text-destructive">{mapError}</p>}

          {errors.length > 0 && (
            <ul className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || kinds.length === 0}>
            {busy ? "Recording…" : "Record decision"}
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}
