import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Plus, Shield, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { CompanyPlacesPanel } from "@/components/corporate/CompanyPlacesPanel";
import { EmployeeGroupsPanel, type EmployeeGroup } from "@/components/corporate/EmployeeGroupsPanel";

interface Policy {
  id: string; name: string; description: string | null; scope: string;
  department_id: string | null; employee_id: string | null;
  priority: number; active: boolean; group_id?: string | null;
}

interface Rule {
  id: string; policy_id: string; rule_kind: string;
  allowed_ride_types: string[] | null; blocked_ride_types: string[] | null;
  max_fare_cents: number | null; max_distance_km: number | null;
  time_start: string | null; time_end: string | null;
  days_of_week: number[] | null;
  cap_cents: number | null; threshold_cents: number | null;
  severity: string; max_trips?: number | null;
}

const RULE_KINDS = [
  { v: "ride_type_block", label: "Block ride types" },
  { v: "ride_type_allow", label: "Allow only these ride types" },
  { v: "max_fare_per_trip", label: "Max fare per trip" },
  { v: "max_distance_km", label: "Max distance (km)" },
  { v: "time_window", label: "Allowed time window" },
  { v: "day_of_week", label: "Allowed days of week" },
  { v: "requires_approval_above", label: "Requires approval above amount" },
  { v: "monthly_spend_cap", label: "Monthly spend cap" },
  { v: "weekly_spend_cap", label: "Weekly spend cap" },
  { v: "rides_per_day_cap", label: "Max rides per day" },
  { v: "rides_per_week_cap", label: "Max rides per week" },
  { v: "rides_per_month_cap", label: "Max rides per month" },
  { v: "no_weekends", label: "No trips on weekends" },
  { v: "no_holidays", label: "No trips on company holidays" },
  { v: "pickup_approved_only", label: "Pickup must be an approved place" },
  { v: "dropoff_approved_only", label: "Destination must be approved" },
  { v: "airport_zone_block", label: "Block airport trips" },
  { v: "airport_zone_only", label: "Airport trips only" },
];
const RIDE_CAPS = ["rides_per_day_cap", "rides_per_week_cap", "rides_per_month_cap"];

