/**
 * DAILY MONEY FLOW — each day's money against that day's share of the target.
 *
 * Read from the records themselves, for any date range rather than a single
 * month: won, collected, service value delivered and the operational volumes the
 * specialists declared on their daily close.
 */
import * as React from "react";
import { CalendarDays, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { loadDailyFlow, type DailyFlow } from "@/lib/sales/dailyFlow";

const KES = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "Not stated"
    : new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);

const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" });

export default function DailyMoneyFlow() {
  const [flow, setFlow] = React.useState<DailyFlow | null>(null);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (range?: { from?: string; to?: string }) => {
      setBusy(true);
      try {
        const data = await loadDailyFlow(range);
        setFlow(data);
        setFrom((f) => f || data.from);
        setTo((t) => t || data.to);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The daily flow could not be read.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  const totals = (flow?.days ?? []).reduce(
    (acc, d) => ({
      recognised: acc.recognised + Number(d.recognised_kes ?? 0),
      declared: acc.declared + Number(d.declared_value_kes ?? 0),
      target: acc.target + Number(d.daily_target_kes ?? 0),
      services: acc.services + Number(d.services_completed ?? 0),
    }),
    { recognised: 0, declared: 0, target: 0, services: 0 },
  );

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Daily close, day by day
          </p>
          <div className="flex items-end gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-[138px] text-xs"
              aria-label="From date"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-[138px] text-xs"
              aria-label="To date"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => void load({ from: from || undefined, to: to || undefined })}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
              <span className="ml-1.5">Read</span>
            </Button>
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {flow && (
          <>
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                ["Recognised in range", KES(totals.recognised)],
                ["Target for those days", KES(totals.target)],
                ["Declared operations value", KES(totals.declared)],
                ["Services completed", String(totals.services)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border bg-muted/30 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="text-sm font-semibold">{value}</p>
                </div>
              ))}
            </div>

            {flow.days.length === 0 ? (
              <p className="text-xs text-muted-foreground">No days in this range.</p>
            ) : (
              <ul className="space-y-1.5">
                {flow.days.map((d) => (
                  <li
                    key={d.day}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
                  >
                    <span className="font-semibold">{day(d.day)}</span>
                    <span className="text-muted-foreground">
                      won {KES(Number(d.won_kes))} · collected {KES(Number(d.collected_cents) / 100)} · service{" "}
                      {KES(Number(d.service_value_kes))} · declared {KES(Number(d.declared_value_kes))}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">
                        {d.closes ?? 0}/{d.people_expected ?? 0} closed
                      </Badge>
                      {d.gap_kes === null ? (
                        <Badge variant="outline">No target set</Badge>
                      ) : d.gap_kes <= 0 ? (
                        <Badge>Day target met</Badge>
                      ) : (
                        <Badge variant="destructive">Short {KES(Number(d.gap_kes))}</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {flow.people.length > 0 && (
              <div className="grid gap-2 md:grid-cols-2">
                {flow.people.map((p) => (
                  <div key={p.staff_id} className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                    <p className="font-semibold">{p.full_name ?? "Name not stated"}</p>
                    <p className="text-muted-foreground">
                      {KES(Number(p.recognised_range_kes))} recognised · {KES(Number(p.declared_value_range_kes))}{" "}
                      declared · {p.closes_in_range}/{p.days_in_range} days closed
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
