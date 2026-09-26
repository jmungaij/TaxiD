/**
 * Recruitment 360 — candidate contact recovery.
 *
 * Three things in one governed surface: manual capture of a detail a recruiter
 * verified, an automated request for the detail the candidate must supply, and
 * the append-only audit trail of every request and response. The browser never
 * mutates the candidate directly — every write goes through a governed RPC.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, Loader2, Mail, PhoneCall, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AppButton } from "@/components/nav/AppButton";

import {
  CONTACT_STATUS_LABEL, loadContactTimeline, logContactResponse, recordCandidateContact,
  requestCandidateContact, type ScreeningReportRow,
} from "@/lib/recruitment/screening";

const CHANNELS = [
  { value: "auto", label: "Automatic (best reachable channel)" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone_call", label: "Telephone call (logged manually)" },
  { value: "manual", label: "Manual follow-up only" },
] as const;

export interface ContactRecoveryDialogProps {
  row: ScreeningReportRow | null;
  onClose: () => void;
}

export default function ContactRecoveryDialog({ row, onClose }: ContactRecoveryDialogProps) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [wantEmail, setWantEmail] = useState(true);
  const [wantPhone, setWantPhone] = useState(true);
  const [channel, setChannel] = useState<string>("auto");

  const timeline = useQuery({
    queryKey: ["rec", "contact", "timeline", row?.candidate_id],
    queryFn: () => loadContactTimeline(row!.candidate_id),
    enabled: !!row?.candidate_id,
  });

  const reset = () => {
    setEmail("");
    setPhone("");
    setNotes("");
  };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["rec", "screening"] });
    void qc.invalidateQueries({ queryKey: ["rec", "contact"] });
  };

  const save = useMutation({
    mutationFn: () =>
      recordCandidateContact({
        candidateId: row!.candidate_id,
        email: email.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Contact details recorded against the candidate audit trail");
      reset();
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record contact details"),
  });

  const request = useMutation({
    mutationFn: () =>
      requestCandidateContact({
        applicationId: row!.application_id,
        fields: [wantEmail ? "email" : null, wantPhone ? "phone" : null].filter(Boolean) as string[],
        channel: channel as "auto",
        notes: notes.trim() || null,
      }),
    onSuccess: (r) => {
      toast.success(
        r.status === "sent"
          ? `Request queued to ${r.recipient} over ${r.channel}`
          : "Request logged for manual follow-up — no reachable channel on file",
      );
      setNotes("");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not raise the request"),
  });

  const logReply = useMutation({
    mutationFn: (vars: { requestId: string; noResponse?: boolean }) =>
      logContactResponse({
        requestId: vars.requestId,
        email: vars.noResponse ? null : email.trim() || null,
        phone: vars.noResponse ? null : phone.trim() || null,
        notes: notes.trim() || null,
        noResponse: vars.noResponse,
      }),
    onSuccess: () => {
      toast.success("Response logged to the candidate audit trail");
      reset();
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not log the response"),
  });

  const openRequest = (timeline.data?.requests ?? []).find((r) =>
    ["pending", "awaiting_manual", "sent"].includes(r.status),
  );

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Contact recovery — {row?.full_name}</DialogTitle>
          <DialogDescription>
            Record details you have verified, or ask the candidate for what is missing. Every action is
            written to the candidate's audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              <Mail className="mr-1 h-3 w-3" /> {row?.email ?? "No email on file"}
            </Badge>
            <Badge variant="outline">
              <PhoneCall className="mr-1 h-3 w-3" /> {row?.phone ?? "No telephone on file"}
            </Badge>
            {row?.contact_request_status && (
              <Badge variant="secondary">{CONTACT_STATUS_LABEL[row.contact_request_status]}</Badge>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cr-email">Email address</Label>
            <Input
              id="cr-email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="candidate@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cr-phone">Telephone number</Label>
            <Input
              id="cr-phone"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+254 7XX XXX XXX"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="cr-notes">Notes for the audit trail</Label>
            <Textarea
              id="cr-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Where the detail came from, or what you asked the candidate for"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <AppButton
            analytics="rec_contact_record_submit"
            action="submit"
            disabled={save.isPending || (!email.trim() && !phone.trim())}
            onClick={() => save.mutate()}
            aria-label={`Save contact details for ${row?.full_name ?? "candidate"}`}
          >
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save contact details
          </AppButton>
          {openRequest && (
            <>
              <AppButton
                analytics="rec_contact_response_log"
                action="submit"
                variant="secondary"
                disabled={logReply.isPending || (!email.trim() && !phone.trim())}
                onClick={() => logReply.mutate({ requestId: openRequest.id })}
                aria-label="Log the candidate's reply to the open request"
              >
                Log candidate reply
              </AppButton>
              <AppButton
                analytics="rec_contact_response_none"
                action="submit"
                variant="ghost"
                disabled={logReply.isPending}
                onClick={() => logReply.mutate({ requestId: openRequest.id, noResponse: true })}
                aria-label="Mark the open request as unanswered"
              >
                Mark as unanswered
              </AppButton>
            </>
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <p className="text-sm font-medium">Request the missing details</p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={wantEmail} onCheckedChange={(v) => setWantEmail(v === true)} />
              Email address
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={wantPhone} onCheckedChange={(v) => setWantPhone(v === true)} />
              Telephone number
            </label>
            <div className="min-w-[16rem] space-y-1">
              <Label htmlFor="cr-channel" className="text-xs">Channel</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger id="cr-channel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <AppButton
              analytics="rec_contact_request_submit"
              action="submit"
              variant="outline"
              disabled={request.isPending || (!wantEmail && !wantPhone)}
              onClick={() => request.mutate()}
              aria-label={`Request missing contact details from ${row?.full_name ?? "candidate"}`}
            >
              {request.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send details request
            </AppButton>
          </div>
        </div>

        <Separator />

        <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border p-3 text-xs">
          <p className="flex items-center gap-2 font-medium">
            <History className="h-3.5 w-3.5" /> Contact and audit timeline
          </p>
          {timeline.isLoading && <Skeleton className="h-16 w-full" />}
          {(timeline.data?.requests ?? []).map((r) => (
            <p key={r.id} className="text-muted-foreground">
              {new Date(r.requested_at).toLocaleString()} · request #{r.attempt_no} ·{" "}
              {r.requested_fields.join(" + ")} · {r.channel} · {CONTACT_STATUS_LABEL[r.status]}
              {r.responded_at ? ` · answered ${new Date(r.responded_at).toLocaleString()}` : ""}
              {r.response_notes ? ` · “${r.response_notes}”` : ""}
            </p>
          ))}
          {(timeline.data?.audit ?? []).map((e) => (
            <p key={e.id} className="text-muted-foreground">
              {new Date(e.created_at).toLocaleString()} · {e.action.replace(/[._]/g, " ")}
            </p>
          ))}
          {!timeline.isLoading &&
            (timeline.data?.requests ?? []).length === 0 &&
            (timeline.data?.audit ?? []).length === 0 && (
              <p className="text-muted-foreground">No contact activity recorded yet.</p>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
