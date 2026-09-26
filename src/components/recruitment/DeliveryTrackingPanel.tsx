/**
 * Delivery tracking for appointment letters and onboarding documents.
 *
 * Shows the full chain of custody for every sealed document sent to a
 * candidate — who sent it, when, when the provider confirmed delivery, when the
 * candidate read it, and when they signed it — backed by an append-only,
 * hash-chained audit trail that is verified server-side on demand.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2, Eye, FileSignature, Loader2, MailCheck, RefreshCw, Send, ShieldCheck, XCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import * as delivery from "@/lib/recruitment/deliveryTracking";
import * as letters from "@/lib/recruitment/letters";

const STATE_TONE: Record<string, string> = {
  pending: "border-muted text-muted-foreground",
  sent: "border-primary/30 text-primary",
  delivered: "border-info/50 text-info",
  read: "border-warning/50 text-warning",
  signed: "border-success/50 text-success",
  failed: "border-destructive/50 text-destructive",
};

const EVENT_ICON: Record<string, typeof Send> = {
  registered: ShieldCheck,
  sent: Send,
  delivered: MailCheck,
  read: Eye,
  signed: FileSignature,
  failed: XCircle,
};

/** Letter kinds that carry a tracked delivery obligation. */
const TRACKED_KINDS = new Set(["appointment_letter", "offer_letter", "onboarding_pack"]);

function StateBadge({ state }: { state: string }) {
  return (
    <Badge variant="outline" className={`text-[10px] ${STATE_TONE[state] ?? "border-primary/30 text-primary"}`}>
      {delivery.DELIVERY_STATE_LABEL[state] ?? state}
    </Badge>
  );
}

const when = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");

