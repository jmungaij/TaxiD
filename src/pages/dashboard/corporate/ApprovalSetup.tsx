import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UserCheck, Plus, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { AsyncState } from "@/components/dashboard/AsyncState";

interface Employee { id: string; email: string; full_name: string | null; user_id: string | null; requires_approval: boolean | null }
interface Approver { id: string; approver_user_id: string; order_index: number; employee_id: string }

export default function CorporateApprovalSetup({ corporateId }: { corporateId: string | null }) {
  const [emps, setEmps] = useState<Employee[]>([]);
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [nameById, setNameById] = useState<Record<string, string>>({});
  const [dialogFor, setDialogFor] = useState<Employee | null>(null);
  const [newApproverId, setNewApproverId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!corporateId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [r1, r2] = await Promise.all([
        supabase.from("corporate_employees").select("id,email,full_name,user_id,requires_approval").eq("corporate_id", corporateId).eq("status", "active").order("full_name"),
        supabase.from("corporate_employee_approvers").select("id,approver_user_id,order_index,employee_id").eq("corporate_id", corporateId),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      setEmps((r1.data ?? []) as Employee[]);
      setApprovers((r2.data ?? []) as Approver[]);
      const map: Record<string, string> = {};
      (r1.data ?? []).forEach((emp: Employee) => { if (emp.user_id) map[emp.user_id] = emp.full_name || emp.email; });
      setNameById(map);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load approval setup.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [corporateId]);

  const toggleApproval = async (emp: Employee, val: boolean) => {
    const { error } = await supabase.from("corporate_employees").update({ requires_approval: val }).eq("id", emp.id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const addApprover = async () => {
    if (!dialogFor || !newApproverId || !corporateId) return;
    const existing = approvers.filter(a => a.employee_id === dialogFor.id);
    const { error } = await supabase.from("corporate_employee_approvers").insert({
      corporate_id: corporateId, employee_id: dialogFor.id, approver_user_id: newApproverId,
      order_index: existing.length + 1,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    setNewApproverId("");
    load();
  };

  const removeApprover = async (id: string) => {
    const { error } = await supabase.from("corporate_employee_approvers").delete().eq("id", id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const approversFor = (empId: string) =>
    approvers.filter(a => a.employee_id === empId).sort((x, y) => x.order_index - y.order_index);

  const eligibleApprovers = useMemo(
    () => emps.filter(e => e.user_id && (!dialogFor || e.id !== dialogFor.id)),
    [emps, dialogFor]
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2"><UserCheck className="h-5 w-5" />User Approval Setup</h2>
        <p className="text-sm text-muted-foreground">Decide who needs approval before booking, then assign one or more approvers per employee.</p>
      </div>
      <AsyncState
        loading={loading}
        error={error}
        isEmpty={!loading && !error && emps.length === 0}
        emptyTitle="No active employees"
        emptyMessage="Invite employees from the Employees tab before configuring approvals."
        onRetry={load}
      >
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Requires approval</TableHead>
              <TableHead>Approvers</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {emps.map(emp => {
                const list = approversFor(emp.id);
                return (
                  <TableRow key={emp.id}>
                    <TableCell>
                      <div className="font-medium">{emp.full_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{emp.email}</div>
                    </TableCell>
                    <TableCell>
                      <Switch checked={!!emp.requires_approval} onCheckedChange={(v) => toggleApproval(emp, v)} />
                    </TableCell>
                    <TableCell>
                      {list.length === 0 ? (
                        <span className="text-sm text-muted-foreground">None</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {list.map((a, i) => (
                            <Badge key={a.id} variant="secondary" className="gap-1">
                              {i + 1}. {nameById[a.approver_user_id] ?? a.approver_user_id.slice(0, 8)}
                              <button aria-label="Remove approver" onClick={() => removeApprover(a.id)}><X className="h-3 w-3" /></button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setDialogFor(emp)} className="gap-1"><Plus className="h-3 w-3" />Approver</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </AsyncState>


      <Dialog open={!!dialogFor} onOpenChange={(v) => { if (!v) setDialogFor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add approver for {dialogFor?.full_name || dialogFor?.email}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Approver</Label>
              <Select value={newApproverId} onValueChange={setNewApproverId}>
                <SelectTrigger><SelectValue placeholder="Pick a colleague with an account" /></SelectTrigger>
                <SelectContent>
                  {eligibleApprovers.map(e => (
                    <SelectItem key={e.id} value={e.user_id!}>{e.full_name || e.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {eligibleApprovers.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">Only employees who have signed in at least once can be approvers.</p>
              )}
            </div>
          </div>
          <DialogFooter><Button onClick={addApprover} disabled={!newApproverId}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
