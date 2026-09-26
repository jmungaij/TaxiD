/**
 * EDIT LEAD DETAILS — where a missing email or phone number gets added.
 *
 * Available on every lead at every step, including closed ones: a company you
 * won still needs a reachable contact. The database checks ownership, validates
 * the email and phone shape, and writes what changed onto the lead's history,
 * so nothing is corrected quietly. Fields left blank stay exactly as they were.
 */
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  DETAILS_ERROR,
  updateLeadDetails,
  type JourneyLead,
  type LeadDetailsPatch,
} from "@/lib/sales/journey";

export default function EditLeadDetailsDialog({
  lead,
  open,
  onOpenChange,
  onDone,
}: {
  lead: JourneyLead;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [organisation, setOrganisation] = React.useState(lead.organisation_name ?? "");
  const [name, setName] = React.useState(lead.contact_name ?? "");
  const [email, setEmail] = React.useState(lead.contact_email ?? "");
  const [phone, setPhone] = React.useState(lead.contact_phone ?? "");
  const [service, setService] = React.useState(lead.service_interest ?? "");
  const [value, setValue] = React.useState(
    lead.estimated_value_kes != null ? String(lead.estimated_value_kes) : "",
  );
  const [notes, setNotes] = React.useState(lead.notes ?? "");

  // Reopening the dialog shows the record as it stands now, not an old draft.
  React.useEffect(() => {
    if (!open) return;
    setOrganisation(lead.organisation_name ?? "");
    setName(lead.contact_name ?? "");
    setEmail(lead.contact_email ?? "");
    setPhone(lead.contact_phone ?? "");
    setService(lead.service_interest ?? "");
    setValue(lead.estimated_value_kes != null ? String(lead.estimated_value_kes) : "");
    setNotes(lead.notes ?? "");
  }, [open, lead]);

  const patch = (): LeadDetailsPatch => ({
    organisation_name: organisation.trim(),
    contact_name: name.trim(),
    contact_email: email.trim(),
    contact_phone: phone.trim(),
    service_interest: service.trim(),
    estimated_value_kes: value.trim(),
    notes: notes.trim(),
  });

  const m = useMutation({
    mutationFn: () => updateLeadDetails(lead.id, patch()),
    onSuccess: (res) => {
      const changed = Object.keys(res?.changed ?? {}).length;
      toast({
        title: changed ? "Details saved" : "Nothing to change",
        description: changed
          ? "The change is on this lead's history."
          : "What you entered matches what is already on record.",
      });
      onOpenChange(false);
      onDone();
    },
    onError: (e: Error) =>
      toast({
        title: "Not saved",
        description: DETAILS_ERROR[e.message] ?? e.message,
        variant: "destructive",
      }),
  });

  const problem = !organisation.trim() ? "The company name cannot be left empty." : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lead details — {lead.organisation_name}</DialogTitle>
          <DialogDescription>
            Add a missing email or phone number, or correct anything that was captured wrongly.
            What you change is recorded against this lead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor={`org-${lead.id}`}>Company</Label>
            <Input
              id={`org-${lead.id}`}
              value={organisation}
              onChange={(e) => setOrganisation(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`cname-${lead.id}`}>Contact name</Label>
              <Input
                id={`cname-${lead.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Who you speak to"
              />
            </div>
            <div>
              <Label htmlFor={`cphone-${lead.id}`}>Phone</Label>
              <Input
                id={`cphone-${lead.id}`}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                placeholder="0712 345678"
              />
            </div>
          </div>
          <div>
            <Label htmlFor={`cemail-${lead.id}`}>Email</Label>
            <Input
              id={`cemail-${lead.id}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
              placeholder="name@company.co.ke"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`cservice-${lead.id}`}>Service they need</Label>
              <Input
                id={`cservice-${lead.id}`}
                value={service}
                onChange={(e) => setService(e.target.value)}
                placeholder="e.g. staff transport, airport transfers"
              />
            </div>
            <div>
              <Label htmlFor={`cvalue-${lead.id}`}>Estimated value (KES)</Label>
              <Input
                id={`cvalue-${lead.id}`}
                type="number"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor={`cnotes-${lead.id}`}>Notes</Label>
            <Textarea
              id={`cnotes-${lead.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything useful for the next conversation"
            />
          </div>
          {problem && <p className="text-xs text-destructive">{problem}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={Boolean(problem) || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Saving…" : "Save details"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
