import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { REASON_CODE_SPECS } from "@/lib/logistics/domain/reasonCodes";
import {
  ATTEMPT_OUTCOMES,
  narrativeRequired,
  recordDeliveryAttempt,
  validateAttempt,
  type AttemptOutcome,
} from "@/lib/logistics/orders/attempts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageId: string;
  trackingNumber?: string | null;
  nextAttemptNumber?: number;
  onRecorded?: () => void;
}

/**
 * Records one delivery attempt. Outcome, reason code and evidence go to the
 * server RPC, which owns the attempt number, the package transition and any
 * exception that gets opened. The idempotency key is minted once per dialog
 * session so a double submit can never create two attempts.
 */
export default function DeliveryAttemptDialog({
  open,
  onOpenChange,
  packageId,
  trackingNumber,
  nextAttemptNumber,
  onRecorded,
}: Props) {
  const [outcome, setOutcome] = useState<AttemptOutcome | "">("");
  const [reasonCode, setReasonCode] = useState<string>("");
  const [narrative, setNarrative] = useState("");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useMemo(
    () => `attempt-${packageId}-${crypto.randomUUID()}`,
    [packageId, open],
  );

  const validation = validateAttempt({ outcome, reasonCode: reasonCode || null, narrative });
  const needsReason = outcome !== "" && outcome !== "delivered";

  async function submit() {
    if (!validation.valid || !outcome) return;
    setBusy(true);
    const result = await recordDeliveryAttempt({
      packageId,
      outcome,
      idempotencyKey,
      reasonCode: reasonCode || null,
      narrative: narrative.trim() || null,
      recipientName: recipient.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message ?? "The attempt could not be recorded.");
      return;
    }
    if (result.data?.replayed) {
      toast.info("This attempt was already recorded — nothing was duplicated.");
    } else {
      toast.success(
        result.data?.exception_id
          ? `Attempt ${result.data.attempt_number} recorded — an exception was opened.`
          : `Attempt ${result.data?.attempt_number} recorded.`,
      );
    }
    onRecorded?.();
    onOpenChange(false);
    setOutcome("");
    setReasonCode("");
    setNarrative("");
    setRecipient("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Record delivery attempt{nextAttemptNumber ? ` #${nextAttemptNumber}` : ""}
          </DialogTitle>
          <DialogDescription>
            {trackingNumber ? `Package ${trackingNumber}. ` : ""}
            Attempts are permanent: the server assigns the attempt number, transitions the package and
            opens an exception when the outcome is not a delivery.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Outcome</Label>
            <Select value={outcome} onValueChange={(v) => setOutcome(v as AttemptOutcome)}>
              <SelectTrigger><SelectValue placeholder="Select the outcome" /></SelectTrigger>
              <SelectContent>
                {ATTEMPT_OUTCOMES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsReason && (
            <div className="space-y-2">
              <Label>Reason code</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger><SelectValue placeholder="Select a reason code" /></SelectTrigger>
                <SelectContent>
                  {REASON_CODE_SPECS.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.code.replace(/_/g, " ").toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Recipient name (optional)</Label>
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Who received or refused" />
          </div>

          <div className="space-y-2">
            <Label>
              Notes{narrativeRequired(reasonCode) ? " (required for this reason code)" : " (optional)"}
            </Label>
            <Textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} rows={3} />
          </div>

          {!validation.valid && (outcome || reasonCode) && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{validation.errors[0]}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !validation.valid}>
            {busy ? "Recording…" : "Record attempt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
