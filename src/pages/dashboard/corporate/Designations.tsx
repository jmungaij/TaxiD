import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Award } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { AsyncState } from "@/components/dashboard/AsyncState";

type Period = "weekly" | "fortnightly" | "monthly";
interface Designation {
  id: string;
  title: string;
  department_id: string | null;
  expense_limit_cents: number;
  currency: string;
  limit_period: Period;
  active: boolean;
}
interface Dept { id: string; name: string }

export default function CorporateDesignations({ corporateId }: { corporateId: string | null }) {
  const [rows, setRows] = useState<Designation[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", department_id: "none", limit: "", period: "monthly" as Period });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!corporateId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [r1, r2] = await Promise.all([
        supabase.from("corporate_designations").select("*").eq("corporate_id", corporateId).order("title"),
        supabase.from("corporate_departments").select("id,name").eq("corporate_id", corporateId).eq("active", true).order("name"),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      setRows((r1.data ?? []) as Designation[]);
      setDepts((r2.data ?? []) as Dept[]);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load designations.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [corporateId]);

  const create = async () => {
    if (!corporateId || !form.title) return;
    const { error } = await supabase.from("corporate_designations").insert({
      corporate_id: corporateId,
      title: form.title,
      department_id: form.department_id === "none" ? null : form.department_id,
      expense_limit_cents: form.limit ? Math.round(parseFloat(form.limit) * 100) : 0,
      limit_period: form.period,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    setOpen(false);
    setForm({ title: "", department_id: "none", limit: "", period: "monthly" });
    load();
  };

  const deptName = (id: string | null) => depts.find(d => d.id === id)?.name ?? "—";

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2"><Award className="h-5 w-5" />Designation Management</h2>
          <p className="text-sm text-muted-foreground">Map job titles to departments and attach expense limits with a reset cycle.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="h-4 w-4" />New designation</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create designation</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Manager, Coordinator, CFO" /></div>
              <div>
                <Label>Department</Label>
                <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {depts.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Expense limit (KES)</Label><Input type="number" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} placeholder="0.00" /></div>
                <div>
                  <Label>Reset period</Label>
                  <Select value={form.period} onValueChange={(v) => setForm({ ...form, period: v as Period })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="fortnightly">Fortnightly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter><Button onClick={create}>Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <AsyncState
        loading={loading}
        error={error}
        isEmpty={!loading && !error && rows.length === 0}
        emptyTitle="No designations yet"
        emptyMessage="Create your first job title to attach expense limits and departments."
        onRetry={load}
      >
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Designation</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Expense limit</TableHead>
              <TableHead>Reset</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell>{deptName(r.department_id)}</TableCell>
                  <TableCell>{r.expense_limit_cents ? `${r.currency} ${(r.expense_limit_cents / 100).toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="capitalize">{r.limit_period}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </AsyncState>
    </div>
  );
}
