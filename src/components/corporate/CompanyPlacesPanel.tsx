import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Hash, MapPin, Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export interface CompanyPlace { id: string; name: string; kind: "pickup" | "destination" | "airport"; address: string | null; lat: number; lng: number; radius_m: number; active: boolean }
const KIND_LABEL = { pickup: "Pickup place", destination: "Destination", airport: "Airport zone" } as const;

/** Approved pickup places, destinations and airport zones, plus required booking codes. */
export function CompanyPlacesPanel({ corporateId }: { corporateId: string }) {
  const [places, setPlaces] = useState<CompanyPlace[]>([]);
  const [f, setF] = useState({ name: "", kind: "pickup", address: "", lat: "", lng: "", radius: "300" });
  const [req, setReq] = useState({ require_project: false, require_client: false, require_po: false, require_accounting: false });
  const fail = (m: string) => toast({ title: "Couldn't save", description: m, variant: "destructive" });

  const load = async () => {
    const [p, r] = await Promise.all([
      supabase.from("corporate_locations").select("*").eq("corporate_id", corporateId).order("kind").order("name"),
      supabase.from("corporate_booking_requirements").select("*").eq("corporate_id", corporateId).maybeSingle(),
    ]);
    setPlaces((p.data ?? []) as CompanyPlace[]);
    if (r.data) setReq({ require_project: r.data.require_project, require_client: r.data.require_client, require_po: r.data.require_po, require_accounting: r.data.require_accounting });
  };
  useEffect(() => { load(); }, [corporateId]);

  const add = async () => {
    const lat = parseFloat(f.lat), lng = parseFloat(f.lng);
    if (!f.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return fail("Enter a name and valid map coordinates.");
    const { error } = await supabase.from("corporate_locations").insert({ corporate_id: corporateId, name: f.name.trim(), kind: f.kind, address: f.address || null, lat, lng, radius_m: parseInt(f.radius) || 300 });
    if (error) return fail(error.message);
    setF({ name: "", kind: f.kind, address: "", lat: "", lng: "", radius: "300" }); load();
  };
  const toggle = async (p: CompanyPlace) => { await supabase.from("corporate_locations").update({ active: !p.active }).eq("id", p.id); load(); };
  const remove = async (id: string) => { await supabase.from("corporate_locations").delete().eq("id", id); load(); };
  const setRequirement = async (k: keyof typeof req, v: boolean) => {
    const next = { ...req, [k]: v }; setReq(next);
    const { error } = await supabase.from("corporate_booking_requirements").upsert({ corporate_id: corporateId, ...next });
    if (error) fail(error.message);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><MapPin className="h-4 w-4" /> Approved places & airport zones</h3>
        <p className="text-sm text-muted-foreground">Add a policy rule "Pickup must be an approved place", "Destination must be approved", "Block airport trips" or "Airport trips only" to enforce these. Bookings that break a blocking rule are refused.</p>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Name, e.g. HQ main gate" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="col-span-2" placeholder="Address (optional)" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          <Input placeholder="Latitude, e.g. -1.3192" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} />
          <Input placeholder="Longitude, e.g. 36.9278" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} />
          <Input type="number" placeholder="Radius (m)" value={f.radius} onChange={(e) => setF({ ...f, radius: e.target.value })} />
          <Button onClick={add} className="gap-1"><Plus className="h-4 w-4" /> Add place</Button>
        </div>
        <div className="space-y-1">
          {places.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm border rounded p-2 gap-2">
              <span className="truncate"><Badge variant="outline" className="mr-2">{KIND_LABEL[p.kind]}</Badge>{p.name} · {p.radius_m} m</span>
              <span className="flex items-center gap-1"><Switch checked={p.active} onCheckedChange={() => toggle(p)} /><Button size="sm" variant="ghost" onClick={() => remove(p.id)}><Trash2 className="h-3 w-3" /></Button></span>
            </div>
          ))}
          {places.length === 0 && <span className="text-sm text-muted-foreground">No places yet.</span>}
        </div>
      </Card>
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Hash className="h-4 w-4" /> Required booking codes</h3>
        <p className="text-sm text-muted-foreground">Codes your finance team needs on every guest, client and hotel booking.</p>
        {([["require_project", "Project code"], ["require_client", "Client code"], ["require_po", "Purchase-order (PO) number"], ["require_accounting", "Accounting / GL code"]] as const).map(([k, l]) => (
          <div key={k} className="flex items-center justify-between"><Label>{l}</Label><Switch checked={req[k]} onCheckedChange={(v) => setRequirement(k, v)} /></div>
        ))}
      </Card>
    </div>
  );
}
