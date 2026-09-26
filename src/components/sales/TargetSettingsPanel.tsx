/**
 * TARGET SETTINGS — administrators only.
 *
 * A quota can be set for the whole sales team or for one salesperson, as a
 * monthly, quarterly or yearly figure, in a chosen currency, from a chosen date.
 * Setting a new quota never overwrites the old one: the previous amount is kept
 * with its own date range, so the history of who carried what target is intact
 * and closed months keep the quota they were judged against.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { History, Lock, Target } from "lucide-react";
import {
  TARGET_CURRENCIES,
  TARGET_PERIODS,
  TARGET_PERIOD_LABEL,
  closePeriod,
  fetchGovernance,
  setTarget,
  type TargetSettingPeriod,
} from "@/lib/sales/governance";

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: currency || "KES",
    maximumFractionDigits: 0,
  }).format(Number(amount ?? 0));

const monthStart = (offset = 0) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 10);
};

export default function TargetSettingsPanel() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-governance"],
    queryFn: fetchGovernance,
    retry: false,
  });

  const [person, setPerson] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [period, setPeriod] = React.useState<TargetSettingPeriod>("MONTH");
  const [currency, setCurrency] = React.useState("KES");
  const [from, setFrom] = React.useState(monthStart());
  const [note, setNote] = React.useState("");
  const [closeFrom, setCloseFrom] = React.useState(monthStart(-1));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["sales-governance"] });
    void qc.invalidateQueries({ queryKey: ["sales-target-dashboard"] });
  };

  const fail = (e: unknown) =>
    toast({
      title: "Not accepted",
      description: e instanceof Error ? e.message : "Unknown error",
      variant: "destructive",
    });

  const save = useMutation({
    mutationFn: () =>
      setTarget({
        scope: person ? "STAFF" : "COMPANY",
        staff_member_id: person || null,
        amount_kes: Number(amount),
        period,
        currency,
        effective_from: from,
        notes: note || undefined,
      }),
    onSuccess: (r) => {
      toast({
        title: "Target recorded",
        description: `${money(r.amount_kes, r.currency)} ${TARGET_PERIOD_LABEL[
          r.period as TargetSettingPeriod
        ].toLowerCase()}, from ${r.effective_from}. The previous amount is kept in the history.`,
      });
      setAmount("");
      setNote("");
      refresh();
    },
    onError: fail,
  });

  const close = useMutation({
    mutationFn: () => closePeriod(closeFrom),
    onSuccess: (r) =>
      toast({
        title: "Month closed",
        description: `${r.people} people fixed for ${r.period_start} to ${r.period_end}.`,
      }) && refresh(),
    onError: fail,
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (error || !data)
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Only an administrator can set sales targets.
        </CardContent>
      </Card>
    );

  const current = data.targets.filter((t) => t.is_active);
  const past = data.targets.filter((t) => !t.is_active);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" aria-hidden /> Set a target
          </CardTitle>
          <CardDescription>
            A salesperson's target is their own if one is set, otherwise the team target.
            A quarterly or yearly figure is spread evenly across its months for pacing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Label htmlFor="tgt-person" className="text-xs">
                Who it applies to
              </Label>
              <select
                id="tgt-person"
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              >
                <option value="">Everyone in sales (team target)</option>
                {data.roster.map((r) => (
                  <option key={r.staff_id} value={r.staff_id}>
                    {r.name ?? "Unnamed"} — {r.position ?? r.position_code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="tgt-amount" className="text-xs">
                Amount
              </Label>
              <Input
                id="tgt-amount"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="3000000"
              />
            </div>
            <div>
              <Label htmlFor="tgt-period" className="text-xs">
                Period
              </Label>
              <select
                id="tgt-period"
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={period}
                onChange={(e) => setPeriod(e.target.value as TargetSettingPeriod)}
              >
                {TARGET_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {TARGET_PERIOD_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="tgt-currency" className="text-xs">
                Currency
              </Label>
              <select
                id="tgt-currency"
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {TARGET_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="tgt-from" className="text-xs">
                Applies from
              </Label>
              <Input id="tgt-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Label htmlFor="tgt-note" className="text-xs">
                Reason (kept in the history)
              </Label>
              <Input
                id="tgt-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Annual review, promotion, new territory…"
              />
            </div>
          </div>
          <Button disabled={!amount || save.isPending} onClick={() => save.mutate()}>
            Record target
          </Button>
          <p className="text-xs text-muted-foreground">
            Closed months keep the target they were judged against; a new target only
            affects periods from the date above onwards.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Targets in force</CardTitle>
          <CardDescription>What each salesperson is measured against today.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <caption className="sr-only">Targets in force</caption>
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="p-2.5 font-semibold">Applies to</th>
                  <th className="p-2.5 text-right font-semibold">Amount</th>
                  <th className="p-2.5 font-semibold">Period</th>
                  <th className="p-2.5 font-semibold">From</th>
                </tr>
              </thead>
              <tbody>
                {current.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-3 text-muted-foreground">
                      No target is on the register yet.
                    </td>
                  </tr>
                )}
                {current.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-2.5">
                      {t.staff_name ??
                        (t.position_code ? `Position ${t.position_code}` : "Everyone in sales")}
                      {t.is_override && (
                        <Badge variant="outline" className="ml-2 font-normal">
                          Override
                        </Badge>
                      )}
                    </td>
                    <td className="p-2.5 text-right tabular-nums">
                      {money(t.amount_kes, t.currency)}
                    </td>
                    <td className="p-2.5">
                      {TARGET_PERIOD_LABEL[(t.period as TargetSettingPeriod) ?? "MONTH"] ?? t.period}
                    </td>
                    <td className="p-2.5">{t.effective_from}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Monthly figure each person is measured on
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {data.roster.map((r) => (
                <li key={r.staff_id} className="flex justify-between gap-3">
                  <span>
                    {r.name ?? "Unnamed"}{" "}
                    <span className="text-muted-foreground">· {r.position ?? r.position_code}</span>
                  </span>
                  <span className="tabular-nums">
                    {r.target_kes ? money(r.target_kes, r.currency ?? "KES") : "No target"}
                  </span>
                </li>
              ))}
              {data.roster.length === 0 && (
                <li className="text-muted-foreground">
                  Nobody currently holds one of the eligible sales positions.
                </li>
              )}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" aria-hidden /> Target history
          </CardTitle>
          <CardDescription>
            Superseded targets are kept for good, so past performance can always be read
            against the target that applied at the time.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <caption className="sr-only">Superseded targets</caption>
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="p-2.5 font-semibold">Applied to</th>
                <th className="p-2.5 text-right font-semibold">Amount</th>
                <th className="p-2.5 font-semibold">Period</th>
                <th className="p-2.5 font-semibold">In force</th>
                <th className="p-2.5 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {past.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-3 text-muted-foreground">
                    No target has been replaced yet.
                  </td>
                </tr>
              )}
              {past.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-2.5">
                    {t.staff_name ??
                      (t.position_code ? `Position ${t.position_code}` : "Everyone in sales")}
                  </td>
                  <td className="p-2.5 text-right tabular-nums">{money(t.amount_kes, t.currency)}</td>
                  <td className="p-2.5">
                    {TARGET_PERIOD_LABEL[(t.period as TargetSettingPeriod) ?? "MONTH"] ?? t.period}
                  </td>
                  <td className="p-2.5">
                    {t.effective_from} → {t.effective_to ?? "—"}
                  </td>
                  <td className="p-2.5 text-muted-foreground">{t.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-primary" aria-hidden /> Closed months
          </CardTitle>
          <CardDescription>
            A month is fixed automatically as soon as the next one begins — revenue, target,
            attainment and deal counts are written to a record that cannot change afterwards.
            Corrections are added as adjustments on top of it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="tgt-close" className="text-xs">
                Fix a month now
              </Label>
              <Input
                id="tgt-close"
                type="date"
                value={closeFrom}
                onChange={(e) => setCloseFrom(e.target.value)}
              />
            </div>
            <Button variant="secondary" disabled={close.isPending} onClick={() => close.mutate()}>
              Fix this month
            </Button>
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <caption className="sr-only">Closed months</caption>
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="p-2.5 font-semibold">Month</th>
                  <th className="p-2.5 font-semibold">Salesperson</th>
                  <th className="p-2.5 text-right font-semibold">Target</th>
                  <th className="p-2.5 text-right font-semibold">Revenue</th>
                  <th className="p-2.5 text-right font-semibold">Adjustments</th>
                  <th className="p-2.5 text-right font-semibold">Attainment</th>
                </tr>
              </thead>
              <tbody>
                {data.closures.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-3 text-muted-foreground">
                      No month has been closed yet.
                    </td>
                  </tr>
                )}
                {data.closures.map((c) => (
                  <tr key={`${c.period_start}-${c.staff_member_id}`} className="border-t">
                    <td className="p-2.5">{c.period_start.slice(0, 7)}</td>
                    <td className="p-2.5">{c.staff_name ?? "Unnamed"}</td>
                    <td className="p-2.5 text-right tabular-nums">{money(c.target_kes, "KES")}</td>
                    <td className="p-2.5 text-right tabular-nums">{money(c.revenue_kes, "KES")}</td>
                    <td className="p-2.5 text-right tabular-nums">
                      {c.adjustment_kes ? money(c.adjustment_kes, "KES") : "—"}
                    </td>
                    <td className="p-2.5 text-right tabular-nums">
                      {c.attainment_pct === null ? "—" : `${c.attainment_pct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
