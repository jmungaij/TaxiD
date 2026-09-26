/**
 * FINANCE APPROVAL FOR NEW DRIVER ACCOUNTS.
 * Every approved driver lands here before any money can leave the platform.
 * Clearing, suspending and the payout block itself are enforced in the
 * database — this screen only shows the queue and records the decision.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  CLEARANCE_LABEL,
  clearanceMoney,
  decideDriverClearance,
  loadDriverClearanceConsole,
  type ClearanceRow,
  type ClearanceState,
} from "@/lib/provider/driverClearance";

const STATE_VARIANT: Record<ClearanceState, "default" | "secondary" | "outline" | "destructive"> = {
  PENDING: "secondary",
  CLEARED: "default",
  SUSPENDED: "destructive",
};

function ClearanceCard({
  row,
  onDecide,
  busy,
}: {
  row: ClearanceRow;
  onDecide: (state: ClearanceState, note: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = React.useState("");

  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {row.driver_name?.trim() || "Name not recorded"}
            {row.driver_code ? ` · ${row.driver_code}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {row.application_reference ? `Application ${row.application_reference} · ` : ""}
            {row.contact_phone ?? "no phone on file"}
            {row.contact_email ? ` · ${row.contact_email}` : ""}
          </p>
        </div>
        <Badge variant={STATE_VARIANT[row.state]}>{CLEARANCE_LABEL[row.state]}</Badge>
      </div>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <p>Ready to withdraw: {clearanceMoney(row.available_cents, row.currency)}</p>
        <p>Held until fulfilment: {clearanceMoney(row.held_cents, row.currency)}</p>
        <p>
          M-Pesa number:{" "}
          {row.payout_account_state === "VERIFIED"
            ? "verified"
            : row.payout_account_state
              ? row.payout_account_state.toLowerCase().replace(/_/g, " ")
              : "not saved yet"}
        </p>
      </div>

      {row.note ? <p className="text-xs">Last note: {row.note}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm"
          placeholder="Note (required to suspend)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {row.state !== "CLEARED" && (
          <Button size="sm" disabled={busy} onClick={() => onDecide("CLEARED", note)}>
            Clear for payouts
          </Button>
        )}
        {row.state !== "SUSPENDED" && (
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || !note.trim()}
            onClick={() => onDecide("SUSPENDED", note)}
          >
            Suspend payouts
          </Button>
        )}
        {row.state !== "PENDING" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide("PENDING", note)}>
            Send back to queue
          </Button>
        )}
      </div>

      {row.history.length > 0 && (
        <ul className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
          {row.history.slice(0, 4).map((h, i) => (
            <li key={i}>
              {new Date(h.created_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
              {h.action.toLowerCase().replace(/_/g, " ")}
              {h.state_to ? ` → ${h.state_to.toLowerCase()}` : ""}
              {h.note ? ` — ${h.note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function DriverClearancePanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<"PENDING" | "CLEARED" | "SUSPENDED" | "ALL">("PENDING");

  const { data, isLoading, error } = useQuery({
    queryKey: ["driver-finance-clearances"],
    queryFn: loadDriverClearanceConsole,
  });

  const decide = useMutation({
    mutationFn: (v: { id: string; state: ClearanceState; note: string }) =>
      decideDriverClearance(v.id, v.state, v.note || undefined),
    onSuccess: () => {
      toast({ title: "Decision recorded" });
      qc.invalidateQueries({ queryKey: ["driver-finance-clearances"] });
    },
    onError: (e: Error) =>
      toast({ title: "Not recorded", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  const rows = data?.clearances ?? [];
  const shown = filter === "ALL" ? rows : rows.filter((r) => r.state === filter);
  const s = data?.summary;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Driver payout approval</CardTitle>
        <CardDescription>
          A new driver account cannot withdraw any money until finance clears it here. Suspending an
          account stops its withdrawals immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList>
            <TabsTrigger value="PENDING">Waiting ({s?.pending ?? 0})</TabsTrigger>
            <TabsTrigger value="CLEARED">Cleared ({s?.cleared ?? 0})</TabsTrigger>
            <TabsTrigger value="SUSPENDED">Suspended ({s?.suspended ?? 0})</TabsTrigger>
            <TabsTrigger value="ALL">All ({s?.total ?? 0})</TabsTrigger>
          </TabsList>
        </Tabs>

        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing here. Driver accounts appear as soon as a driver application is approved.
          </p>
        ) : (
          <ul className="space-y-3">
            {shown.map((row) => (
              <ClearanceCard
                key={row.id}
                row={row}
                busy={decide.isPending}
                onDecide={(state, note) => decide.mutate({ id: row.id, state, note })}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
