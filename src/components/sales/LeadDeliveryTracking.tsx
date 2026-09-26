/**
 * LEAD DELIVERY TRACKING — allocated leads and the movements they produced.
 *
 * The delivery state shown for each lead is read from the movement record, its
 * legs and its proof of delivery — not from a status somebody typed. A lead with
 * no movement booked says so plainly.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DELIVERED_ORDER_STATUSES,
  leadDeliveryTracking,
  type LeadDeliveryRow,
} from "@/lib/sales/leadDesk";
import { CONTACT_STATE_LABEL } from "@/lib/sales/leadDesk";

const FILTERS = [
  { id: "ALL", label: "All leads" },
  { id: "BOOKED", label: "Movement booked" },
  { id: "DELIVERED", label: "Delivered" },
  { id: "IN_PROGRESS", label: "Under way" },
  { id: "NO_MOVEMENT", label: "No movement yet" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const when = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }) : "NOT RECORDED";

function isDelivered(row: LeadDeliveryRow) {
  return Boolean(
    row.order_status && (DELIVERED_ORDER_STATUSES as readonly string[]).includes(row.order_status),
  );
}

function Row({ row }: { row: LeadDeliveryRow }) {
  const delivered = isDelivered(row);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              {row.organisation_name || "Organisation not stated"}
            </CardTitle>
            <CardDescription>
              {row.lead_ref || "No reference"} · {row.staff_name}
              {row.contact_email ? ` · ${row.contact_email}` : ""}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{CONTACT_STATE_LABEL[row.contact_state]}</Badge>
            <Badge variant="outline">{row.stage}</Badge>
            {row.order_status && (
              <Badge variant={delivered ? "default" : "secondary"}>{row.order_status}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!row.order_id ? (
          <p className="text-muted-foreground">
            NO MOVEMENT BOOKED FOR THIS LEAD YET
            {row.open_requests > 0
              ? ` — ${row.open_requests} client request(s) waiting on the desk.`
              : "."}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Movement
              </p>
              <p className="font-medium">{row.order_number || row.booking_ref || row.order_id}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Legs completed
              </p>
              <p className="font-medium">
                {row.legs_total > 0 ? `${row.legs_completed} of ${row.legs_total}` : "NONE PLANNED"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Delivered
              </p>
              <p className="font-medium">{when(row.delivered_at)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Payment
              </p>
              <p className="font-medium">{row.payment_status || "NOT RECORDED"}</p>
            </div>
          </div>
        )}

        <div className="rounded-md border p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Follow-up queue
          </p>
          {row.open_followups.length === 0 ? (
            <p className="mt-1 text-muted-foreground">NO OPEN FOLLOW-UP LOGGED.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {row.open_followups.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{f.next_action}</span>
                  <span className="text-xs text-muted-foreground">Due {f.due_date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          First contacted {when(row.first_outreach_at)} · Last reply {when(row.last_reply_at)} ·{" "}
          {row.requests_total} request(s) submitted
        </p>
      </CardContent>
    </Card>
  );
}

export default function LeadDeliveryTracking() {
  const [filter, setFilter] = React.useState<Filter>("ALL");
  const { data, isLoading, error } = useQuery({
    queryKey: ["lead-delivery-tracking"],
    queryFn: leadDeliveryTracking,
  });

  const leads = data?.leads ?? [];
  const shown = React.useMemo(() => {
    switch (filter) {
      case "BOOKED":
        return leads.filter((l) => l.order_id);
      case "DELIVERED":
        return leads.filter(isDelivered);
      case "IN_PROGRESS":
        return leads.filter((l) => l.order_id && !isDelivered(l));
      case "NO_MOVEMENT":
        return leads.filter((l) => !l.order_id);
      default:
        return leads;
    }
  }, [leads, filter]);

  const delivered = leads.filter(isDelivered).length;
  const booked = leads.filter((l) => l.order_id).length;

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">Delivery tracking could not be read.</p>
          <p className="text-muted-foreground">{(error as Error).message}</p>
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lead to delivery</CardTitle>
          <CardDescription>
            {leads.length} allocated lead(s) · {booked} with a movement booked · {delivered}{" "}
            delivered
            {leads.length > 0
              ? ` · ${Math.round((delivered / leads.length) * 1000) / 10}% converted`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="inline-flex flex-wrap rounded-lg border p-0.5">
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
          </div>
        </CardContent>
      </Card>

      {shown.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            NO LEADS MATCH THIS VIEW.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {shown.map((l) => (
            <Row key={l.lead_id} row={l} />
          ))}
        </div>
      )}
    </div>
  );
}