export default function CorporatePolicies({ corporateId }: { corporateId: string | null }) {
  const { user } = useAuth();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [rulesByPolicy, setRulesByPolicy] = useState<Record<string, Rule[]>>({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", scope: "corporate", priority: "100", group_id: "none" });
  const [groups, setGroups] = useState<EmployeeGroup[]>([]);
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; policyId: string | null }>({ open: false, policyId: null });
  const [ruleForm, setRuleForm] = useState({
    rule_kind: "max_fare_per_trip", severity: "block",
    allowed_ride_types: "", blocked_ride_types: "",
    max_fare: "", max_distance: "", time_start: "", time_end: "",
    days_of_week: "", cap: "", threshold: "", max_trips: "",
  });

  const load = async () => {
    if (!corporateId) return;
    const { data: pol } = await supabase.from("corporate_ride_policies").select("*").eq("corporate_id", corporateId).order("priority");
    setPolicies((pol ?? []) as Policy[]);
    if (pol?.length) {
      const { data: rls } = await supabase.from("corporate_policy_rules").select("*").in("policy_id", pol.map(p => p.id));
      const grouped: Record<string, Rule[]> = {};
      (rls ?? []).forEach(r => { (grouped[r.policy_id] ||= []).push(r as Rule); });
      setRulesByPolicy(grouped);
    }
  };
  useEffect(() => { load(); }, [corporateId]);

  const createPolicy = async () => {
    if (!corporateId || !user || !form.name) return;
    const { data, error } = await supabase.from("corporate_ride_policies").insert({
      corporate_id: corporateId, name: form.name, description: form.description || null,
      scope: form.scope as "corporate" | "department" | "employee",
      priority: parseInt(form.priority) || 100, created_by: user.id,
      group_id: form.group_id === "none" ? null : form.group_id,
    }).select().single();
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    await supabase.from("corporate_policy_audit_log").insert({
      corporate_id: corporateId, actor_user_id: user.id, action: "policy.create",
      target_type: "policy", target_id: data.id, after: { name: form.name },
    });
    setOpen(false); setForm({ name: "", description: "", scope: "corporate", priority: "100", group_id: "none" }); load();
  };

  const toggleActive = async (p: Policy) => {
    await supabase.from("corporate_ride_policies").update({ active: !p.active }).eq("id", p.id);
    load();
  };

  const deletePolicy = async (id: string) => {
    if (!confirm("Delete this policy and all its rules?")) return;
    await supabase.from("corporate_ride_policies").delete().eq("id", id);
    load();
  };

  const addRule = async () => {
    if (!ruleDialog.policyId) return;
    const payload: Record<string, unknown> = {
      policy_id: ruleDialog.policyId,
      rule_kind: ruleForm.rule_kind,
      severity: ruleForm.severity,
    };
    if (ruleForm.allowed_ride_types) payload.allowed_ride_types = ruleForm.allowed_ride_types.split(",").map(s => s.trim());
    if (ruleForm.blocked_ride_types) payload.blocked_ride_types = ruleForm.blocked_ride_types.split(",").map(s => s.trim());
    if (ruleForm.max_fare) payload.max_fare_cents = Math.round(parseFloat(ruleForm.max_fare) * 100);
    if (ruleForm.max_distance) payload.max_distance_km = parseFloat(ruleForm.max_distance);
    if (ruleForm.time_start) payload.time_start = ruleForm.time_start;
    if (ruleForm.time_end) payload.time_end = ruleForm.time_end;
    if (ruleForm.days_of_week) payload.days_of_week = ruleForm.days_of_week.split(",").map(s => parseInt(s.trim()));
    if (ruleForm.cap) payload.cap_cents = Math.round(parseFloat(ruleForm.cap) * 100);
    if (ruleForm.max_trips) payload.max_trips = parseInt(ruleForm.max_trips);
    if (ruleForm.threshold) payload.threshold_cents = Math.round(parseFloat(ruleForm.threshold) * 100);

    const { error } = await supabase.from("corporate_policy_rules").insert(payload as never);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    setRuleDialog({ open: false, policyId: null });
    setRuleForm({ rule_kind: "max_fare_per_trip", severity: "block", allowed_ride_types: "", blocked_ride_types: "", max_fare: "", max_distance: "", time_start: "", time_end: "", days_of_week: "", cap: "", threshold: "", max_trips: "" });
    load();
  };

  const deleteRule = async (id: string) => {
    await supabase.from("corporate_policy_rules").delete().eq("id", id);
    load();
  };

  const ruleSummary = (r: Rule) => {
    switch (r.rule_kind) {
      case "ride_type_block": return `Block: ${r.blocked_ride_types?.join(", ")}`;
      case "ride_type_allow": return `Allow only: ${r.allowed_ride_types?.join(", ")}`;
      case "max_fare_per_trip": return `Max fare: KES ${(r.max_fare_cents ?? 0) / 100}`;
      case "max_distance_km": return `Max distance: ${r.max_distance_km} km`;
      case "time_window": return `Window: ${r.time_start}–${r.time_end}`;
      case "day_of_week": return `Days: ${r.days_of_week?.join(",")}`;
      case "requires_approval_above": return `Approval above: KES ${(r.threshold_cents ?? 0) / 100}`;
      case "monthly_spend_cap": return `Monthly cap: KES ${(r.cap_cents ?? 0) / 100}`;
      case "weekly_spend_cap": return `Weekly cap: KES ${(r.cap_cents ?? 0) / 100}`;
      case "rides_per_day_cap": return `Max ${r.max_trips} rides/day`;
      case "rides_per_week_cap": return `Max ${r.max_trips} rides/week`;
      case "rides_per_month_cap": return `Max ${r.max_trips} rides/month`;
      case "no_weekends": return "No weekend trips";
      case "no_holidays": return "No trips on company holidays";
      case "pickup_approved_only": return "Pickup must be an approved place";
      case "dropoff_approved_only": return "Destination must be approved";
      case "airport_zone_block": return "No airport trips";
      case "airport_zone_only": return "Airport trips only";
      default: return r.rule_kind;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold flex items-center gap-2"><Shield className="h-5 w-5" /> Ride Policies</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="h-4 w-4" /> New policy</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create policy</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div><Label>Scope</Label>
                <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="corporate">Whole corporate</SelectItem>
                    <SelectItem value="department">Department</SelectItem>
                    <SelectItem value="employee">Specific employee</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Applies to employee group</Label>
                <Select value={form.group_id} onValueChange={(v) => setForm({ ...form, group_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Everyone in scope</SelectItem>
                    {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name} only</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Priority (lower = evaluated first)</Label><Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={createPolicy}>Create policy</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {corporateId && <CompanyPlacesPanel corporateId={corporateId} />}
      {corporateId && <EmployeeGroupsPanel corporateId={corporateId} onGroupsChange={setGroups} />}

      <div className="space-y-3">
        {policies.map(p => (
          <Card key={p.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{p.name}</h3>
                  <Badge variant="outline">{p.scope}</Badge>
                  {p.group_id && <Badge>{groups.find(g => g.id === p.group_id)?.name ?? "group"}</Badge>}
                  <Badge variant="secondary">priority {p.priority}</Badge>
                </div>
                {p.description && <p className="text-sm text-muted-foreground mt-1">{p.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={p.active} onCheckedChange={() => toggleActive(p)} />
                <Button size="sm" variant="ghost" onClick={() => deletePolicy(p.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {(rulesByPolicy[p.id] ?? []).map(r => (
                <div key={r.id} className="flex items-center justify-between text-sm border rounded p-2 bg-muted/30">
                  <span><Badge variant={r.severity === "block" ? "destructive" : r.severity === "approval" ? "default" : "secondary"} className="mr-2">{r.severity}</Badge>{ruleSummary(r)}</span>
                  <Button size="sm" variant="ghost" onClick={() => deleteRule(r.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setRuleDialog({ open: true, policyId: p.id })} className="gap-1"><Plus className="h-3 w-3" /> Add rule</Button>
            </div>
          </Card>
        ))}
        {policies.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            No policies yet. Create one to enforce ride-type restrictions, fare caps, time windows, and approval thresholds.
          </Card>
        )}
      </div>

      <Dialog open={ruleDialog.open} onOpenChange={(o) => setRuleDialog({ open: o, policyId: ruleDialog.policyId })}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add rule</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Rule kind</Label>
              <Select value={ruleForm.rule_kind} onValueChange={(v) => setRuleForm({ ...ruleForm, rule_kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RULE_KINDS.map(k => <SelectItem key={k.v} value={k.v}>{k.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Severity</Label>
              <Select value={ruleForm.severity} onValueChange={(v) => setRuleForm({ ...ruleForm, severity: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="block">Block ride</SelectItem>
                  <SelectItem value="approval">Require approval</SelectItem>
                  <SelectItem value="warn">Warn only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {ruleForm.rule_kind === "ride_type_block" && (
              <div><Label>Blocked ride types (comma separated)</Label><Input value={ruleForm.blocked_ride_types} onChange={(e) => setRuleForm({ ...ruleForm, blocked_ride_types: e.target.value })} placeholder="luxury,suv" /></div>
            )}
            {ruleForm.rule_kind === "ride_type_allow" && (
              <div><Label>Allowed ride types (comma separated)</Label><Input value={ruleForm.allowed_ride_types} onChange={(e) => setRuleForm({ ...ruleForm, allowed_ride_types: e.target.value })} placeholder="economy,standard" /></div>
            )}
            {ruleForm.rule_kind === "max_fare_per_trip" && (
              <div><Label>Max fare (KES)</Label><Input type="number" value={ruleForm.max_fare} onChange={(e) => setRuleForm({ ...ruleForm, max_fare: e.target.value })} /></div>
            )}
            {ruleForm.rule_kind === "max_distance_km" && (
              <div><Label>Max distance (km)</Label><Input type="number" value={ruleForm.max_distance} onChange={(e) => setRuleForm({ ...ruleForm, max_distance: e.target.value })} /></div>
            )}
            {ruleForm.rule_kind === "time_window" && (
              <div className="grid grid-cols-2 gap-2">
                <div><Label>From</Label><Input type="time" value={ruleForm.time_start} onChange={(e) => setRuleForm({ ...ruleForm, time_start: e.target.value })} /></div>
                <div><Label>To</Label><Input type="time" value={ruleForm.time_end} onChange={(e) => setRuleForm({ ...ruleForm, time_end: e.target.value })} /></div>
              </div>
            )}
            {ruleForm.rule_kind === "day_of_week" && (
              <div><Label>Days (0=Sun..6=Sat, comma separated)</Label><Input value={ruleForm.days_of_week} onChange={(e) => setRuleForm({ ...ruleForm, days_of_week: e.target.value })} placeholder="1,2,3,4,5" /></div>
            )}
            {ruleForm.rule_kind === "requires_approval_above" && (
              <div><Label>Threshold (KES)</Label><Input type="number" value={ruleForm.threshold} onChange={(e) => setRuleForm({ ...ruleForm, threshold: e.target.value })} /></div>
            )}
            {(ruleForm.rule_kind === "monthly_spend_cap" || ruleForm.rule_kind === "weekly_spend_cap") && (
              <div><Label>Cap (KES)</Label><Input type="number" value={ruleForm.cap} onChange={(e) => setRuleForm({ ...ruleForm, cap: e.target.value })} /></div>
            )}
            {RIDE_CAPS.includes(ruleForm.rule_kind) && (
              <div><Label>Max business rides</Label><Input type="number" min={1} value={ruleForm.max_trips} onChange={(e) => setRuleForm({ ...ruleForm, max_trips: e.target.value })} /></div>
            )}
          </div>
          <DialogFooter><Button onClick={addRule}>Add rule</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
