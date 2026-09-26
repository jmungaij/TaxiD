/**
 * FULFILMENT READOUT for a booked lead.
 *
 * Everything here is read from the movement's own records — order, legs,
 * capacity request and proof of delivery. Nothing is inferred: where the
 * platform holds no record, the panel says so.
 */
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { fetchFulfilment } from "@/lib/sales/booking";

const KES = (n: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);

const nice = (s: string) => s.split("_").join(" ").toLowerCase();

export default function FulfilmentPanel({ orderId }: { orderId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-fulfilment", orderId],
    queryFn: () => fetchFulfilment(orderId),
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (error)
    return <p className="text-xs text-muted-foreground">{(error as Error).message}</p>;
  if (!data)
    return <p className="text-xs text-muted-foreground">NO MOVEMENT RECORD FOUND FOR THIS BOOKING.</p>;

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{data.order_number}</span>
        <Badge variant="outline">{nice(data.order_status)}</Badge>
        <span className="text-muted-foreground">
          Payment: {data.payment_status ? nice(data.payment_status) : "no record"}
        </span>
        <span className="text-muted-foreground">
          Value: {data.total_amount ? KES(data.total_amount) : "NOT PRICED"}
        </span>
      </div>

      <div>
        <p className="font-semibold uppercase tracking-wide text-muted-foreground">Journey</p>
        {data.legs.length === 0 ? (
          <p className="text-muted-foreground">No journey planned yet.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {data.legs.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{nice(l.status)}</Badge>
                <span>
                  {l.origin_label ?? "—"} → {l.destination_label ?? "—"}
                </span>
                {l.actual_departure && (
                  <span className="text-muted-foreground">
                    left {new Date(l.actual_departure).toLocaleString("en-KE")}
                  </span>
                )}
                {l.actual_arrival && (
                  <span className="text-muted-foreground">
                    arrived {new Date(l.actual_arrival).toLocaleString("en-KE")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="font-semibold uppercase tracking-wide text-muted-foreground">
          Vehicle allocation
        </p>
        {data.dispatch.length === 0 ? (
          <p className="text-muted-foreground">No capacity requested yet.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {data.dispatch.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{d.request_number}</span>
                <Badge variant="outline">{nice(d.status)}</Badge>
                {d.matching_status && (
                  <span className="text-muted-foreground">{nice(d.matching_status)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="font-semibold uppercase tracking-wide text-muted-foreground">
          Proof of delivery
        </p>
        {data.pod.length === 0 ? (
          <p className="text-muted-foreground">NOT YET SUBMITTED BY THE FLEET OWNER.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {data.pod.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{p.submission_reference}</span>
                <Badge variant="outline">{nice(p.state)}</Badge>
                <span className="text-muted-foreground">
                  {p.delivered_at
                    ? `delivered ${new Date(p.delivered_at).toLocaleString("en-KE")}`
                    : `submitted ${new Date(p.created_at).toLocaleString("en-KE")}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
