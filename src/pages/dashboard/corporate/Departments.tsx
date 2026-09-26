import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Dept { id: string; name: string; code: string | null; cost_center: string | null; monthly_budget_cents: number | null; active: boolean }

export default function CorporateDepartments({ corporateId }: { corporateId: string | null }) {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", cost_center: "", monthly_budget: "" });

  const load = async () => {
    if (!corporateId) return;
    const { data } = await supabase.from("corporate_departments").select("*").eq("corporate_id", corporateId).order("name");
    setDepts((data ?? []) as Dept[]);
  };
  useEffect(() => { load(); }, [corporateId]);

  const create = async () => {
    if (!corporateId || !form.name) return;
    const { error } = await supabase.from("corporate_departments").insert({
      corporate_id: corporateId, name: form.name, code: form.code || null,
      cost_center: form.cost_center || null,
      monthly_budget_cents: form.monthly_budget ? Math.round(parseFloat(form.monthly_budget) * 100) : null,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    setOpen(false); setForm({ name: "", code: "", cost_center: "", monthly_budget: "" }); load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Departments</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="h-4 w-4" />New department</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create department</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
              <div><Label>Cost center</Label><Input value={form.cost_center} onChange={(e) => setForm({ ...form, cost_center: e.target.value })} /></div>
              <div><Label>Monthly budget (KES)</Label><Input type="number" value={form.monthly_budget} onChange={(e) => setForm({ ...form, monthly_budget: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={create}>Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Cost center</TableHead><TableHead>Monthly budget</TableHead></TableRow></TableHeader>
          <TableBody>
            {depts.map(d => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>{d.code ?? "—"}</TableCell>
                <TableCell>{d.cost_center ?? "—"}</TableCell>
                <TableCell>{d.monthly_budget_cents ? `KES ${(d.monthly_budget_cents/100).toLocaleString()}` : "—"}</TableCell>
              </TableRow>
            ))}
            {depts.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No departments yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