export default function DeliveryTrackingPanel() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState("");

  const deliveries = useQuery({
    queryKey: ["rec", "deliveries"],
    queryFn: () => delivery.listDeliveries(),
  });
  const requests = useQuery({
    queryKey: ["rec", "letters"],
    queryFn: () => letters.listLetterRequests(),
  });
  const events = useQuery({
    queryKey: ["rec", "deliveryEvents", openId],
    queryFn: () => delivery.listDeliveryEvents(openId!),
    enabled: Boolean(openId),
  });
  const chain = useQuery({
    queryKey: ["rec", "deliveryChain", openId],
    queryFn: () => delivery.verifyDeliveryChain(openId!),
    enabled: Boolean(openId),
  });

  const rows = deliveries.data ?? [];
  const health = useMemo(() => delivery.deliveryHealth(rows), [rows]);
  const active = rows.find((r) => r.id === openId) ?? null;

  // Only sealed, tracked letters that have no live delivery yet can be sent.
  const sendable = useMemo(() => {
    const tracked = new Set(rows.filter((r) => r.state !== "failed").map((r) => r.request_id));
    return (requests.data ?? []).filter(
      (r) => TRACKED_KINDS.has(r.comm_type)
        && ["generated", "queued", "sent", "delivered"].includes(r.state)
        && !tracked.has(r.id),
    );
  }, [requests.data, rows]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["rec"] });

  const send = useMutation({
    mutationFn: () => {
      if (!requestId) throw new Error("Choose the sealed document to send.");
      return delivery.sendDocument(requestId);
    },
    onSuccess: (res) => {
      toast.success(
        res.requires_signature
          ? "Document emailed — awaiting delivery confirmation and signature."
          : "Document emailed — awaiting delivery confirmation.",
      );
      setRequestId("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirm = useMutation({
    mutationFn: (id: string) => delivery.confirmDelivered({ delivery_id: id }),
    onSuccess: (res) => { toast.success(`Delivery confirmed — status ${res.state}.`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Tracked", value: health.total },
          { label: "Sent", value: health.sent },
          { label: "Delivered", value: health.delivered },
          { label: "Read", value: health.read },
          { label: "Signed", value: health.signed },
          { label: "Awaiting signature", value: health.awaiting_signature },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-2xl font-semibold text-foreground">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Send a sealed document</CardTitle>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="delivery-request">Appointment letter, offer or onboarding pack</Label>
              <Select value={requestId} onValueChange={setRequestId}>
                <SelectTrigger id="delivery-request">
                  <SelectValue placeholder={sendable.length ? "Choose a sealed document" : "No sealed documents awaiting delivery"} />
                </SelectTrigger>
                <SelectContent>
                  {sendable.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.document_ref} · {letters.COMM_TYPE_LABEL[r.comm_type] ?? r.comm_type} · {r.recipient_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => send.mutate()} disabled={send.isPending || !requestId}>
              {send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
              Email to candidate
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Read receipts and signatures are only ever asserted by the candidate's own action;
            delivery is only ever asserted by the email provider's confirmation.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery trail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {deliveries.isLoading && <Skeleton className="h-24 w-full" />}
          {!deliveries.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No documents have been sent yet.</p>
          )}
          {rows.map((row) => (
            <div key={row.id} className="rounded-md border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{row.recipient_name}</p>
                    <StateBadge state={row.state} />
                    {row.requires_signature && !row.signed_at && (
                      <Badge variant="outline" className="border-warning/50 text-[10px] text-warning">Signature due</Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {letters.COMM_TYPE_LABEL[row.kind] ?? row.kind} · {row.recipient_email}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {["sent"].includes(row.state) && (
                    <Button size="sm" variant="outline" onClick={() => confirm.mutate(row.id)} disabled={confirm.isPending}>
                      <MailCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                      Confirm delivery
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(row.id)}>Audit trail</Button>
                </div>
              </div>

              <Progress value={delivery.deliveryProgress(row.state)} className="mt-3 h-1.5" />

              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Sent</dt><dd className="text-foreground">{when(row.sent_at)}</dd></div>
                <div><dt className="text-muted-foreground">Delivered</dt><dd className="text-foreground">{when(row.delivered_at)}</dd></div>
                <div><dt className="text-muted-foreground">Read</dt><dd className="text-foreground">{when(row.first_read_at)}{row.read_count > 1 ? ` (${row.read_count}×)` : ""}</dd></div>
                <div><dt className="text-muted-foreground">Signed</dt><dd className="text-foreground">{row.signed_by_name ? `${when(row.signed_at)} · ${row.signed_by_name}` : when(row.signed_at)}</dd></div>
              </dl>

              {row.failure_reason && (
                <p className="mt-2 text-xs text-destructive">Failure: {row.failure_reason}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={Boolean(openId)} onOpenChange={(open) => !open && setOpenId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Delivery audit trail</DialogTitle>
            <DialogDescription>
              {active ? `${letters.COMM_TYPE_LABEL[active.kind] ?? active.kind} · ${active.recipient_name}` : ""}
            </DialogDescription>
          </DialogHeader>

          {chain.data && (
            <div className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
              chain.data.chain_intact ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5"
            }`}>
              {chain.data.chain_intact
                ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                : <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />}
              <span className="text-foreground">
                {chain.data.chain_intact
                  ? `Hash chain intact across ${chain.data.events} event${chain.data.events === 1 ? "" : "s"}.`
                  : "Hash chain broken — this trail has been tampered with."}
              </span>
            </div>
          )}

          <div className="max-h-[50vh] space-y-3 overflow-y-auto">
            {events.isLoading && <Skeleton className="h-20 w-full" />}
            {(events.data ?? []).map((e) => {
              const Icon = EVENT_ICON[e.event_type] ?? ShieldCheck;
              return (
                <div key={e.id} className="flex gap-3 rounded-md border border-border p-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium capitalize text-foreground">
                      {e.event_type} <span className="text-xs font-normal text-muted-foreground">by {e.actor_label}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{new Date(e.occurred_at).toLocaleString()}</p>
                    <p className="break-all font-mono text-[10px] text-muted-foreground">#{e.seq} · {e.hash.slice(0, 32)}…</p>
                  </div>
                </div>
              );
            })}
            {!events.isLoading && (events.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No events recorded.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
