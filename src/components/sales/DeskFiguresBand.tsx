/**
 * DESK FIGURES — the four numbers a specialist acts on.
 *
 * Leads being worked, meetings held, quotes shared, revenue won. Everything is
 * counted from the lead register, so a figure can always be traced to records.
 * Deeper desk analytics live on the leadership tabs, not here.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { KES, deskFigures, lossReasons, LOSS_REASON_LABEL } from "@/lib/sales/journey";

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function DeskFiguresBand({ showLosses = false }: { showLosses?: boolean }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["sales-desk-figures"], queryFn: deskFigures });
  const losses = useQuery({
    queryKey: ["sales-loss-reasons"],
    queryFn: lossReasons,
    enabled: showLosses,
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">Your figures could not be read.</p>
          <p className="text-muted-foreground">{(error as Error).message}</p>
        </CardContent>
      </Card>
    );

  const rows = data ?? [];
  if (rows.length === 0)
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          NO LEADS ON THIS DESK YET. Nothing has been counted on your behalf.
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <div key={r.sales_staff_id ?? r.staff_name} className="space-y-2">
          {rows.length > 1 && (
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">{r.staff_name}</p>
              {r.waiting_overdue > 0 && (
                <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                  {r.waiting_overdue} past its date
                </Badge>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure
              label="Leads working"
              value={String(r.leads_working)}
              hint={
                r.waiting_on_us + r.waiting_on_client > 0
                  ? `${r.waiting_on_us} on us · ${r.waiting_on_client} on clients`
                  : undefined
              }
            />
            <Figure label="Meetings held" value={String(r.meetings_held)} />
            <Figure
              label="Quotes shared"
              value={String(r.quotes_shared)}
              hint={r.contracts_signed > 0 ? `${r.contracts_signed} signed` : undefined}
            />
            <Figure
              label="Revenue won"
              value={r.won === 0 ? "NO WINS YET" : KES(Number(r.revenue_won_kes))}
              hint={r.won > 0 ? `${r.won} won · ${r.lost} lost` : undefined}
            />
          </div>
        </div>
      ))}

      {showLosses && (losses.data?.length ?? 0) > 0 && (
        <Card>
          <CardContent className="pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Why we lose
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {losses.data?.map((l) => (
                <li key={l.reason_code} className="flex justify-between gap-4">
                  <span>{LOSS_REASON_LABEL[l.reason_code] ?? l.reason_code}</span>
                  <span className="text-muted-foreground">
                    {l.leads_lost} lead{l.leads_lost === 1 ? "" : "s"}
                    {Number(l.value_lost_kes) > 0 ? ` · ${KES(Number(l.value_lost_kes))}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
