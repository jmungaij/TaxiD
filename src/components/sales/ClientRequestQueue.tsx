/**
 * CLIENT REQUESTS — jobs companies sent us themselves from their portal link.
 *
 * The list is the live request register: a specialist sees the requests on their
 * own leads, sales leadership and admins see the whole desk. Status moves through
 * a database function that checks ownership and writes an append-only event, so a
 * status shown to the client can never be edited quietly.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Inbox } from "lucide-react";
import {
  CLIENT_REQUEST_STATUS_LABEL,
  SERVICE_TYPE_LABEL,
  listClientRequests,
  setClientRequestStatus,
  type ClientRequest,
  type ClientRequestStatus,
} from "@/lib/sales/leadDesk";
import { listMyLeads } from "@/lib/sales/pipeline";

const NEXT: { id: Exclude<ClientRequestStatus, "SUBMITTED">; label: string }[] = [
  { id: "RECEIVED", label: "Received" },
  { id: "IN_REVIEW", label: "In review" },
  { id: "QUOTED", label: "Quoted" },
  { id: "SCHEDULED", label: "Scheduled" },
  { id: "COMPLETED", label: "Completed" },
  { id: "DECLINED", label: "Declined" },
  { id: "CANCELLED", label: "Cancelled" },
];

const OPEN: ClientRequestStatus[] = ["SUBMITTED", "RECEIVED", "IN_REVIEW", "QUOTED"];

const dt = (v: string) =>
  new Date(v).toLocaleString("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  });

function RequestRow({
  request,
  organisation,
  onChanged,
}: {
  request: ClientRequest;
  organisation: string;
  onChanged: () => void;
}) {
  const [note, setNote] = React.useState("");
  const m = useMutation({
    mutationFn: (status: Exclude<ClientRequestStatus, "SUBMITTED">) =>
      setClientRequestStatus({ request_id: request.id, status, status_note: note.trim() || undefined }),
    onSuccess: () => {
      toast({
        title: "Status updated",
        description: `${request.request_ref} — the client sees this on their portal page.`,
      });
      setNote("");
      onChanged();
    },
    onError: (e: Error) =>
      toast({ title: "Not updated", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{organisation}</p>
          <p className="text-xs text-muted-foreground">
            {request.request_ref} · {SERVICE_TYPE_LABEL[request.service_type] ?? request.service_type} ·
            sent {dt(request.created_at)}
          </p>
        </div>
        <Badge variant="outline">{CLIENT_REQUEST_STATUS_LABEL[request.status]}</Badge>
      </div>

      <p className="mt-2 text-sm">
        {request.pickup_location} → {request.dropoff_location}
      </p>
      <p className="text-xs text-muted-foreground">
        {request.requested_date ? `Needed ${request.requested_date}` : "NO DATE GIVEN"}
        {request.requested_time ? ` · ${request.requested_time}` : ""}
        {request.passengers ? ` · ${request.passengers} passengers` : ""}
        {request.weight_kg ? ` · ${request.weight_kg} kg` : ""}
        {request.contact_phone ? ` · ${request.contact_phone}` : ""}
        {request.submitted_by_name ? ` · sent by ${request.submitted_by_name}` : ""}
      </p>
      {request.goods_description && (
        <p className="mt-1 text-sm text-muted-foreground">{request.goods_description}</p>
      )}
      {request.notes && <p className="mt-1 text-sm text-muted-foreground">{request.notes}</p>}
      {request.status_note && (
        <p className="mt-2 rounded-md border bg-muted/40 p-2 text-sm">
          Last said to the client: {request.status_note}
        </p>
      )}

      <div className="mt-3 space-y-2">
        <Input
          placeholder="What should the client see with this status? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          {NEXT.filter((n) => n.id !== request.status).map((n) => (
            <Button
              key={n.id}
              size="sm"
              variant="outline"
              disabled={m.isPending}
              onClick={() => m.mutate(n.id)}
            >
              {n.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ClientRequestQueue() {
  const qc = useQueryClient();
  const [openOnly, setOpenOnly] = React.useState(true);
  const requests = useQuery({ queryKey: ["client-requests"], queryFn: () => listClientRequests() });
  const leads = useQuery({ queryKey: ["sales-leads"], queryFn: listMyLeads });

  const onChanged = () => {
    void qc.invalidateQueries({ queryKey: ["client-requests"] });
    void qc.invalidateQueries({ queryKey: ["lead-desk-kpis"] });
  };

  if (requests.isLoading || leads.isLoading) return <Skeleton className="h-56 w-full" />;
  if (requests.error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">Client requests could not be read.</p>
          <p className="text-muted-foreground">{(requests.error as Error).message}</p>
        </CardContent>
      </Card>
    );

  const nameOf = new Map((leads.data ?? []).map((l) => [l.id, l.organisation_name]));
  const rows = (requests.data ?? []).filter((r) => !openOnly || OPEN.includes(r.status));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4" aria-hidden /> Client requests
        </CardTitle>
        <CardDescription>
          Jobs companies sent us themselves from their own portal link. Whatever status you set here is
          what they see on that page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={openOnly ? "secondary" : "ghost"} onClick={() => setOpenOnly(true)}>
            Open
          </Button>
          <Button size="sm" variant={!openOnly ? "secondary" : "ghost"} onClick={() => setOpenOnly(false)}>
            All
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {openOnly
              ? "NO OPEN CLIENT REQUESTS."
              : "NO CLIENT REQUESTS RECEIVED YET. Nothing has been submitted on your leads."}
          </p>
        ) : (
          rows.map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              organisation={nameOf.get(r.lead_id) ?? "Lead not visible to you"}
              onChanged={onChanged}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
