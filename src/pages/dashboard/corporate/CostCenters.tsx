import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface CostCenter {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  owner_user_id: string | null;
  status: string;
}

/**
 * Corporate Cost Centers admin — mirrors Departments.tsx pattern.
 * Reads/writes the existing public.cost_centers table (RLS: is_corp_or_finance).
 * No schema changes required.
 */
export default function CorporateCostCenters({ corporateId }: { corporateId: string | null }) {
  const [rows, setRows] = useState<CostCenter[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", parent_id: "", owner_user_id: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!corporateId) return;
    const { data, error } = await supabase
      .from("cost_centers")
      .select("id,code,name,parent_id,owner_user_id,status")
      .eq("corporate_id", corporateId)
      .order("code");
    if (error) { toast({ title: "Failed to load", description: error.message, variant: "destructive" }); return; }
    setRows((data ?? []) as CostCenter[]);
  };
  useEffect(() => { load(); }, [corporateId]);

  const create = async () => {
    if (!corporateId || !form.code || !form.name) {
      toast({ title: "Code and name are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("cost_centers").insert({
      corporate_id: corporateId,
      code: form.code.trim(),
      name: form.name.trim(),
      parent_id: form.parent_id || null,
      owner_user_id: form.owner_user_id || null,
    });
    setSaving(false);
    if (error) { toast({ title: "Failed to create", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Cost center created", description: form.code });
    setOpen(false);
    setForm({ code: "", name: "", parent_id: "", owner_user_id: "" });
    load();
  };

  const parentName = (id: string | null) => id ? (rows.find(r => r.id === id)?.code ?? "—") : "—";

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">Cost Centers</h2>
          <p className="text-sm text-muted-foreground">Segment corporate travel budgets by cost center. Codes must be unique per corporate.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="h-4 w-4" />New cost center</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create cost center</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Code *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="CC-100" /></div>
              <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sales — Nairobi" /></div>
              <div>
                <Label>Parent cost center</Label>
                <select
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  value={form.parent_id}
                  onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
                >
                  <option value="">— None —</option>
                  {rows.map(r => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
                </select>
              </div>
              <div><Label>Owner user id</Label><Input value={form.owner_user_id} onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })} placeholder="UUID (optional)" /></div>
            </div>
            <DialogFooter><Button onClick={create} disabled={saving}>{saving ? "Creating…" : "Create"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.code}</TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{parentName(r.parent_id)}</TableCell>
                <TableCell className="font-mono text-xs">{r.owner_user_id ?? "—"}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{r.status}</Badge></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No cost centers yet. Create one to segment travel spend.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
