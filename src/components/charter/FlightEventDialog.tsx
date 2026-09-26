import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Radio } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { charterApi, type CharterBookingRow } from "@/lib/charter/api";
import { FLIGHT_REASON_CODES } from "@/lib/charter/access";
import { allowedNext, statusLabel, transitionError } from "@/lib/charter/transitions";
import { ACCEPTED_EVIDENCE, uploadEvidence } from "@/lib/charter/evidence";
import { describeDbError } from "@/lib/charter/errors";


/** Local datetime string (yyyy-MM-ddTHH:mm) for the timestamp input. */
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function FlightEventDialog({
  booking,
  onSaved,
}: {
  booking: CharterBookingRow;
  onSaved: () => void;
}) {
  const options = allowedNext(booking.flight_status || "requested");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(options[0] ?? "");
  const [evidence, setEvidence] = useState<File | null>(null);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [reason, setReason] = useState<string>("none");
  const [note, setNote] = useState("");
  const [occurredAt, setOccurredAt] = useState(localNow());
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const invalid = transitionError(booking.flight_status || "requested", status);
    if (invalid) {
      toast({ title: "Invalid status change", description: invalid, variant: "destructive" });
      return;
    }
    if (Date.parse(occurredAt) > Date.now() + 60_000) {
      toast({ title: "Invalid timestamp", description: "Event time cannot be in the future.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      let evidenceUrl: string | undefined;
      if (evidence) evidenceUrl = await uploadEvidence(evidence, `bookings/${booking.id}`);
      await charterApi.recordFlightEvent({
        booking_id: booking.id,
        status,
        reason_code: reason === "none" ? undefined : reason,
        note: note.trim() || undefined,
        occurred_at: new Date(occurredAt).toISOString(),
        evidence_url: evidenceUrl,
        evidence_note: evidenceNote.trim() || undefined,
      });
      toast({ title: "Flight event recorded", description: `${booking.reference} → ${status}` });
      setOpen(false);
      setNote("");
      setEvidence(null);
      setEvidenceNote("");
      onSaved();
    } catch (e) {
      const failure = describeDbError(e);
      toast({
        title: failure.title,
        description: failure.retryable
          ? `${failure.reason} The board has been refreshed — you can retry safely.`
          : failure.reason,
        variant: "destructive",
      });
      // Refresh so the dialog and board reflect the true persisted status
      // before the operator retries.
      onSaved();
    } finally {
      setSaving(false);
    }

  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" aria-label={`Update flight status for ${booking.reference}`}>
          <Radio className="mr-2 h-4 w-4" /> Update status
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Flight status event</DialogTitle>
          <DialogDescription>
            {booking.reference} · {booking.asset_name} — currently {booking.flight_status}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="fe-status">New status</Label>
            <Select value={status} onValueChange={setStatus} disabled={!options.length}>
              <SelectTrigger id="fe-status" className="mt-2">
                <SelectValue placeholder={options.length ? "Select status" : "No further updates allowed"} />
              </SelectTrigger>
              <SelectContent>
                {options.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {options.length
                ? `Allowed from ${statusLabel(booking.flight_status)}: ${options.map(statusLabel).join(", ")}`
                : `${statusLabel(booking.flight_status)} is a final state.`}
            </p>
          </div>

          <div>
            <Label htmlFor="fe-reason">Reason code (optional)</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="fe-reason" className="mt-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No reason code</SelectItem>
                {FLIGHT_REASON_CODES.map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="fe-at">Event timestamp</Label>
            <Input
              id="fe-at" type="datetime-local" className="mt-2"
              value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="fe-note">Operations note (optional)</Label>
            <Textarea
              id="fe-note" className="mt-2" maxLength={240} rows={3}
              value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Visible on the customer timeline"
            />
          </div>

          <div>
            <Label htmlFor="fe-doc">Evidence document (optional)</Label>
            <Input
              id="fe-doc" type="file" className="mt-2" accept={ACCEPTED_EVIDENCE}
              onChange={(e) => setEvidence(e.target.files?.[0] ?? null)}
            />
            <Input
              className="mt-2" maxLength={240} placeholder="Document description"
              aria-label="Evidence document description"
              value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || !options.length || !status}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Record event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
