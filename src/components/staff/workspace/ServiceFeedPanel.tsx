/**
 * SERVICE EXECUTION FEED.
 *
 * Every trip, transfer and parcel as it happens, with its status. Operations
 * move a run along; a delay, failure or cancellation raises an issue against the
 * customer's account automatically, which is what the Exception Centre and the
 * account page then show. Completed runs are what the daily close counts.
 */
import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, PackageCheck, Plus, RefreshCw, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  EXCEPTION_STATUSES,
  EXECUTION_STATUSES,
  EXECUTION_STATUS_LABEL,
  SERVICE_TYPES,
  SERVICE_TYPE_LABEL,
  loadServiceFeed,
  recordServiceExecution,
  updateServiceStatus,
  type ExecutionStatus,
  type ServiceExecution,
  type ServiceFeed,
  type ServiceType,
  listUnmatchedOperations,
  syncOperations,
  type UnmatchedOperation,
} from "@/lib/sales/serviceFeed";
import { loadVolumeBoard } from "@/lib/sales/accountVolumes";

const KES = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);

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

function RecordServiceDialog({
  accounts,
  onDone,
}: {
  accounts: { account_id: string; account_name: string | null }[];
  onDone: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [accountId, setAccountId] = React.useState(accounts[0]?.account_id ?? "");
  const [serviceType, setServiceType] = React.useState<ServiceType>("STAFF_TRANSPORT");
  const [scheduledAt, setScheduledAt] = React.useState(new Date().toISOString().slice(0, 16));
  const [who, setWho] = React.useState("");
  const [origin, setOrigin] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [driver, setDriver] = React.useState("");
  const [vehicle, setVehicle] = React.useState("");
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (!accountId) return toast.error("Choose the customer this service ran for.");
    setBusy(true);
    try {
      const res = await recordServiceExecution({
        accountId,
        serviceType,
        scheduledAt: new Date(scheduledAt).toISOString(),
        passengerOrRecipient: who || undefined,
        origin: origin || undefined,
        destination: destination || undefined,
        driverLabel: driver || undefined,
        vehicleLabel: vehicle || undefined,
        valueKes: value ? Number(value) : null,
      });
      toast.success(`Recorded as ${res.execution_ref}.`);
      setOpen(false);
      setWho("");
      setOrigin("");
      setDestination("");
      setValue("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nothing was recorded.");
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Record a service
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a service run</DialogTitle>
          <DialogDescription>
            One row per trip, transfer or parcel. You move it along as it happens, and the daily close counts the
            completed ones.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Customer</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a customer" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.account_id} value={a.account_id}>
                    {a.account_name ?? "Unnamed customer"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Service</Label>
              <Select value={serviceType} onValueChange={(v) => setServiceType(v as ServiceType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {SERVICE_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="svc-when" className="text-xs">
                Due at
              </Label>
              <Input
                id="svc-when"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="svc-who" className="text-xs">
                Passenger or recipient
              </Label>
              <Input id="svc-who" value={who} onChange={(e) => setWho(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="svc-value" className="text-xs">
                Value in KSh
              </Label>
              <Input
                id="svc-value"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Leave blank if not agreed yet"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="svc-from" className="text-xs">
                From
              </Label>
              <Input id="svc-from" value={origin} onChange={(e) => setOrigin(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="svc-to" className="text-xs">
                To
              </Label>
              <Input id="svc-to" value={destination} onChange={(e) => setDestination(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="svc-driver" className="text-xs">
                Driver
              </Label>
              <Input id="svc-driver" value={driver} onChange={(e) => setDriver(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="svc-vehicle" className="text-xs">
                Vehicle
              </Label>
              <Input id="svc-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
            </div>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />} Record service
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({ row, onDone }: { row: ServiceExecution; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState<ExecutionStatus>(row.status);
  const [reason, setReason] = React.useState(row.exception_reason ?? "");
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (EXCEPTION_STATUSES.includes(status) && reason.trim().length < 5) {
      return toast.error("Say what went wrong — the customer will be told the same thing.");
    }
    setBusy(true);
    try {
      await updateServiceStatus({ executionId: row.execution_id, status, exceptionReason: reason.trim() || undefined });
      toast.success(
        EXCEPTION_STATUSES.includes(status)
          ? "Status updated and an issue raised on the customer's account."
          : "Status updated.",
      );
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The status was not changed.");
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Update status
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update {row.execution_ref}</DialogTitle>
          <DialogDescription>
            {row.account_name ?? "Customer"} · {SERVICE_TYPE_LABEL[row.service_type]} ·{" "}
            {new Date(row.scheduled_at).toLocaleString()}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Where it stands now</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ExecutionStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXECUTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {EXECUTION_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {EXCEPTION_STATUSES.includes(status) && (
            <div className="space-y-1">
              <Label htmlFor="svc-reason" className="text-xs">
                What happened
              </Label>
              <Textarea id="svc-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                This raises an issue on the customer's account straight away, for whoever owns them.
              </p>
            </div>
          )}
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />} Save status
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ServiceFeedPanel({ staffId }: { staffId?: string | null }) {
  const [feed, setFeed] = React.useState<ServiceFeed | null>(null);
  const [ownedAccounts, setOwnedAccounts] = React.useState<{ account_id: string; name: string }[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [unmatched, setUnmatched] = React.useState<UnmatchedOperation[]>([]);

  const bringInOperations = async () => {
    setSyncing(true);
    try {
      const res = await syncOperations();
      toast.success(
        `${res.rides_recorded} ride(s) and ${res.parcels_recorded} parcel order(s) brought in.` +
          (res.unmatched_operations > 0
            ? ` ${res.unmatched_operations} could not be matched to a customer and are listed for review.`
            : ""),
      );
      setUnmatched(res.unmatched_operations > 0 ? await listUnmatchedOperations() : []);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Operations could not be brought in.");
    }
    setSyncing(false);
  };

  const load = React.useCallback(async () => {
    try {
      setFeed(await loadServiceFeed(staffId ?? null));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The service feed could not be read.");
    }
    try {
      const board = await loadVolumeBoard();
      setOwnedAccounts(board.accounts.map((a) => ({ account_id: a.account_id, name: a.name })));
    } catch {
      // The customer list is only there to help pick one; the feed stands without it.
    }
    setLoading(false);
  }, [staffId]);

  React.useEffect(() => {
    void load();
    const channel = supabase
      .channel("workspace-service-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "commercial_service_executions" }, () =>
        void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  if (loading && !feed) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading what is running today…
      </div>
    );
  }
  if (error) return <p className="py-6 text-sm text-destructive">{error}</p>;
  if (!feed) return null;

  // Customers already carrying service come first; the rest of the person's own
  // accounts follow, so the very first service run can be recorded too.
  const seen = new Set(feed.by_account.map((a) => a.account_id));
  const accounts = [
    ...feed.by_account.map((a) => ({ account_id: a.account_id, account_name: a.account_name })),
    ...ownedAccounts
      .filter((a) => !seen.has(a.account_id))
      .map((a) => ({ account_id: a.account_id, account_name: a.name })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          What is actually running, updated as it happens. Delays, failures and cancellations raise an issue on the
          customer's account automatically.
        </p>
        <div className="flex items-center gap-2">
          <RecordServiceDialog accounts={accounts} onDone={() => void load()} />
          <Button size="sm" variant="secondary" onClick={() => void bringInOperations()} disabled={syncing}>
            {syncing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Truck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            Bring in operations
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Running today"
          value={String(feed.today.in_flight)}
          note={`${feed.today.total} booked in total today`}
        />
        <Figure
          label="Completed today"
          value={String(feed.today.completed)}
          note={`${feed.today.airport_transfers} transfers · ${feed.today.staff_transport} staff trips · ${feed.today.parcels} parcels`}
        />
        <Figure label="Value completed today" value={KES(feed.today.value_kes)} note="Feeds the daily close" />
        <Figure
          label="Exceptions today"
          value={String(feed.today.exceptions)}
          note={`${feed.month.exceptions} this month`}
        />
      </div>

      {unmatched.length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="text-sm font-semibold">
              Operations that could not be matched to a customer ({unmatched.length})
            </p>
            <p className="text-xs text-muted-foreground">
              These ran, but the person who booked them does not use the email domain of any customer account, so they
              are left here rather than attached to the wrong customer. Add the domain to the right account and bring
              operations in again.
            </p>
            {unmatched.slice(0, 12).map((u, i) => (
              <p key={i} className="rounded-md border px-3 py-2 text-xs">
                {u.kind === "RIDE" ? "Ride" : u.kind} {u.reference ?? "no reference"} · {u.status}
                {u.when ? ` · ${new Date(u.when).toLocaleString()}` : ""} ·{" "}
                {u.booked_by_domain ? `booked from ${u.booked_by_domain}` : "no booking email"} — {u.reason}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {feed.feed.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm font-semibold">Nothing recorded yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Record the first trip, transfer or parcel against one of your customers and it will appear here with its
              live status.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {feed.feed.map((r) => {
            const bad = EXCEPTION_STATUSES.includes(r.status);
            const Icon = r.status === "COMPLETED" ? CheckCircle2 : bad ? AlertTriangle : r.service_type === "PARCEL_DELIVERY" ? PackageCheck : Truck;
            return (
              <div
                key={r.execution_id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 ${
                  bad ? "border-destructive/40 bg-destructive/5" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {r.account_name ?? "Unnamed customer"} ·{" "}
                    {SERVICE_TYPE_LABEL[r.service_type]}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.execution_ref} · {new Date(r.scheduled_at).toLocaleString()}
                    {r.origin || r.destination ? ` · ${r.origin ?? "not stated"} to ${r.destination ?? "not stated"}` : ""}
                    {r.driver_label ? ` · ${r.driver_label}` : ""}
                    {r.vehicle_label ? ` · ${r.vehicle_label}` : ""}
                    {r.value_kes ? ` · ${KES(r.value_kes)}` : ""}
                  </p>
                  {r.exception_reason && (
                    <p className="mt-0.5 text-xs text-destructive">Recorded reason: {r.exception_reason}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={bad ? "destructive" : r.status === "COMPLETED" ? "default" : "secondary"} className="text-[10px]">
                    {EXECUTION_STATUS_LABEL[r.status]}
                  </Badge>
                  <StatusDialog row={r} onDone={() => void load()} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
