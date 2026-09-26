/**
 * ALLOCATED LEADS — each specialist's own book of leads with contact status.
 *
 * A specialist reads their own allocation; sales leadership and admins read the
 * whole desk. The list is the live lead register — contact status, last outreach
 * and last reply come from the message log, so nothing here is a manual claim.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Users, MessageSquare, CalendarPlus, Inbox } from "lucide-react";
import LeadOutreachDialog from "@/components/sales/LeadOutreachDialog";
import { LeadDetailsDialog } from "@/components/sales/LeadDetailsDialog";
import {
  CONTACT_STATE_LABEL,
  addFollowUp,
  listLeadMessages,
  logReply,
  type ContactState,
} from "@/lib/sales/leadDesk";
import { formatWaitHours as hours } from "@/lib/sales/leadDesk";
import { STAGE_LABEL, listMyLeads, type LeadStage, type SalesLead } from "@/lib/sales/pipeline";

interface LeadWithContact extends SalesLead {
  contact_state?: ContactState;
  first_outreach_at?: string | null;
  last_outreach_at?: string | null;
  first_reply_at?: string | null;
  last_reply_at?: string | null;
}

/**
 * Response time on one lead: from the first message we sent to their first
 * reply, or — while nobody has replied — how long they have been sitting.
 */
function responseLine(lead: LeadWithContact): string | null {
  const first = lead.first_outreach_at ?? lead.last_outreach_at;
  if (!first) return null;
  const started = new Date(first).getTime();
  if (lead.first_reply_at) {
    return `Replied in ${hours((new Date(lead.first_reply_at).getTime() - started) / 3_600_000)}`;
  }
  if ((lead.contact_state ?? "NOT_CONTACTED") !== "CONTACTED") return null;
  return `Waiting ${hours((Date.now() - started) / 3_600_000)} for a first reply`;
}

const FILTERS: { id: "ALL" | ContactState; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "NOT_CONTACTED", label: "Not contacted" },
  { id: "CONTACTED", label: "Awaiting reply" },
  { id: "REPLIED", label: "Replied" },
  { id: "NOT_INTERESTED", label: "Not interested" },
];

const dt = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : null;

function StateBadge({ state }: { state: ContactState }) {
  const tone =
    state === "REPLIED"
      ? "bg-success/10 text-success border-success/30"
      : state === "CONTACTED"
        ? "bg-primary/10 text-primary border-primary/30"
        : state === "NOT_INTERESTED"
          ? "bg-muted text-muted-foreground"
          : "bg-accent/10 text-accent-foreground border-border";
  return (
    <Badge variant="outline" className={tone}>
      {CONTACT_STATE_LABEL[state]}
    </Badge>
  );
}

function Conversation({ leadId }: { leadId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["lead-messages", leadId],
    queryFn: () => listLeadMessages(leadId),
  });
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  const rows = data ?? [];
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">NO MESSAGES RECORDED FOR THIS LEAD YET.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((m) => (
        <li key={m.id} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="outline">
              {m.direction === "OUTBOUND" ? "We wrote" : `Reply from ${m.sender_name ?? "the contact"}`}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(m.created_at).toLocaleString("en-KE")} · {m.channel.replace("_", " ").toLowerCase()}
            </span>
          </div>
          {m.subject && <p className="mt-2 font-medium">{m.subject}</p>}
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{m.body}</p>
        </li>
      ))}
    </ul>
  );
}

