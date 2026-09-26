import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import ScopePicker, { useDepartments } from "./ScopePicker";
import { loadManagedRules, setManagedRule, type ManagedRule } from "@/lib/corporate/adminControls";

const DAYS = [
  { v: 1, label: "Mon" }, { v: 2, label: "Tue" }, { v: 3, label: "Wed" },
  { v: 4, label: "Thu" }, { v: 5, label: "Fri" }, { v: 6, label: "Sat" }, { v: 0, label: "Sun" },
];

const ruleOf = (rules: ManagedRule[], kind: string) => rules.find((r) => r.rule_kind === kind) ?? null;

export default function TripLimitsPanel({ corporateId }: { corporateId: string | null }) {
  const { user } = useAuth();
  const depts = useDepartments(corporateId);
  const [scope, setScope] = useState("corporate");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [perDay, setPerDay] = useState("");
  const [perMonth, setPerMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [days, setDays] = useState<number[]>([]);

  const scopeArg = useMemo(
    () => ({ corporateId: corporateId ?? "", departmentId: scope === "corporate" ? null : scope }),
    [corporateId, scope],
  );

  const load = useCallback(async () => {
    if (!corporateId) return;
    setLoading(true);
    try {
      const { rules } = await loadManagedRules(scopeArg);
      setPerDay(String(ruleOf(rules, "max_trips_per_day")?.max_trips ?? ""));
      setPerMonth(String(ruleOf(rules, "max_trips_per_month")?.max_trips ?? ""));
      const window = ruleOf(rules, "time_window");
      setFrom(window?.time_start?.slice(0, 5) ?? "");
      setTo(window?.time_end?.slice(0, 5) ?? "");
      setDays(ruleOf(rules, "day_of_week")?.days_of_week ?? []);
    } catch (e) {
      toast({ title: "Could not load settings", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [corporateId, scopeArg]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!corporateId || !user) return;
    if (from && to && from >= to) {
      toast({ title: "Check the hours", description: "The start time must be earlier than the end time.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const dayCount = perDay.trim() ? Math.max(1, parseInt(perDay, 10)) : null;
      const monthCount = perMonth.trim() ? Math.max(1, parseInt(perMonth, 10)) : null;
      await setManagedRule(scopeArg, user.id, "max_trips_per_day", dayCount ? { max_trips: dayCount } : null);
      await setManagedRule(scopeArg, user.id, "max_trips_per_month", monthCount ? { max_trips: monthCount } : null);
      await setManagedRule(
        scopeArg, user.id, "time_window",
        from && to ? { time_start: `${from}:00`, time_end: `${to}:00` } : null,
      );
      await setManagedRule(
        scopeArg, user.id, "day_of_week",
        days.length > 0 && days.length < 7 ? { days_of_week: days } : null,
      );
      toast({ title: "Saved", description: "Requests outside these limits now go to an approver." });
      load();
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!corporateId) return <p className="text-sm text-muted-foreground">No organisation linked to your account yet.</p>;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Set how many rides a team member may take and when they may travel. A request that goes over a limit is sent to
        an approver instead of being refused. Leave a field empty for no limit.
      </p>

      <ScopePicker value={scope} onChange={setScope} depts={depts} />

      <Card className="p-5 space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="rides-per-day">Rides per person per day</Label>
            <Input id="rides-per-day" inputMode="numeric" value={perDay} placeholder="No limit"
              onChange={(e) => setPerDay(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rides-per-month">Rides per person per month</Label>
            <Input id="rides-per-month" inputMode="numeric" value={perMonth} placeholder="No limit"
              onChange={(e) => setPerMonth(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hours-from">Booking allowed from</Label>
            <Input id="hours-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hours-to">Booking allowed until</Label>
            <Input id="hours-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Days travel is allowed</legend>
          <div className="flex flex-wrap gap-4">
            {DAYS.map((d) => (
              <label key={d.v} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={days.includes(d.v)}
                  onCheckedChange={(checked) =>
                    setDays((prev) => (checked ? [...prev, d.v] : prev.filter((x) => x !== d.v)))
                  }
                  aria-label={d.label}
                />
                {d.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Select none or all days to allow travel on any day.</p>
        </fieldset>

        <Button onClick={save} disabled={saving || loading}>
          {saving ? "Saving…" : "Save limits"}
        </Button>
      </Card>
    </div>
  );
}
