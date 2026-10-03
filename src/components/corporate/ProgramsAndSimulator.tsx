import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlaskConical, Layers, Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { CompanyPlace } from "./CompanyPlacesPanel";

interface Program { id: string; name: string; description: string | null; eligible_group_ids: string[]; allows_guests: boolean; default_cost_center: string | null; require_purpose: boolean; active_from: string | null; active_to: string | null; active: boolean }

/** Travel programs (why a trip happens) — distinct from groups (who travels). */
export function ProgramsPanel({ corporateId, groups }: { corporateId: string; groups: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<Program[]>([]);
  const [f, setF] = useState({ name: "", group: "all", cc: "", guests: true, from: "", to: "" });
  const load = () => supabase.from("corporate_programs").select("*").eq("corporate_id", corporateId).order("name").then(({ data }) => setRows((data ?? []) as Program[]));
  useEffect(() => { load(); }, [corporateId]);
  const add = async () => {
    if (!f.name.trim()) return;
    const { error } = await supabase.from("corporate_programs").insert({ corporate_id: corporateId, name: f.name.trim(), eligible_group_ids: f.group === "all" ? [] : [f.group],
      allows_guests: f.guests, default_cost_center: f.cc || null, active_from: f.from || null, active_to: f.to || null });
    if (error) return toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    setF({ name: "", group: "all", cc: "", guests: true, from: "", to: "" }); load();
  };
  const gname = (id: string) => groups.find((g) => g.id === id)?.name ?? "group";
  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold flex items-center gap-2"><Layers className="h-4 w-4" /> Travel programs</h3>
      <p className="text-sm text-muted-foreground">A program is the reason for travel, e.g. Executive Travel, Airport Travel, Guest Transportation, Night Travel or Event Transport. Choose who may use it; policies can then apply to one program only.</p>
      <div className="grid gap-2 md:grid-cols-6">
        <Input className="md:col-span-2" placeholder="Program name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Select value={f.group} onValueChange={(v) => setF({ ...f, group: v })}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All employees</SelectItem>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name} only</SelectItem>)}</SelectContent></Select>
        <Input placeholder="Default cost centre" value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} />
        <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Active from" />
        <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Active to" />
        <label className="flex items-center gap-2 text-sm md:col-span-2"><Switch checked={f.guests} onCheckedChange={(v) => setF({ ...f, guests: v })} /> Guests and clients allowed</label>
        <Button onClick={add} className="gap-1"><Plus className="h-4 w-4" /> Add program</Button>
      </div>
      <div className="space-y-1">
        {rows.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border rounded p-2">
            <span>
              <b>{p.name}</b>{" "}
              <span className="text-muted-foreground">· {p.eligible_group_ids.length ? p.eligible_group_ids.map(gname).join(", ") : "all employees"}{p.allows_guests ? " + guests" : ""}{p.default_cost_center ? ` · CC ${p.default_cost_center}` : ""}{p.active_from || p.active_to ? ` · ${p.active_from ?? "…"} to ${p.active_to ?? "…"}` : ""}</span>
            </span>
            <span className="flex items-center gap-1">
              <Switch checked={p.active} onCheckedChange={async () => { await supabase.from("corporate_programs").update({ active: !p.active }).eq("id", p.id); load(); }} />
              <Button size="sm" variant="ghost" onClick={async () => { if (confirm("Delete program and its program-only policies?")) { await supabase.from("corporate_programs").delete().eq("id", p.id); load(); } }}><Trash2 className="h-3 w-3" /></Button>
            </span>
          </div>
        ))}
        {rows.length === 0 && <span className="text-sm text-muted-foreground">No programs yet.</span>}
      </div>
    </Card>
  );
}

const DECISION: Record<string, { label: string; v: "default" | "secondary" | "destructive" }> = {
  COMPLIANT: { label: "Within policy", v: "default" }, WARNING: { label: "Allowed with a warning", v: "secondary" },
  EXCEPTION: { label: "Needs approval", v: "secondary" }, BLOCKED: { label: "Blocked", v: "destructive" },
};

