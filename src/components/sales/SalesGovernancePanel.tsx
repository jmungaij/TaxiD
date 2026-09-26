/**
 * SALES GOVERNANCE CONSOLE — admin only.
 *
 * The monthly quota register, the response-time policies, the pacing settings
 * and month-end closing. Every amount shown is read from the register, and every
 * change is written by the database to the target audit trail with the person who
 * made it.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Gavel, Lock, Settings2, Target } from "lucide-react";
import {
  SLA_PROCESS_LABEL,
  closePeriod,
  fetchGovernance,
  saveEngineSettings,
  setTarget,
} from "@/lib/sales/governance";
import { KES } from "@/lib/staff/salesTarget";

const monthStart = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
const lastMonthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
};

export default function SalesGovernancePanel() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-governance"],
    queryFn: fetchGovernance,
    retry: false,
  });

  const [amount, setAmount] = React.useState("");
  const [person, setPerson] = React.useState("");
  const [from, setFrom] = React.useState(monthStart());
  const [closeFrom, setCloseFrom] = React.useState(lastMonthStart());

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

  const saveTarget = useMutation({
    mutationFn: () =>
      setTarget({
        scope: person ? "STAFF" : "COMPANY",
        staff_member_id: person || null,
        amount_kes: Number(amount),
        effective_from: from,
        notes: person ? "Individual quota set from the governance console" : "Company quota set from the governance console",
      }),
    onSuccess: () => {
      toast({ title: "Quota recorded" });
      setAmount("");
      refresh();
    },
    onError: fail,
  });

  const settings = useMutation({
    mutationFn: saveEngineSettings,
    onSuccess: () => {
      toast({ title: "Settings saved" });
      refresh();
    },
    onError: fail,
  });

  const close = useMutation({
    mutationFn: () => closePeriod(closeFrom),
    onSuccess: (r) => {
      toast({
        title: "Month closed",
        description: `${r.people} people locked for ${r.period_start} to ${r.period_end}`,
      });
      refresh();
    },
    onError: fail,
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (error || !data)
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Only an administrator can open the governance console.
        </CardContent>
      </Card>
    );

  const s = data.settings;
  const activeTargets = data.targets.filter((t) => t.is_active);

  return (
    <div className="space-y-4">
      {/* -------- quotas -------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" aria-hidden /> Monthly quotas
          </CardTitle>
          <CardDescription>
            A person's quota is their own if one is set, otherwise the one for their position,
            otherwise the company quota. Nothing is assumed anywhere in the app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Label htmlFor="gov-person" className="text-xs">
                Who it applies to
              </Label>
              <select
                id="gov-person"
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              >
                <option value="">Everyone in sales (company quota)</option>
                {data.roster.map((r) => (
                  <option key={r.staff_id} value={r.staff_id}>
                    {r.name ?? "Unnamed"} — {r.position ?? r.position_code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="gov-amount" className="text-xs">
                Monthly amount (KSh)
              </Label>
              <Input
                id="gov-amount"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="3000000"
              />
            </div>
            <div>
              <Label htmlFor="gov-from" className="text-xs">
                Applies from
              </Label>
              <Input id="gov-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
          </div>
          <Button
            disabled={!amount || saveTarget.isPending}
            onClick={() => saveTarget.mutate()}
          >
            Record quota
          </Button>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <caption className="sr-only">Active monthly quotas</caption>
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="p-2.5 font-semibold">Applies to</th>
                  <th className="p-2.5 text-right font-semibold">Monthly amount</th>
                  <th className="p-2.5 font-semibold">From</th>
                </tr>
              </thead>
              <tbody>
                {activeTargets.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-3 text-muted-foreground">
                      No quota is on the register yet.
                    </td>
                  </tr>
                )}
                {activeTargets.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-2.5">
                      {t.staff_name ?? (t.position_code ? `Position ${t.position_code}` : "Everyone in sales")}
                      {t.is_override && (
                        <Badge variant="outline" className="ml-2">
                          Override
                        </Badge>
                      )}
                    </td>
                    <td className="p-2.5 text-right tabular-nums">{KES(t.amount_kes)}</td>
                    <td className="p-2.5">{t.effective_from}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Who carries a quota
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {data.roster.map((r) => (
                <li key={r.staff_id} className="flex justify-between gap-3">
                  <span>
                    {r.name ?? "Unnamed"}{" "}
                    <span className="text-muted-foreground">· {r.position ?? r.position_code}</span>
                  </span>
                  <span className="tabular-nums">{r.target_kes ? KES(r.target_kes) : "No quota"}</span>
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

      {/* -------- response policies + settings -------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gavel className="h-4 w-4 text-primary" aria-hidden /> Response commitments
            </CardTitle>
            <CardDescription>
              How long each step is allowed to take. Clocks start and stop automatically as work moves.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.policies.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5">
                <span>{SLA_PROCESS_LABEL[p.process] ?? p.label ?? p.process}</span>
                <span className="flex items-center gap-2">
                  <Badge variant="outline">
                    {p.minutes >= 60 ? `${Math.round(p.minutes / 60)} hours` : `${p.minutes} minutes`}
                  </Badge>
                  {p.pause_on_customer && <Badge variant="outline">Pauses on the customer</Badge>}
                  {!p.is_active && <Badge variant="outline">Not in use</Badge>}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4 text-primary" aria-hidden /> Pacing and follow-up
            </CardTitle>
            <CardDescription>How the engine judges pace and what counts as overdue.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="bd-only" className="font-normal">
                Measure pace on working days only
              </Label>
              <Switch
                id="bd-only"
                checked={s.business_days_only}
                onCheckedChange={(v) => settings.mutate({ business_days_only: v })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="closing-soon" className="text-xs">
                  "Closing soon" window (days)
                </Label>
                <Input
                  id="closing-soon"
                  type="number"
                  min={1}
                  defaultValue={s.closing_soon_days}
                  onBlur={(e) =>
                    Number(e.target.value) !== s.closing_soon_days &&
                    settings.mutate({ closing_soon_days: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor="stale" className="text-xs">
                  Follow-up counts as overdue after (days)
                </Label>
                <Input
                  id="stale"
                  type="number"
                  min={1}
                  defaultValue={s.stale_followup_days}
                  onBlur={(e) =>
                    Number(e.target.value) !== s.stale_followup_days &&
                    settings.mutate({ stale_followup_days: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Eligible sales positions: {s.eligible_position_codes.join(", ")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* -------- month end -------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-primary" aria-hidden /> Month-end close
          </CardTitle>
          <CardDescription>
            Closing a month writes each person's final figures to a record that cannot be changed
            afterwards. Later corrections are recorded as adjustments on top of it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="close-from" className="text-xs">
                Month to close
              </Label>
              <Input
                id="close-from"
                type="date"
                value={closeFrom}
                onChange={(e) => setCloseFrom(e.target.value)}
              />
            </div>
            <Button variant="secondary" disabled={close.isPending} onClick={() => close.mutate()}>
              Close this month
            </Button>
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <caption className="sr-only">Closed months</caption>
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="p-2.5 font-semibold">Month</th>
                  <th className="p-2.5 font-semibold">Person</th>
                  <th className="p-2.5 text-right font-semibold">Quota</th>
                  <th className="p-2.5 text-right font-semibold">Revenue</th>
                  <th className="p-2.5 text-right font-semibold">Attainment</th>
                </tr>
              </thead>
              <tbody>
                {data.closures.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-3 text-muted-foreground">
                      No month has been closed yet.
                    </td>
                  </tr>
                )}
                {data.closures.map((c) => (
                  <tr key={`${c.period_start}-${c.staff_member_id}`} className="border-t">
                    <td className="p-2.5">{c.period_start.slice(0, 7)}</td>
                    <td className="p-2.5">{c.staff_name ?? "Unnamed"}</td>
                    <td className="p-2.5 text-right tabular-nums">{KES(c.target_kes)}</td>
                    <td className="p-2.5 text-right tabular-nums">{KES(c.revenue_kes)}</td>
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

      {/* -------- audit -------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change history</CardTitle>
          <CardDescription>Every quota and setting change, most recent first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 text-xs">
          {data.audit.length === 0 && <p className="text-muted-foreground">Nothing recorded yet.</p>}
          {data.audit.map((a, i) => (
            <p key={i} className="flex flex-wrap gap-2 text-muted-foreground">
              <span className="font-mono">{new Date(a.created_at).toLocaleString("en-KE")}</span>
              <span className="font-medium text-foreground">
                {a.action.split("_").join(" ").toLowerCase()}
              </span>
              {a.note && <span className="italic">“{a.note}”</span>}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
