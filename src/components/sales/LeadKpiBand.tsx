/**
 * LEAD KPI BAND — allocation, contact and reply performance per specialist.
 *
 * Figures are computed in the database from the lead register and the message
 * log. A reply rate is shown only once outreach exists; before then the panel
 * says so rather than printing a misleading 0%.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { deskKpis, formatWaitHours as hours, type DeskKpi } from "@/lib/sales/leadDesk";

function Metric({ label, value, tone }: { label: string; value: string; tone?: "warn" | "good" }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-semibold tracking-tight ${
          tone === "warn" ? "text-destructive" : tone === "good" ? "text-success" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function DeskCard({ desk }: { desk: DeskKpi }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{desk.staff_name}</CardTitle>
          <Badge variant="outline">{desk.allocated} allocated</Badge>
        </div>
        <CardDescription>
          {desk.contacted === 0
            ? "NO OUTREACH RECORDED YET"
            : `${desk.contacted} contacted · ${desk.replied} replied`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Metric label="Not contacted" value={String(desk.not_contacted)} />
        <Metric label="Awaiting reply" value={String(desk.awaiting_reply)} />
        <Metric label="Replies received" value={String(desk.replied)} tone={desk.replied ? "good" : undefined} />
        <Metric
          label="Reply rate"
          value={desk.reply_rate === null ? "NO OUTREACH YET" : `${desk.reply_rate}%`}
        />
        <Metric
          label="Avg wait for first reply"
          value={hours(desk.avg_hours_to_first_reply)}
        />
        <Metric
          label="Typical wait (median)"
          value={hours(desk.median_hours_to_first_reply)}
        />
        <Metric
          label="Waiting over 72h"
          value={String(desk.awaiting_over_72h ?? 0)}
          tone={(desk.awaiting_over_72h ?? 0) > 0 ? "warn" : undefined}
        />
        <Metric
          label="Longest wait now"
          value={hours(desk.longest_wait_hours)}
          tone={(desk.longest_wait_hours ?? 0) > 72 ? "warn" : undefined}
        />
        <Metric label="Open client requests" value={String(desk.open_client_requests ?? 0)} />
        <Metric label="Movements booked" value={String(desk.booked_movements ?? 0)} />
        <Metric
          label="Deliveries completed"
          value={String(desk.deliveries_completed ?? 0)}
          tone={(desk.deliveries_completed ?? 0) > 0 ? "good" : undefined}
        />
        <Metric label="Deliveries under way" value={String(desk.deliveries_in_progress ?? 0)} />
        <Metric
          label="Lead → delivery rate"
          value={
            desk.delivery_conversion_rate === null || desk.delivery_conversion_rate === undefined
              ? "NO DELIVERIES YET"
              : `${desk.delivery_conversion_rate}%`
          }
        />
        <Metric label="Follow-ups open" value={String(desk.followups_open)} />
        <Metric
          label="Follow-ups overdue"
          value={String(desk.followups_overdue)}
          tone={desk.followups_overdue > 0 ? "warn" : undefined}
        />
        <Metric label="Not interested" value={String(desk.not_interested)} />
        {desk.no_email > 0 && (
          <Metric label="No email on file" value={String(desk.no_email)} tone="warn" />
        )}
      </CardContent>
    </Card>
  );
}

export default function LeadKpiBand() {
  const { data, isLoading, error } = useQuery({ queryKey: ["lead-desk-kpis"], queryFn: deskKpis });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">Lead performance could not be read.</p>
          <p className="text-muted-foreground">{(error as Error).message}</p>
        </CardContent>
      </Card>
    );

  const desks = data?.desks ?? [];
  if (desks.length === 0)
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          NO LEADS ALLOCATED. Nothing has been generated on your behalf.
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-4">
      {data?.scope === "DESK" && (
        <p className="text-sm text-muted-foreground">
          Whole desk shown, one card per specialist holding leads.
        </p>
      )}
      {desks.map((d) => (
        <DeskCard key={d.sales_staff_id ?? d.staff_name} desk={d} />
      ))}
    </div>
  );
}
