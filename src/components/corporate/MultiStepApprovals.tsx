import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, GitBranch, Plus, Timer, Trash2, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Emp { id: string; full_name: string | null; email: string | null }
interface Chain { id: string; name: string; min_fare_cents: number; active: boolean }
interface ChainStep { id: string; chain_id: string; step_no: number; approver_employee_id: string | null; stand_in_employee_id: string | null; deadline_minutes: number }
interface Step { id: string; subject_type: string; subject_id: string; step_no: number; approver_employee_id: string | null; stand_in_employee_id: string | null; due_at: string | null; status: string; escalated: boolean; decided_at: string | null; note: string | null }

const ERR: Record<string, string> = {
  MAKER_CHECKER: "The person who booked this trip can't approve it.",
  NOT_YOUR_STEP: "This step is assigned to someone else.",
  ALREADY_APPROVED_EARLIER_STEP: "A different person must approve each step.",
  NOT_PENDING: "This step has already been decided.",
};

/** Approval chains (setup) and the live multi-step approval queue. */
export function MultiStepApprovals({ corporateId }: { corporateId: string }) {
  const [emps, setEmps] = useState<Emp[]>([]);
  const [chains, setChains] = useState<Chain[]>([]);
  const [chainSteps, setChainSteps] = useState<ChainStep[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [subjects, setSubjects] = useState<Record<string, string>>({});
  const [cf, setCf] = useState({ name: "", min: "" });
  const [sf, setSf] = useState<Record<string, { approver: string; standin: string; mins: string }>>({});
  const fail = (m: string) => toast({ title: "Couldn't save", description: m, variant: "destructive" });
  const empName = (id: string | null) => (id ? emps.find((e) => e.id === id)?.full_name ?? "Employee" : "Any company manager");

  const load = async () => {
    await supabase.rpc("corporate_approvals_escalate", { _corp: corporateId });
    const [e, c, cs, s] = await Promise.all([
      supabase.from("corporate_employees").select("id,full_name,email").eq("corporate_id", corporateId).eq("status", "active").order("full_name"),
      supabase.from("corporate_approval_chains").select("*").eq("corporate_id", corporateId).order("min_fare_cents"),
      supabase.from("corporate_approval_chain_steps").select("*").eq("corporate_id", corporateId).order("step_no"),
      supabase.from("corporate_approval_steps").select("*").eq("corporate_id", corporateId).order("created_at", { ascending: false }).limit(100),
    ]);
    setEmps((e.data ?? []) as Emp[]); setChains((c.data ?? []) as Chain[]); setChainSteps((cs.data ?? []) as ChainStep[]);
    const st = (s.data ?? []) as Step[]; setSteps(st);
    const gIds = [...new Set(st.filter((x) => x.subject_type === "guest_booking").map((x) => x.subject_id))];
    const tIds = [...new Set(st.filter((x) => x.subject_type === "trip").map((x) => x.subject_id))];
    const labels: Record<string, string> = {};
    if (gIds.length) (await supabase.from("corporate_guest_bookings").select("id,reference,passenger_name,estimated_fare_cents").in("id", gIds)).data?.forEach((g) => { labels[g.id] = `${g.reference} · ${g.passenger_name} · KES ${(g.estimated_fare_cents / 100).toLocaleString()}`; });
    if (tIds.length) (await supabase.from("corporate_ride_approvals").select("id,pickup_address,dropoff_address,estimated_fare_cents").in("id", tIds)).data?.forEach((t) => { labels[t.id] = `Staff trip · ${t.pickup_address ?? ""} → ${t.dropoff_address ?? ""} · KES ${((t.estimated_fare_cents ?? 0) / 100).toLocaleString()}`; });
    setSubjects(labels);
  };
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [corporateId]);

  const addChain = async () => {
    const min = Math.round((parseFloat(cf.min) || 0) * 100);
    if (!cf.name.trim()) return;
    const { error } = await supabase.from("corporate_approval_chains").insert({ corporate_id: corporateId, name: cf.name.trim(), min_fare_cents: min });
    if (error) return fail(error.message);
    setCf({ name: "", min: "" }); load();
  };
  const addChainStep = async (chainId: string) => {
    const v = sf[chainId] ?? { approver: "none", standin: "none", mins: "60" };
    const next = (chainSteps.filter((s) => s.chain_id === chainId).length || 0) + 1;
    if (v.approver !== "none" && v.approver === v.standin) return fail("The stand-in must be a different person.");
    const { error } = await supabase.from("corporate_approval_chain_steps").insert({ chain_id: chainId, corporate_id: corporateId, step_no: next,
      approver_employee_id: v.approver === "none" ? null : v.approver, stand_in_employee_id: v.standin === "none" ? null : v.standin, deadline_minutes: parseInt(v.mins) || 60 });
    if (error) return fail(error.message);
    load();
  };
  const decide = async (id: string, approve: boolean) => {
    const note = approve ? null : prompt("Reason for rejecting (optional)") ?? null;
    const { data, error } = await supabase.rpc("corporate_approval_step_decide", { _step_id: id, _approve: approve, _note: note });
    const res = data as { ok?: boolean; error?: string; state?: string } | null;
    if (error || !res?.ok) return fail(ERR[res?.error ?? ""] ?? error?.message ?? res?.error ?? "Failed");
    toast({ title: res.state === "next_step" ? "Approved — sent to the next approver" : res.state === "approved" ? "Fully approved" : "Rejected" });
    load();
  };

  const pending = steps.filter((s) => s.status === "pending");
  const sel = (val: string, on: (v: string) => void, anyLabel: string) => (
    <Select value={val} onValueChange={on}>
      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="none">{anyLabel}</SelectItem>{emps.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name || e.email}</SelectItem>)}</SelectContent>
    </Select>
  );

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Timer className="h-4 w-4" /> Waiting for approval ({pending.length})</h3>
        {pending.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting.</p>}
        {pending.map((s) => {
          const overdue = s.due_at && new Date(s.due_at) < new Date();
          const total = steps.filter((x) => x.subject_id === s.subject_id).length;
          return (
            <div key={s.id} className="border rounded p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <div className="font-medium">{subjects[s.subject_id] ?? "Trip"}</div>
                <div className="text-muted-foreground">
                  Step {s.step_no} of {total} · {s.escalated ? <>passed to stand-in <b>{empName(s.stand_in_employee_id)}</b></> : empName(s.approver_employee_id)}
                  {s.due_at && <> · due {new Date(s.due_at).toLocaleString()}</>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {s.escalated && <Badge variant="secondary">Escalated</Badge>}
                {overdue && <Badge variant="destructive">Overdue</Badge>}
                <Button size="sm" onClick={() => decide(s.id, true)} className="gap-1"><Check className="h-3 w-3" /> Approve</Button>
                <Button size="sm" variant="outline" onClick={() => decide(s.id, false)} className="gap-1"><X className="h-3 w-3" /> Reject</Button>
              </div>
            </div>
          );
        })}
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><GitBranch className="h-4 w-4" /> Approval chains</h3>
        <p className="text-sm text-muted-foreground">Trips and guest bookings above a chain's amount go through its steps in order. Each step has a deadline; if it's missed, the stand-in can decide. The person who booked can never approve, and each step needs a different person.</p>
        <div className="flex gap-2">
          <Input placeholder="Chain name, e.g. Over KES 5,000" value={cf.name} onChange={(e) => setCf({ ...cf, name: e.target.value })} />
          <Input type="number" placeholder="Applies above (KES)" value={cf.min} onChange={(e) => setCf({ ...cf, min: e.target.value })} className="w-48" />
          <Button onClick={addChain} className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
        </div>
        {chains.map((c) => {
          const v = sf[c.id] ?? { approver: "none", standin: "none", mins: "60" };
          const set = (patch: Partial<typeof v>) => setSf({ ...sf, [c.id]: { ...v, ...patch } });
          return (
            <div key={c.id} className="border rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{c.name} <span className="text-muted-foreground font-normal">· above KES {(c.min_fare_cents / 100).toLocaleString()}</span></span>
                <Button size="sm" variant="ghost" onClick={async () => { await supabase.from("corporate_approval_chains").delete().eq("id", c.id); load(); }}><Trash2 className="h-3 w-3" /></Button>
              </div>
              {chainSteps.filter((s) => s.chain_id === c.id).map((s) => (
                <div key={s.id} className="text-sm flex items-center justify-between bg-muted/30 rounded p-2">
                  <span>Step {s.step_no}: {empName(s.approver_employee_id)} · stand-in {s.stand_in_employee_id ? empName(s.stand_in_employee_id) : "none"} · {s.deadline_minutes} min</span>
                  <Button size="sm" variant="ghost" onClick={async () => { await supabase.from("corporate_approval_chain_steps").delete().eq("id", s.id); load(); }}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
              <div className="grid grid-cols-4 gap-2">
                {sel(v.approver, (x) => set({ approver: x }), "Any manager")}
                {sel(v.standin, (x) => set({ standin: x }), "No stand-in")}
                <Input className="h-8" type="number" value={v.mins} onChange={(e) => set({ mins: e.target.value })} placeholder="Deadline (min)" />
                <Button size="sm" variant="outline" onClick={() => addChainStep(c.id)} className="gap-1"><Plus className="h-3 w-3" /> Add step</Button>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
