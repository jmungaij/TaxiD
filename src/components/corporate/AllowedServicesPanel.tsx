import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import ScopePicker, { useDepartments } from "./ScopePicker";
import { loadManagedRules, setManagedRule } from "@/lib/corporate/adminControls";

interface RideType { id: string; name: string; code: string }
interface VClass { code: string; label: string; service_code: string; service_class: string; seats: number; accessible: boolean; example_models: string[]; ride_type_id: string | null; pricing_model: string }
const SERVICE_LABEL: Record<string, string> = { ride: "TaxiD Ride", airport: "TaxiD Airport", charter: "TaxiD Charter" };

export default function AllowedServicesPanel({ corporateId }: { corporateId: string | null }) {
  const { user } = useAuth();
  const depts = useDepartments(corporateId);
  const [scope, setScope] = useState("corporate");
  const [rideTypes, setRideTypes] = useState<RideType[]>([]);
  const [classes, setClasses] = useState<VClass[]>([]);
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  const scopeArg = useMemo(
    () => ({ corporateId: corporateId ?? "", departmentId: scope === "corporate" ? null : scope }),
    [corporateId, scope],
  );

  useEffect(() => {
    (async () => {
      const [{ data }, { data: vc }] = await Promise.all([
        supabase.from("ride_types").select("id,name,code").eq("is_active", true).order("sort_order"),
        supabase.from("mobility_vehicle_classes").select("*").order("sort_order"),
      ]);
      setRideTypes((data ?? []) as RideType[]);
      setClasses((vc ?? []) as VClass[]);
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
  const toggleRestrict = (on: boolean) => setAllowed(on ? (allowed ?? rideTypes.map((r) => r.code)) : null);

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

        {Object.keys(SERVICE_LABEL).map((svc) => {
          const list = classes.filter((c) => c.service_code === svc);
          if (!list.length) return null;
          return (
            <div key={svc} className="space-y-2">
              <h4 className="text-sm font-semibold">{SERVICE_LABEL[svc]}</h4>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map((vc) => {
                  const rt = rideTypes.find((r) => r.id === vc.ride_type_id);
                  const key = rt?.code;
                  const isAllowed = (allowed ?? []).some((a) => a.toLowerCase() === key || a === rt?.name);
                  return (
                    <label key={vc.code} className={`flex items-start gap-2 rounded-md border p-3 text-sm ${rt ? "" : "opacity-60"}`}>
                      <Checkbox
                        disabled={!restricted || !rt}
                        checked={rt ? (restricted ? isAllowed : true) : false}
                        onCheckedChange={(checked) => key && setAllowed((prev) => {
                          const base = (prev ?? []).filter((n) => n.toLowerCase() !== key && n !== rt?.name);
                          return checked ? [...base, key] : base;
                        })}
                        aria-label={vc.label}
                      />
                      <span>
                        <span className="font-medium">{vc.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {vc.service_class} · {vc.seats} seats{vc.accessible ? " · wheelchair access" : ""}
                        </span>
                        <span className="block text-xs text-muted-foreground">{vc.example_models.join(", ")}</span>
                        {!rt && <span className="block text-xs text-muted-foreground">{vc.pricing_model === "daily_charter" ? "Booked through charter day rates" : vc.pricing_model === "airport_zone" ? "Booked through airport zone rates" : "Not priced yet"}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
        {classes.length === 0 && <p className="text-sm text-muted-foreground">No services available yet.</p>}

        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save services"}</Button>
      </Card>
    </div>
  );
}
