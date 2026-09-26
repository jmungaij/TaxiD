/**
 * DAILY KPI CLOSE, INSIDE THE COMMERCIAL BOOK.
 *
 * The figures are computed by the database from the records themselves — what
 * moved today, where the month stands against the target register, and what is
 * outstanding. Nothing is typed in that a record could answer, so the close can
 * never disagree with the book. A figure with no underlying record is shown as
 * not stated, never as zero.
 *
 * Closing places the top recommended actions on tomorrow's list.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, RefreshCw, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { KES, fetchSalesDayClose, hasCommercialActivity, type SalesDayClose } from "@/lib/sales/dayClose";
import { AccountVolumesPanel } from "@/components/staff/workspace/AccountVolumesPanel";
import { KESc, loadBillingBoard, type BillingBoard } from "@/lib/sales/billing";
import { loadServiceFeed, type ServiceFeed } from "@/lib/sales/serviceFeed";

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

export function BookDailyClose() {
  const { toast } = useToast();
  const [data, setData] = React.useState<SalesDayClose | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [closing, setClosing] = React.useState(false);
  const [billing, setBilling] = React.useState<BillingBoard | null>(null);
  const [feed, setFeed] = React.useState<ServiceFeed | null>(null);

  const load = React.useCallback(async (materialise = false) => {
    setLoading(true);
    try {
      setData(await fetchSalesDayClose(null, materialise));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The daily close could not be read.");
    }
    // Billing and service execution are supporting reads: if either is not
    // available to this person the close still stands on its own records.
    const [b, f] = await Promise.allSettled([loadBillingBoard(null), loadServiceFeed(null)]);
    if (b.status === "fulfilled") setBilling(b.value);
    if (f.status === "fulfilled") setFeed(f.value);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const close = async () => {
    setClosing(true);
    try {
      const next = await fetchSalesDayClose(null, true);
      setData(next);
      toast({
        title: "Day closed",
        description: next
          ? `${next.tasks_placed} action(s) placed on tomorrow's list.`
          : "Your close was recorded.",
      });
    } catch (e) {
      toast({
        title: "Not closed",
        description: e instanceof Error ? e.message : "The close could not be recorded.",
        variant: "destructive",
      });
    }
    setClosing(false);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading today's figures…
      </div>
    );
  }

  if (error) {
    return <p className="py-6 text-sm text-destructive">{error}</p>;
  }

  if (!data) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        You have no commercial desk record, so there is no daily close to read for you.
      </p>
    );
  }

  const m = data.month;
  const gap = m.remaining_kes;
  const pct = m.attainment_pct;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            Daily close · {new Date(data.date).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {data.staff_name ?? "You"}
            {data.position ? ` · ${data.position}` : ""} — every figure below is read from your records.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Refresh
          </Button>
          <Button size="sm" onClick={() => void close()} disabled={closing}>
            {closing ? "Closing…" : (
              <>
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Close my day
              </>
            )}
          </Button>
        </div>
      </div>

      <Card className="border-primary/25 bg-primary/[0.03]">
        <CardContent className="space-y-2 pt-5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <Target className="h-3.5 w-3.5 text-primary" aria-hidden /> Month against target
          </div>
          <p className="text-2xl font-semibold tracking-tight">
            {KES(m.figures.revenue_won_kes)}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              of {m.target_kes == null ? "no target recorded for you" : KES(m.target_kes)}
            </span>
          </p>
          {pct != null && <Progress value={Math.min(100, pct)} className="h-2" />}
          <p className="text-sm">
            {gap == null
              ? "No monthly target is recorded against your position, so no gap can be stated."
              : gap <= 0
                ? "Target met for this month."
                : `${KES(gap)} still to find this month.`}
            {m.target_source ? ` Target source: ${m.target_source}.` : ""}
          </p>
        </CardContent>
      </Card>

      {/* Money billed and money in the bank, from the one invoice register. */}
      {billing && (
        <Card>
          <CardContent className="space-y-1 pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Billed and collected, from signed contracts
            </p>
            <p className="text-sm">
              <span className="font-semibold">{KESc(billing.collected_month_cents)}</span> collected this month
              {billing.collected_today_cents > 0 ? ` (${KESc(billing.collected_today_cents)} today)` : ""} ·{" "}
              {KESc(billing.invoiced_month_cents)} invoiced · {KESc(billing.outstanding_cents)} still outstanding
              {billing.overdue_cents > 0 ? `, ${KESc(billing.overdue_cents)} of it overdue` : ""}.
            </p>
            <p className="text-xs text-muted-foreground">
              {gap == null
                ? "Collected money counts towards a target once one is registered against your position."
                : `Counting money collected, ${KES(Math.max(0, gap - billing.collected_month_cents / 100))} remains on the month.`}
              {billing.contracts_awaiting_invoice.length > 0
                ? ` ${billing.contracts_awaiting_invoice.length} signed contract(s) have no invoice raised yet.`
                : ""}
            </p>
          </CardContent>
        </Card>
      )}

      {/* What actually ran today, customer by customer — the gap updates from these records. */}
      {feed && (
        <Card>
          <CardContent className="space-y-1 pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Service actually delivered today
            </p>
            <p className="text-sm">
              {feed.today.completed} completed of {feed.today.total} booked · {feed.today.airport_transfers} airport
              transfer(s), {feed.today.staff_transport} staff trip(s), {feed.today.parcels} parcel(s) ·{" "}
              {feed.today.value_kes > 0 ? `${KES(feed.today.value_kes)} of service value` : "no value recorded yet"}.
            </p>
            {feed.today.exceptions > 0 && (
              <p className="text-xs text-destructive">
                {feed.today.exceptions} service issue(s) raised today — they are waiting on you in the Exception centre.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <AccountVolumesPanel />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Recorded today" value={`${data.today.stages_advanced} move(s)`} note={`${data.today.leads_created} new lead(s), ${data.today.notes_recorded} note(s)`} />
        <Figure label="Won today" value={KES(data.today.revenue_won_kes)} note={`${data.today.won_count} deal(s)`} />
        <Figure label="Open pipeline" value={KES(m.figures.open_pipeline_kes)} note={`${m.figures.open_count} open · weighted ${KES(m.figures.weighted_pipeline_kes)}`} />
        <Figure
          label="Response clocks"
          value={`${data.sla.open} running`}
          note={`${data.sla.breached} breached, ${data.sla.approaching} approaching`}
        />
      </div>

      {data.next_actions.length > 0 && (
        <Card>
          <CardContent className="space-y-3 pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              What to do next, from your own records
            </p>
            {data.next_actions.slice(0, 6).map((a) => (
              <div key={a.lead_id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{a.organisation ?? "Customer not named"}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {a.stage}
                  </Badge>
                  {a.breached && (
                    <Badge variant="destructive" className="text-[10px]">
                      Overdue
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {a.value_kes == null ? "value not stated" : KES(a.value_kes)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{a.why}</p>
              </div>
            ))}
            <Button size="sm" variant="ghost" asChild className="px-0 text-primary">
              <Link to="/staff/sales/pipeline">Open my lead pipeline</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!hasCommercialActivity(data) && (
        <p className="text-sm text-muted-foreground">
          Nothing is recorded against you yet today, so the close reports no movement rather than a zero result.
        </p>
      )}
    </div>
  );
}

export default BookDailyClose;