function LogReplyDialog({ lead, onDone }: { lead: SalesLead; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [channel, setChannel] = React.useState("EMAIL");
  const [intent, setIntent] = React.useState("REPLIED");
  const m = useMutation({
    mutationFn: () => logReply({ lead_id: lead.id, body: body.trim(), channel, intent }),
    onSuccess: () => {
      toast({ title: "Reply recorded", description: `${lead.organisation_name} marked as replied.` });
      setBody("");
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast({ title: "Not recorded", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Inbox className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Log a reply
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a reply from {lead.organisation_name}</DialogTitle>
          <DialogDescription>
            Use this when they replied to your mailbox or by phone. Record what they actually said.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {["EMAIL", "PHONE", "WHATSAPP", "MEETING"].map((c) => (
              <Button
                key={c}
                size="sm"
                variant={channel === c ? "secondary" : "outline"}
                onClick={() => setChannel(c)}
              >
                {c.charAt(0) + c.slice(1).toLowerCase()}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: "REPLIED", label: "Replied" },
              { id: "INTERESTED", label: "Interested" },
              { id: "INFORMATION", label: "Wants information" },
              { id: "NOT_INTERESTED", label: "Not interested" },
            ].map((i) => (
              <Button
                key={i.id}
                size="sm"
                variant={intent === i.id ? "secondary" : "ghost"}
                onClick={() => setIntent(i.id)}
              >
                {i.label}
              </Button>
            ))}
          </div>
          <div>
            <Label htmlFor="reply">What they said</Label>
            <Textarea id="reply" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" disabled={body.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
              Record reply
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FollowUpDialog({ lead, onDone }: { lead: SalesLead; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [action, setAction] = React.useState("");
  const [due, setDue] = React.useState("");
  const m = useMutation({
    mutationFn: () =>
      addFollowUp({
        lead_id: lead.id,
        logged_note: note.trim(),
        next_action: action.trim(),
        due_date: due,
      }),
    onSuccess: () => {
      toast({ title: "Follow-up queued" });
      setNote("");
      setAction("");
      setDue("");
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast({ title: "Not queued", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <CalendarPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Follow-up
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Follow-up for {lead.organisation_name}</DialogTitle>
          <DialogDescription>What was said, and what happens next.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="note">What was said</Label>
            <Textarea id="note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="action">Next action</Label>
            <Input
              id="action"
              placeholder="e.g. call the transport manager with route pricing"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="due">Due date</Label>
            <Input id="due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!note.trim() || !action.trim() || !due || m.isPending}
              onClick={() => m.mutate()}
            >
              Queue follow-up
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LeadCard({ lead, onChanged }: { lead: LeadWithContact; onChanged: () => void }) {
  const [showThread, setShowThread] = React.useState(false);
  const state = (lead.contact_state ?? "NOT_CONTACTED") as ContactState;
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{lead.organisation_name}</p>
          <p className="text-xs text-muted-foreground">
            {lead.lead_ref} · {lead.contact_name}
            {lead.contact_email ? ` · ${lead.contact_email}` : " · NO EMAIL ON FILE"}
            {lead.contact_phone ? ` · ${lead.contact_phone}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StateBadge state={state} />
          <Badge variant="outline">{STAGE_LABEL[lead.stage as LeadStage]}</Badge>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {dt(lead.last_outreach_at) ? `Last written to ${dt(lead.last_outreach_at)}` : "Never contacted"}
        {dt(lead.last_reply_at) ? ` · Last reply ${dt(lead.last_reply_at)}` : ""}
        {responseLine(lead) ? ` · ${responseLine(lead)}` : ""}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <LeadDetailsDialog leadId={lead.id} onSaved={onChanged} />
        <LeadOutreachDialog lead={lead} onDone={onChanged} />
        <LogReplyDialog lead={lead} onDone={onChanged} />
        <FollowUpDialog lead={lead} onDone={onChanged} />
        <Button size="sm" variant="ghost" onClick={() => setShowThread((v) => !v)}>
          <MessageSquare className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {showThread ? "Hide messages" : "Messages"}
        </Button>
      </div>

      {showThread && (
        <div className="mt-3">
          <Conversation leadId={lead.id} />
        </div>
      )}
    </div>
  );
}

export default function LeadAllocationBoard() {
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<"ALL" | ContactState>("ALL");
  const [search, setSearch] = React.useState("");
  const { data, isLoading, error } = useQuery({ queryKey: ["sales-leads"], queryFn: listMyLeads });

  const onChanged = () => {
    void qc.invalidateQueries({ queryKey: ["sales-leads"] });
    void qc.invalidateQueries({ queryKey: ["lead-desk-kpis"] });
    void qc.invalidateQueries({ queryKey: ["lead-followups"] });
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">Your allocated leads could not be read.</p>
          <p className="text-muted-foreground">{(error as Error).message}</p>
        </CardContent>
      </Card>
    );

  const leads = (data ?? []) as LeadWithContact[];
  const q = search.trim().toLowerCase();
  const shown = leads.filter((l) => {
    const stateOk = filter === "ALL" || (l.contact_state ?? "NOT_CONTACTED") === filter;
    const searchOk =
      !q ||
      l.organisation_name.toLowerCase().includes(q) ||
      l.contact_name.toLowerCase().includes(q) ||
      (l.contact_email ?? "").toLowerCase().includes(q) ||
      l.lead_ref.toLowerCase().includes(q);
    return stateOk && searchOk;
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" aria-hidden /> Allocated leads
        </CardTitle>
        <CardDescription>
          {leads.length === 0
            ? "NO LEADS ALLOCATED TO YOU."
            : `${leads.length} leads in your book · ${shown.length} shown`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? "secondary" : "ghost"}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
          <Input
            className="ml-auto max-w-xs"
            placeholder="Search organisation, contact or reference"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">NO LEADS MATCH THIS VIEW.</p>
        ) : (
          shown.map((l) => <LeadCard key={l.id} lead={l} onChanged={onChanged} />)
        )}
      </CardContent>
    </Card>
  );
}
