/**
 * LEAD OUTREACH — compose a message to one allocated lead.
 *
 * Prospecting mail is sent from the specialist's own work mailbox, not through
 * Yalla's app-email system (that system carries messages a person is expecting,
 * and mixing prospecting into it would damage their delivery). The panel builds
 * the message with the lead's private contact link, hands it to the mailbox, and
 * records the outreach against the lead so the desk keeps the history.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Mail, Copy, Send } from "lucide-react";
import {
  OUTREACH_TEMPLATES,
  buildMailto,
  contactLinkUrl,
  leadContactToken,
  logOutreach,
} from "@/lib/sales/leadDesk";
import type { SalesLead } from "@/lib/sales/pipeline";
import { useAuth } from "@/hooks/useAuth";

export default function LeadOutreachDialog({
  lead,
  onDone,
}: {
  lead: SalesLead;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [templateId, setTemplateId] = React.useState(OUTREACH_TEMPLATES[0].id);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const senderName =
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    user?.email?.split("@")[0] ||
    "Yalla Mobility";

  const tokenQuery = useQuery({
    queryKey: ["lead-contact-token", lead.id],
    queryFn: () => leadContactToken(lead.id),
    enabled: open,
  });
  const link = tokenQuery.data ? contactLinkUrl(tokenQuery.data) : "";

  React.useEffect(() => {
    if (!open || touched || !link) return;
    const t = OUTREACH_TEMPLATES.find((x) => x.id === templateId) ?? OUTREACH_TEMPLATES[0];
    setSubject(t.subject.replace("{organisation}", lead.organisation_name));
    setBody(
      t.body({
        organisation: lead.organisation_name,
        contact: lead.contact_name,
        link,
        sender: senderName,
      }),
    );
  }, [open, templateId, link, touched, lead.organisation_name, lead.contact_name, senderName]);

  const hasEmail = Boolean(lead.contact_email && lead.contact_email.trim());

  const record = useMutation({
    mutationFn: () =>
      logOutreach({
        lead_id: lead.id,
        subject,
        body,
        channel: "EMAIL",
        recipient_email: lead.contact_email,
        contact_link: link,
        intent: templateId.toUpperCase(),
      }),
    onSuccess: () => {
      toast({ title: "Outreach recorded", description: `${lead.organisation_name} marked as contacted.` });
      void qc.invalidateQueries({ queryKey: ["lead-desk-kpis"] });
      void qc.invalidateQueries({ queryKey: ["lead-messages", lead.id] });
      setOpen(false);
      onDone?.();
    },
    onError: (e: Error) =>
      toast({ title: "Not recorded", description: e.message, variant: "destructive" }),
  });

  const openMailbox = () => {
    if (!hasEmail) return;
    window.location.href = buildMailto(lead.contact_email as string, subject, body);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Write to lead
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Write to {lead.organisation_name}</DialogTitle>
          <DialogDescription>
            The message opens in your own Yalla mailbox. Send it there, then record it here so the
            desk and the follow-up queue know it went out.
          </DialogDescription>
        </DialogHeader>

        {!hasEmail && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            NO EMAIL ON FILE for this lead. Add the contact address to the lead first — nothing is
            guessed on your behalf.
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {OUTREACH_TEMPLATES.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant={templateId === t.id ? "secondary" : "ghost"}
              onClick={() => {
                setTemplateId(t.id);
                setTouched(false);
              }}
            >
              {t.label}
            </Button>
          ))}
        </div>

        <div className="grid gap-3">
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" readOnly value={lead.contact_email ?? "No email on file"} />
          </div>
          <div>
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => {
                setTouched(true);
                setSubject(e.target.value);
              }}
            />
          </div>
          <div>
            <Label htmlFor="body">Message</Label>
            <Textarea
              id="body"
              rows={12}
              value={body}
              onChange={(e) => {
                setTouched(true);
                setBody(e.target.value);
              }}
            />
          </div>
          <div className="rounded-md border p-3 text-xs">
            <p className="font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Contact link included
            </p>
            <p className="mt-1 break-all text-muted-foreground">
              {tokenQuery.isLoading ? "Preparing link…" : link || "LINK UNAVAILABLE"}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={!link}
                onClick={() => {
                  void navigator.clipboard.writeText(link);
                  toast({ title: "Contact link copied" });
                }}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copy link
              </Button>
              <Badge variant="outline">Replies land in this portal</Badge>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="secondary" disabled={!hasEmail || !subject || !body} onClick={openMailbox}>
            <Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Open in my mailbox
          </Button>
          <Button
            size="sm"
            disabled={record.isPending || body.trim().length < 10}
            onClick={() => record.mutate()}
          >
            <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Record as sent
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
