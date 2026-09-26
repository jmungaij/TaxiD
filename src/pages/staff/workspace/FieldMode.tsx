/**
 * FIELD MODE — CAPTURE ON THE MOVE.
 *
 * Five actions, large enough for a phone, each writing to the same records the
 * desk uses: a call, a meeting held, the customer's organisation and documents,
 * opening a qualified deal, and a follow-up the customer is waiting on. Nothing
 * is stored locally and nothing is invented — if a note is too thin to be
 * evidence, the record refuses it and says so.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Handshake, Loader2, PhoneCall, Search, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { OrganisationOnboardingDialog } from "@/components/sales/OrganisationOnboardingDialog";
import { QualifyDealDialog } from "@/components/sales/QualifyDealDialog";
import { KES, STEP_LABEL, listLeadFlow, nextAction, type LeadFlowRow } from "@/lib/sales/leadFlow";
import { logOutreach } from "@/lib/sales/leadDesk";
import { logStep, setWaiting } from "@/lib/sales/journey";

type Capture = "CALL" | "MEET" | "FOLLOW_UP";

const TITLE: Record<Capture, string> = {
  CALL: "Record a call",
  MEET: "Record a meeting held",
  FOLLOW_UP: "Record a follow-up",
};

function CaptureDialog({
  lead,
  kind,
  onClose,
  onSaved,
}: {
  lead: LeadFlowRow;
  kind: Capture;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = React.useState("");
  const [item, setItem] = React.useState("");
  const [due, setDue] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (kind === "CALL") {
        await logOutreach({
          lead_id: lead.lead_id,
          subject: `Call with ${lead.contact_name ?? lead.organisation_name}`,
          body: note.trim(),
          channel: "CALL",
          intent: "FIELD_CAPTURE",
        });
      } else if (kind === "MEET") {
        await logStep(lead.lead_id, "MEETING", note.trim() || undefined);
      } else {
        await setWaiting(lead.lead_id, "CLIENT", item.trim() || undefined, due || undefined);
      }
      toast({ title: "Recorded", description: `${TITLE[kind]} — ${lead.organisation_name}.` });
      onSaved();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: "Not recorded",
        description: msg.includes("MESSAGE_REQUIRED")
          ? "Write a little more about what was said — ten characters at least."
          : msg,
        variant: "destructive",
      });
    }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {TITLE[kind]} · {lead.organisation_name}
            </DialogTitle>
            <DialogDescription>
              This is written to the customer's record straight away, exactly as you enter it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            {kind === "FOLLOW_UP" ? (
              <>
                <div>
                  <Label htmlFor="fm-item">What is the customer coming back with?</Label>
                  <Input
                    id="fm-item"
                    value={item}
                    onChange={(e) => setItem(e.target.value)}
                    placeholder="e.g. Signed Mobility Service Contract"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="fm-due">By when?</Label>
                  <Input id="fm-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                </div>
              </>
            ) : (
              <div>
                <Label htmlFor="fm-note">What happened?</Label>
                <Textarea
                  id="fm-note"
                  rows={4}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Who you spoke to, what they asked for, what you agreed."
                  required={kind === "CALL"}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
              Save it
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function FieldMode() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [term, setTerm] = React.useState("");
  const [capture, setCapture] = React.useState<{ lead: LeadFlowRow; kind: Capture } | null>(null);

  const flow = useQuery({ queryKey: ["lead-flow"], queryFn: listLeadFlow });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["lead-flow"] });

  const rows = (flow.data ?? [])
    .filter((r) => !r.is_test && r.step !== "LOST")
    .filter((r) => {
      const q = term.trim().toLowerCase();
      if (!q) return true;
      return (
        r.organisation_name.toLowerCase().includes(q) ||
        (r.contact_name ?? "").toLowerCase().includes(q) ||
        r.lead_ref.toLowerCase().includes(q)
      );
    })
    .slice(0, 25);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Field mode</h1>
        <p className="text-sm text-muted-foreground">
          Capture a call, a meeting, a customer's details, a new deal or a follow-up while you are with the customer.
        </p>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          className="h-12 pl-9 text-base"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Find the customer you are with"
        />
      </div>

      {flow.isLoading && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your customers…
        </div>
      )}

      {!flow.isLoading && rows.length === 0 && (
        <p className="py-6 text-sm text-muted-foreground">
          No customer matches that. Clear the search to see your open book.
        </p>
      )}

      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.lead_id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{r.organisation_name}</CardTitle>
              <CardDescription>
                {r.contact_name ?? "Contact person not stated"} ·{" "}
                {r.contact_phone ?? "no phone recorded"} · {nextAction(r)}
              </CardDescription>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Badge variant="secondary" className="text-[10px]">
                  {STEP_LABEL[r.step]}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {r.estimated_value_kes ? KES(r.estimated_value_kes) : "value not stated"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-10"
                onClick={() => {
                  if (r.contact_phone) window.location.href = `tel:${r.contact_phone}`;
                  else toast({ title: "No phone recorded", description: "Add a contact number on the customer first." });
                  setCapture({ lead: r, kind: "CALL" });
                }}
              >
                <PhoneCall className="mr-1 h-4 w-4" aria-hidden /> Call
              </Button>
              <Button size="sm" variant="outline" className="h-10" onClick={() => setCapture({ lead: r, kind: "MEET" })}>
                <Handshake className="mr-1 h-4 w-4" aria-hidden /> Meet
              </Button>
              <OrganisationOnboardingDialog leadId={r.lead_id} organisation={r.organisation_name} onSaved={refresh} />
              {r.step !== "WON" && (
                <QualifyDealDialog
                  leadId={r.lead_id}
                  organisation={r.organisation_name}
                  currentValueKes={r.estimated_value_kes}
                  onOpened={refresh}
                />
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-10"
                onClick={() => setCapture({ lead: r, kind: "FOLLOW_UP" })}
              >
                <CalendarClock className="mr-1 h-4 w-4" aria-hidden /> Follow-up
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {capture && (
        <CaptureDialog
          lead={capture.lead}
          kind={capture.kind}
          onClose={() => setCapture(null)}
          onSaved={refresh}
        />
      )}

      <p className="text-xs text-muted-foreground">
        <Target className="mr-1 inline h-3 w-3" aria-hidden />
        Everything captured here appears on the customer's account, in the daily close and in the next best actions queue.
      </p>
    </div>
  );
}