/** "Test this policy" — runs the real server evaluator without booking anything. */
export function PolicySimulator({ corporateId }: { corporateId: string }) {
  const [emps, setEmps] = useState<{ id: string; full_name: string | null }[]>([]);
  const [programs, setPrograms] = useState<{ id: string; name: string }[]>([]);
  const [rides, setRides] = useState<{ id: string; name: string }[]>([]);
  const [places, setPlaces] = useState<CompanyPlace[]>([]);
  const [f, setF] = useState({ emp: "guest", program: "none", ride: "", when: "", plat: "", plng: "", dlat: "", dlng: "", fare: "" });
  const [res, setRes] = useState<{ fare_cents: number; distance_km: number; policy: { decision: string; reasons: { message: string; severity: string }[] } } | null>(null);
  useEffect(() => {
    supabase.from("corporate_employees").select("id,full_name").eq("corporate_id", corporateId).eq("status", "active").order("full_name").then(({ data }) => setEmps(data ?? []));
    supabase.from("corporate_programs").select("id,name").eq("corporate_id", corporateId).order("name").then(({ data }) => setPrograms(data ?? []));
    supabase.from("corporate_locations").select("*").eq("corporate_id", corporateId).eq("active", true).then(({ data }) => setPlaces((data ?? []) as CompanyPlace[]));
    supabase.from("ride_types").select("id,name").eq("is_active", true).order("sort_order").then(({ data }) => {
      const l = (data ?? []).map((r) => ({ id: r.id, name: String(r.name).replace(/^(SAFARID|TaxiD)\s+/i, "") })); setRides(l); if (l[0]) setF((x) => ({ ...x, ride: x.ride || l[0].id }));
    });
  }, [corporateId]);
  const pick = (which: "p" | "d", id: string) => { const pl = places.find((x) => x.id === id); if (!pl) return; setF((x) => which === "p" ? { ...x, plat: String(pl.lat), plng: String(pl.lng) } : { ...x, dlat: String(pl.lat), dlng: String(pl.lng) }); };
  const run = async () => {
    const { data, error } = await supabase.rpc("corporate_policy_simulate", {
      _corp: corporateId, _employee: f.emp === "guest" ? null : f.emp, _program: f.program === "none" ? null : f.program, _ride_type: f.ride,
      _at: f.when ? new Date(f.when).toISOString() : null, _plat: parseFloat(f.plat), _plng: parseFloat(f.plng), _dlat: parseFloat(f.dlat), _dlng: parseFloat(f.dlng),
      _fare_cents: f.fare ? Math.round(parseFloat(f.fare) * 100) : null,
    });
    const r = data as { ok?: boolean; error?: string } & typeof res;
    if (error || !r?.ok) return toast({ title: "Couldn't test", description: error?.message ?? (r?.error === "INVALID_INPUT" ? "Enter car type and both locations." : r?.error), variant: "destructive" });
    setRes(r);
  };
  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold flex items-center gap-2"><FlaskConical className="h-4 w-4" /> Test this policy</h3>
      <p className="text-sm text-muted-foreground">Try a trip against your live rules. Nothing is booked or charged.</p>
      <div className="grid gap-2 md:grid-cols-4">
        <div><Label>Traveller</Label><Select value={f.emp} onValueChange={(v) => setF({ ...f, emp: v })}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="guest">A guest (not an employee)</SelectItem>{emps.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Program</Label><Select value={f.program} onValueChange={(v) => setF({ ...f, program: v })}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">No program</SelectItem>{programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Car type</Label><Select value={f.ride} onValueChange={(v) => setF({ ...f, ride: v })}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{rides.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Date & time</Label><Input type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></div>
        {(["p", "d"] as const).map((w) => (
          <div key={w} className="md:col-span-2 space-y-1">
            <Label>{w === "p" ? "Pickup" : "Destination"}</Label>
            {places.length > 0 && <Select onValueChange={(id) => pick(w, id)}><SelectTrigger><SelectValue placeholder="Choose a company place…" /></SelectTrigger>
              <SelectContent>{places.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>}
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Latitude" value={w === "p" ? f.plat : f.dlat} onChange={(e) => setF({ ...f, [w === "p" ? "plat" : "dlat"]: e.target.value })} />
              <Input placeholder="Longitude" value={w === "p" ? f.plng : f.dlng} onChange={(e) => setF({ ...f, [w === "p" ? "plng" : "dlng"]: e.target.value })} />
            </div>
          </div>
        ))}
        <div><Label>Amount (KES, optional)</Label><Input type="number" value={f.fare} onChange={(e) => setF({ ...f, fare: e.target.value })} placeholder="TaxiD estimate" /></div>
        <div className="flex items-end"><Button onClick={run}>Test</Button></div>
      </div>
      {res && (
        <div className="border rounded p-3 text-sm space-y-1">
          <div className="flex items-center gap-2"><Badge variant={DECISION[res.policy.decision]?.v}>{DECISION[res.policy.decision]?.label}</Badge>
            <span className="text-muted-foreground">KES {(res.fare_cents / 100).toLocaleString()} · {res.distance_km} km</span></div>
          {res.policy.reasons.length === 0 ? <p>No rule was triggered.</p> : <ul className="list-disc pl-5">{res.policy.reasons.map((r, i) => <li key={i}>{r.message} <span className="text-muted-foreground">({r.severity})</span></li>)}</ul>}
        </div>
      )}
    </Card>
  );
}
