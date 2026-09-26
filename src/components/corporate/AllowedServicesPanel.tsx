import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import ScopePicker, { useDepartments } from "./ScopePicker";
import { loadManagedRules, setManagedRule } from "@/lib/corporate/adminControls";

interface RideType { id: string; name: string }

export default function AllowedServicesPanel({ corporateId }: { corporateId: string | null }) {
  const { user } = useAuth();
  const depts = useDepartments(corporateId);
  const [scope, setScope] = useState("corporate");
  const [rideTypes, setRideTypes] = useState<RideType[]>([]);
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  const scopeArg = useMemo(
    () => ({ corporateId: corporateId ?? "", departmentId: scope === "corporate" ? null : scope }),
    [corporateId, scope],
  );

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("ride_types").select("id,name").eq("is_active", true).order("sort_order");
      setRideTypes((data ?? []) as RideType[]);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!corporateId) return;
    try {
      const { rules } = await loadManagedRules(scopeArg);
      const rule = rules.find((r) => r.rule_kind === "ride_type_allow");
      setAllowed(rule?.allowed_ride_types ?? null);
    } catch (e) {
      toast({ title: "Could not load settings", description: (e as Error).message, variant: "destructive" });
    }
  }, [corporateId, scopeArg]);

  useEffect(() => { load(); }, [load]);

  const restricted = allowed !== null;
  const toggleRestrict = (on: boolean) => setAllowed(on ? (allowed ?? rideTypes.map((r) => r.name)) : null);

  const save = async () => {
    if (!corporateId || !user) return;
    if (restricted && (allowed?.length ?? 0) === 0) {
      toast({ title: "Choose at least one service", description: "Otherwise no ride can be booked.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await setManagedRule(
        scopeArg, user.id, "ride_type_allow",
        restricted ? { allowed_ride_types: allowed } : null,
      );
      toast({ title: "Saved", description: "Requests for other services now go to an approver." });
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
        Choose which ride and vehicle types your team may book. Anything outside the list is sent to an approver.
      </p>

      <ScopePicker value={scope} onChange={setScope} depts={depts} />

      <Card className="p-5 space-y-5">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={restricted} onCheckedChange={(c) => toggleRestrict(Boolean(c))} aria-label="Restrict services" />
          Only allow selected services
        </label>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rideTypes.map((rt) => (
            <label key={rt.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                disabled={!restricted}
                checked={restricted ? (allowed ?? []).includes(rt.name) : true}
                onCheckedChange={(checked) =>
                  setAllowed((prev) => {
                    const base = prev ?? [];
                    return checked ? [...base, rt.name] : base.filter((n) => n !== rt.name);
                  })
                }
                aria-label={rt.name}
              />
              {rt.name}
            </label>
          ))}
          {rideTypes.length === 0 && <p className="text-sm text-muted-foreground">No services available yet.</p>}
        </div>

        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save services"}</Button>
      </Card>
    </div>
  );
}
