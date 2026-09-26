/**
 * ADD OR CHANGE THE CONTACT PERSON ON A LEAD.
 *
 * The field is left open when no person is recorded — the workspace asks for the
 * real name rather than showing a placeholder that reads like one.
 */
import * as React from "react";
import { UserPlus, UserPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { contactPerson, saveLeadContact } from "@/lib/sales/leadContact";

export function LeadContactDialog({
  leadId,
  organisation,
  contactName,
  contactEmail,
  contactPhone,
  onSaved,
}: {
  leadId: string;
  organisation: string;
  contactName: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const recorded = contactPerson(contactName);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(recorded ?? "");
  const [email, setEmail] = React.useState(contactEmail ?? "");
  const [phone, setPhone] = React.useState(contactPhone ?? "");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(recorded ?? "");
      setEmail(contactEmail ?? "");
      setPhone(contactPhone ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveLeadContact(leadId, { contactName: name, contactEmail: email, contactPhone: phone });
      toast({ title: recorded ? "Contact person changed" : "Contact person added", description: `${organisation}: ${name.trim()}` });
      setOpen(false);
      onSaved?.();
    } catch (err) {
      toast({
        title: "Not saved",
        description: err instanceof Error ? err.message : "The contact person could not be saved.",
        variant: "destructive",
      });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={recorded ? "ghost" : "outline"}>
          {recorded ? (
            <>
              <UserPen className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Change contact
            </>
          ) : (
            <>
              <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Add contact person
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{recorded ? "Change the contact person" : "Add the contact person"}</DialogTitle>
          <DialogDescription>
            {organisation}. {recorded ? "Correct the name as the client gave it." : "No person is recorded on this client yet."}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="lead-contact-name">Contact person</Label>
            <Input
              id="lead-contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name as the client gave it"
              autoFocus
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lead-contact-email">Email</Label>
              <Input
                id="lead-contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Leave blank if not known"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-contact-phone">Telephone</Label>
              <Input
                id="lead-contact-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Leave blank if not known"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || name.trim().length < 2}>
              {saving ? "Saving…" : "Save contact person"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default LeadContactDialog;
