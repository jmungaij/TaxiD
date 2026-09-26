/**
 * Cross-corporate Booking Operations Queue.
 *
 * One control-tower screen where a super admin monitors every corporate trip
 * and approval in flight, spots exceptions (overdue approvals, breached ETAs,
 * failed bookings) and intervenes or escalates without leaving the page.
 *
 * Reads and interventions both go through `corporate-admin-console`, which
 * re-checks the caller's role and audits each write.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Download, Loader2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { invokeCorporateConsole } from "@/lib/corporate/manageAs";
import { ManageAsBanner } from "@/components/corporate/ManageAsBanner";
import StatCard from "@/components/common/StatCard";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  buildBookingQueue, filterQueue, queueTotals, QUEUE_FILTERS,
  type QueueFilterKey, type QueueRaw, type QueueRow,
} from "@/lib/corporate/bookingOps";

const money = (cents: number) => `KES ${Math.round(cents / 100).toLocaleString("en-KE")}`;
const when = (value?: string | null) =>
  value ? new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

const PHASE_VARIANT: Record<QueueRow["phase"], "default" | "secondary" | "destructive" | "outline"> = {
  awaiting_approval: "secondary",
  scheduled: "outline",
  in_progress: "default",
  completed: "outline",
  failed: "destructive",
};

const INTERVENTIONS = [
  { key: "escalate", label: "Escalate to ops" },
  { key: "flag_exception", label: "Flag exception" },
  { key: "cancel_request", label: "Request cancellation" },
  { key: "reassign_request", label: "Request reassignment" },
  { key: "resolve", label: "Mark resolved" },
] as const;

type InterventionKey = (typeof INTERVENTIONS)[number]["key"];

export default function CorporateBookingOps() {
  const [raw, setRaw] = useState<QueueRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilterKey>("exceptions");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<QueueRow | null>(null);
  const [intervention, setIntervention] = useState<InterventionKey>("escalate");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invokeCorporateConsole<QueueRaw>({ op: "booking_queue", limit: 300 });
      setRaw({
        employees: res.employees ?? [],
        accounts: res.accounts ?? [],
        approvals: res.approvals ?? [],
        bookings: res.bookings ?? [],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => (raw ? buildBookingQueue(raw) : []), [raw]);
  const totals = useMemo(() => queueTotals(rows), [rows]);
  const visible = useMemo(() => filterQueue(rows, filter, query), [rows, filter, query]);

  async function submitIntervention() {
    if (!target) return;
    setSaving(true);
    try {
      await invokeCorporateConsole({
        op: "booking_intervene",
        corporate_id: target.corporateId,
        booking_id: target.id,
        intervention,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast({ title: "Intervention recorded", description: `${target.reference} — ${intervention.replace("_", " ")}` });
      setTarget(null);
      setNote("");
      void load();
    } catch (e) {
      toast({ title: "Intervention failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function exportQueue() {
    if (!visible.length) {
      toast({ title: "Nothing to export", description: "Adjust the filters and try again." });
      return;
    }
    downloadCsv(
      `corporate-booking-queue-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(visible.map((r) => ({
        reference: r.reference,
        kind: r.kind,
        corporate: r.corporateName,
        requester: r.requester,
        status: r.status,
        phase: r.phase,
        pickup: r.pickup,
        dropoff: r.dropoff,
        amount_kes: Math.round(r.amountCents / 100),
        scheduled_for: r.scheduledFor ?? "",
        created_at: r.createdAt ?? "",
        age_minutes: r.ageMinutes,
        exceptions: r.exceptions.join(" | "),
      }))),
    );
  }

  return (
    <div className="space-y-6">
      <ManageAsBanner />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Booking operations queue</h1>
          <p className="text-sm text-muted-foreground">
            Every corporate trip and approval in flight, with exceptions surfaced first.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" data-analytics="admin.corporate_booking_ops.export_queue_csv" onClick={exportQueue}>
            <Download className="mr-2 h-4 w-4" /> Export booking queue CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard title="In queue" value={String(totals.total)} />
        <StatCard title="Awaiting approval" value={String(totals.awaitingApproval)} />
        <StatCard title="In progress" value={String(totals.inProgress)} />
        <StatCard title="Exceptions" value={String(totals.exceptions)} />
        <StatCard title="Live exposure" value={money(totals.exposureCents)} />
      </div>

      <Card>
        <CardHeader className="gap-4">
          <CardTitle className="text-base">Live queue</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {QUEUE_FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "default" : "outline"}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </Button>
            ))}
            <div className="relative ml-auto w-full max-w-xs">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search reference, corporate, route…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search booking queue"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-4 flex items-center gap-2 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4" /> {error}
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Corporate</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Exceptions</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  Loading queue…
                </TableCell></TableRow>
              )}
              {!loading && visible.length === 0 && (
                <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  Nothing matches this view — the queue is clear.
                </TableCell></TableRow>
              )}
              {visible.map((r) => (
                <TableRow key={`${r.kind}-${r.id}`}>
                  <TableCell className="font-medium">
                    {r.reference}
                    <span className="ml-2 text-xs uppercase text-muted-foreground">{r.kind}</span>
                  </TableCell>
                  <TableCell>
                    <Link className="underline-offset-2 hover:underline" to={`/dashboard/admin/corporates/${r.corporateId}`}>
                      {r.corporateName}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.requester}</div>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-sm">
                    {r.pickup} → {r.dropoff}
                  </TableCell>
                  <TableCell>
                    <Badge variant={PHASE_VARIANT[r.phase]}>{r.status.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] text-xs">
                    {r.exceptions.length === 0 ? (
                      <span className="text-muted-foreground">Healthy</span>
                    ) : (
                      <span className="flex items-start gap-1 text-destructive">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {r.exceptions.join("; ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{money(r.amountCents)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{when(r.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => { setTarget(r); setIntervention("escalate"); }}>
                      Intervene <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(open) => { if (!open) setTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Intervene on {target?.reference}</DialogTitle>
            <DialogDescription>
              {target?.corporateName} — every intervention is written to the corporate admin audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {INTERVENTIONS.map((i) => (
                <Button
                  key={i.key}
                  size="sm"
                  variant={intervention === i.key ? "default" : "outline"}
                  onClick={() => setIntervention(i.key)}
                >
                  {i.label}
                </Button>
              ))}
            </div>
            <Textarea
              placeholder="Internal note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Intervention note"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
            <Button onClick={() => void submitIntervention()} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record intervention
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
