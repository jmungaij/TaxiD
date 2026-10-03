import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Mail, UserPlus, ShieldOff, ShieldCheck, UserMinus, Trash2, Crown } from "lucide-react";
import { HrImportDialog } from "@/components/corporate/HrImportDialog";

interface Employee {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string;
  employee_code: string | null;
  department_id: string | null;
  monthly_cap_cents: number | null;
  per_trip_cap_cents: number | null;
  metadata?: unknown;
}

interface Dept { id: string; name: string }

type EmployeeStatus = "active" | "invited" | "removed" | "suspended";

export default function CorporateEmployees({
  corporateId,
  statusFilter,
}: {
  corporateId: string | null;
  /**
   * Optional filter for the staff list. Accepts a single status or an array of statuses.
   * Defaults to all statuses. Pass e.g. ["active", "invited"] to show both.
   */
  statusFilter?: EmployeeStatus | EmployeeStatus[];
}) {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    email: "", full_name: "", role: "corporate_employee", department_id: "",
    employee_code: "", monthly_cap: "", per_trip_cap: "",
  });

  const load = async () => {
    if (!corporateId) return;
    let q = supabase.from("corporate_employees").select("*").eq("corporate_id", corporateId).order("created_at", { ascending: false });
    if (statusFilter) {
      const statuses = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
      q = q.in("status", statuses);
    }
    const [{ data: emp }, { data: dp }] = await Promise.all([
      q,
      supabase.from("corporate_departments").select("id,name").eq("corporate_id", corporateId).eq("active", true),
    ]);
    setEmployees((emp ?? []) as Employee[]);
    setDepts((dp ?? []) as Dept[]);
  };

  useEffect(() => { load();   }, [corporateId, statusFilter]);

  const invite = async () => {
    if (!corporateId || !user) return;
    if (!form.email) { toast({ title: "Email required", variant: "destructive" }); return; }
    const { data: inv, error } = await supabase.from("corporate_invitations").insert({
      corporate_id: corporateId,
      email: form.email,
      full_name: form.full_name || null,
      role: form.role as "corporate_admin" | "corporate_manager" | "corporate_employee",
      department_id: form.department_id || null,
      invited_by: user.id,
    }).select().single();
    if (error) { toast({ title: "Invite failed", description: error.message, variant: "destructive" }); return; }

    // Pre-create employee record in 'invited' status
    await supabase.from("corporate_employees").insert({
      corporate_id: corporateId,
      email: form.email,
      full_name: form.full_name || null,
      role: form.role as "corporate_admin" | "corporate_manager" | "corporate_employee",
      department_id: form.department_id || null,
      employee_code: form.employee_code || null,
      monthly_cap_cents: form.monthly_cap ? Math.round(parseFloat(form.monthly_cap) * 100) : null,
      per_trip_cap_cents: form.per_trip_cap ? Math.round(parseFloat(form.per_trip_cap) * 100) : null,
      status: "invited",
      invited_at: new Date().toISOString(),
    });

    await supabase.from("corporate_policy_audit_log").insert({
      corporate_id: corporateId, actor_user_id: user.id, action: "employee.invite",
      target_type: "invitation", target_id: inv?.id, after: { email: form.email, role: form.role },
    });

    toast({ title: "Invitation sent", description: `Token: ${inv?.token.slice(0, 8)}…` });
    setOpen(false);
    setForm({ email: "", full_name: "", role: "corporate_employee", department_id: "", employee_code: "", monthly_cap: "", per_trip_cap: "" });
    load();
  };

  const setStatus = async (id: string, status: "active" | "suspended" | "removed" | "deleted") => {
    if (status === "deleted" && !confirm("Delete this employee permanently?")) return;
    const { data, error } = await supabase.rpc("corporate_employee_set_status", { _employee: id, _status: status });
    const r = data as { ok?: boolean; error?: string; message?: string } | null;
    if (error || !r?.ok) toast({ title: "Not changed", description: r?.message ?? r?.error ?? error?.message, variant: "destructive" });
    load();
  };

  const handover = async (id: string) => {
    if (!corporateId || !confirm("Hand the Director role (and super admin) to this employee? You will stop being Director.")) return;
    const { data } = await supabase.rpc("corporate_director_handover", { _corp: corporateId, _new_employee: id });
    const r = data as { ok?: boolean; error?: string } | null;
    toast({ title: r?.ok ? "Director replaced" : "Handover refused", description: r?.error, variant: r?.ok ? undefined : "destructive" });
    load();
  };
  const isDirector = (e: Employee) => !!(e.metadata as Record<string, unknown> | null)?.protected_director;
  const title = (e: Employee) => (e.metadata as Record<string, unknown> | null)?.title as string | undefined;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Employees</h2>
        <div className="flex gap-2">
        {corporateId && <HrImportDialog corporateId={corporateId} onDone={load} />}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><UserPlus className="h-4 w-4" /> Invite employee</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Invite a new employee</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Email *</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>Full name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="corporate_employee">Employee</SelectItem>
                    <SelectItem value="corporate_manager">Manager (approves rides)</SelectItem>
                    <SelectItem value="corporate_admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Department</Label>
                <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    {depts.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Employee code</Label><Input value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} /></div>
                <div><Label>Monthly cap (KES)</Label><Input type="number" value={form.monthly_cap} onChange={(e) => setForm({ ...form, monthly_cap: e.target.value })} /></div>
                <div><Label>Per-trip cap (KES)</Label><Input type="number" value={form.per_trip_cap} onChange={(e) => setForm({ ...form, per_trip_cap: e.target.value })} /></div>
              </div>
            </div>
            <DialogFooter><Button onClick={invite} className="gap-2"><Mail className="h-4 w-4" /> Send invitation</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead><TableHead>Name</TableHead><TableHead>Role</TableHead>
              <TableHead>Dept</TableHead><TableHead>Caps</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map(e => (
              <TableRow key={e.id}>
                <TableCell>{e.email}</TableCell>
                <TableCell>{e.full_name ?? "—"}{title(e) && <div className="text-xs text-muted-foreground">{title(e)}</div>}{isDirector(e) && <Badge className="mt-1">Director · protected</Badge>}</TableCell>
                <TableCell>{e.role.replace("corporate_", "")}</TableCell>
                <TableCell>{depts.find(d => d.id === e.department_id)?.name ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  {e.per_trip_cap_cents ? `KES ${(e.per_trip_cap_cents/100).toFixed(0)}/trip` : "—"}
                  {e.monthly_cap_cents ? ` · KES ${(e.monthly_cap_cents/100).toFixed(0)}/mo` : ""}
                </TableCell>
                <TableCell><Badge variant={e.status === "active" ? "default" : e.status === "invited" ? "secondary" : "destructive"}>{e.status}</Badge></TableCell>
                <TableCell className="space-x-1 whitespace-nowrap">
                  {isDirector(e) ? <span className="text-xs text-muted-foreground">Replace only by handover</span> : <>
                    {e.status !== "active" && <Button size="sm" variant="outline" title="Reactivate" onClick={() => setStatus(e.id, "active")}><ShieldCheck className="h-4 w-4" /></Button>}
                    {e.status === "active" && <Button size="sm" variant="outline" title="Suspend" onClick={() => setStatus(e.id, "suspended")}><ShieldOff className="h-4 w-4" /></Button>}
                    {e.status !== "removed" && <Button size="sm" variant="outline" title="Remove" onClick={() => setStatus(e.id, "removed")}><UserMinus className="h-4 w-4" /></Button>}
                    <Button size="sm" variant="outline" title="Delete" onClick={() => setStatus(e.id, "deleted")}><Trash2 className="h-4 w-4" /></Button>
                    {e.status === "active" && e.role === "corporate_admin" && <Button size="sm" variant="ghost" title="Make Director" onClick={() => handover(e.id)}><Crown className="h-4 w-4" /></Button>}
                  </>}
                </TableCell>
              </TableRow>
            ))}
            {employees.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No employees yet — invite your first.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
