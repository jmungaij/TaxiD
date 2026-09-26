import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Users, Building2, User as UserIcon, History, Upload, Download, Tag } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { auditedExport } from "@/lib/exportAudit";
import { AppButton } from "@/components/nav/AppButton";
import { recordDiagnostic } from "@/lib/runtime/diagnostics";

const trackEvent = (name: string, payload: Record<string, unknown>) => {
  recordDiagnostic({
    category: "API",
    operation: `expense_code.${name}`,
    message: `Expense code event: ${name}`,
    metadata: payload,
  });
};

interface ExpenseCode {
  id: string;
  expense_code: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  ride_cap: number | null;
  rides_used: number;
  active: boolean;
  created_at: string;
}

interface Scope {
  id: string;
  expense_code_id: string;
  level: "CORPORATE" | "GROUP" | "EMPLOYEE";
  department_id: string | null;
  employee_id: string | null;
}

interface Dept { id: string; name: string }
interface Employee { id: string; email: string; full_name: string | null }
interface AuditRow { id: string; expense_code: string; action: string; level: string | null; created_for: string | null; result: string | null; created_at: string }

export default function CorporateExpenseCodes({ corporateId }: { corporateId: string | null }) {
  const { user } = useAuth();
  const [codes, setCodes] = useState<ExpenseCode[]>([]);
  const [scopes, setScopes] = useState<Record<string, Scope[]>>({});
  const [depts, setDepts] = useState<Dept[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [showAudit, setShowAudit] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ expense_code: "", description: "", start_time: "", end_time: "", ride_cap: "" });

  const [allocOpen, setAllocOpen] = useState<{ open: boolean; code: ExpenseCode | null }>({ open: false, code: null });
  const [allocForm, setAllocForm] = useState({ level: "CORPORATE" as "CORPORATE" | "GROUP" | "EMPLOYEE", target: "" });

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const writeAudit = useCallback(async (action: string, payload: Record<string, unknown>, result: string, level?: string, createdFor?: string | null, codeName?: string) => {
    if (!corporateId) return;
    await supabase.from("corporate_expense_code_audit").insert({
      corporate_id: corporateId,
      expense_code: codeName ?? (payload.expense_code as string) ?? "",
      action,
      level: (level ?? null) as "CORPORATE" | "GROUP" | "EMPLOYEE" | null,
      created_for: createdFor ?? null,
      actor_user_id: user?.id ?? null,
      payload: payload as never,
      result,
    });
    trackEvent("corporate.expense_code." + action, { corporate_id: corporateId, expense_code: codeName ?? payload.expense_code, result });
  }, [corporateId, user]);

  const load = useCallback(async () => {
    if (!corporateId) return;
    const [{ data: c }, { data: s }, { data: d }, { data: e }] = await Promise.all([
      supabase.from("corporate_expense_codes").select("*").eq("corporate_id", corporateId).order("created_at", { ascending: false }),
      supabase.from("corporate_expense_code_scopes").select("*").eq("corporate_id", corporateId),
      supabase.from("corporate_departments").select("id,name").eq("corporate_id", corporateId).eq("active", true),
      supabase.from("corporate_employees").select("id,email,full_name").eq("corporate_id", corporateId).eq("status", "active"),
    ]);
    setCodes((c ?? []) as ExpenseCode[]);
    const grouped: Record<string, Scope[]> = {};
    (s ?? []).forEach((row) => {
      const sc = row as Scope;
      (grouped[sc.expense_code_id] ??= []).push(sc);
    });
    setScopes(grouped);
    setDepts((d ?? []) as Dept[]);
    setEmployees((e ?? []) as Employee[]);
  }, [corporateId]);

  useEffect(() => { load(); }, [load]);

  const loadAudit = async () => {
    if (!corporateId) return;
    const { data } = await supabase.from("corporate_expense_code_audit").select("*").eq("corporate_id", corporateId).order("created_at", { ascending: false }).limit(200);
    setAudit((data ?? []) as AuditRow[]);
    setShowAudit(true);
  };

  const validateName = (name: string): string | null => {
    if (!name.trim()) return "expense_code can not be null";
    if (name.length > 50) return "Expense code should be less than 50 characters";
    return null;
  };

  const create = async () => {
    if (!corporateId) return;
    const err = validateName(form.expense_code);
    if (err) { toast({ title: "Invalid", description: err, variant: "destructive" }); return; }
    if (form.start_time && form.end_time && new Date(form.end_time) <= new Date(form.start_time)) {
      toast({ title: "Invalid", description: "end_time must be greater than start_time", variant: "destructive" }); return;
    }
    const rideCap = form.ride_cap ? parseInt(form.ride_cap, 10) : null;
    if (rideCap !== null && (!Number.isFinite(rideCap) || rideCap <= 0)) {
      toast({ title: "Invalid", description: "ride_cap should be > 0", variant: "destructive" }); return;
    }
    const { error, data } = await supabase.from("corporate_expense_codes").insert({
      corporate_id: corporateId,
      expense_code: form.expense_code.trim(),
      description: form.description || null,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      ride_cap: rideCap,
      created_by: user?.id ?? null,
    }).select("id").single();
    if (error) {
      await writeAudit("create", { ...form }, error.message, undefined, undefined, form.expense_code);
      toast({ title: "Failed", description: error.message.includes("duplicate") ? `Expense code ${form.expense_code} already exists for CORPORATE` : error.message, variant: "destructive" });
      return;
    }
    await writeAudit("create", { ...form, id: data?.id }, "success", undefined, undefined, form.expense_code);
    toast({ title: "Expense code created", description: "expense code successfully created" });
    setCreateOpen(false);
    setForm({ expense_code: "", description: "", start_time: "", end_time: "", ride_cap: "" });
    load();
  };

  const toggleActive = async (code: ExpenseCode) => {
    const { error } = await supabase.from("corporate_expense_codes").update({ active: !code.active }).eq("id", code.id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    await writeAudit("update", { active: !code.active }, "success", undefined, undefined, code.expense_code);
    load();
  };

  const remove = async (code: ExpenseCode) => {
    if (!confirm(`Delete expense code "${code.expense_code}"? This removes all allocations.`)) return;
    const { error } = await supabase.from("corporate_expense_codes").delete().eq("id", code.id);
    if (error) {
      await writeAudit("delete", { id: code.id }, error.message, undefined, undefined, code.expense_code);
      toast({ title: "Failed", description: error.message, variant: "destructive" }); return;
    }
    await writeAudit("delete", { id: code.id }, "expense code deleted successfully", undefined, undefined, code.expense_code);
    toast({ title: "Deleted", description: "expense code deleted successfully" });
    load();
  };

  const addScope = async () => {
    const code = allocOpen.code;
    if (!corporateId || !code) return;
    const level = allocForm.level;
    if (level !== "CORPORATE" && !allocForm.target) {
      toast({ title: "Invalid", description: "expense_code_created_for should not be null for group/employee", variant: "destructive" }); return;
    }
    const payload: Partial<Scope> & { corporate_id: string; expense_code_id: string; level: "CORPORATE" | "GROUP" | "EMPLOYEE" } = {
      corporate_id: corporateId,
      expense_code_id: code.id,
      level,
      department_id: level === "GROUP" ? allocForm.target : null,
      employee_id: level === "EMPLOYEE" ? allocForm.target : null,
    };
    const { error } = await supabase.from("corporate_expense_code_scopes").insert(payload);
    const targetLabel = level === "GROUP" ? depts.find(d => d.id === allocForm.target)?.name ?? allocForm.target
      : level === "EMPLOYEE" ? employees.find(e => e.id === allocForm.target)?.email ?? allocForm.target
      : null;
    if (error) {
      await writeAudit("allocate_add", { level, target: allocForm.target }, error.message.includes("duplicate") ? "the scope already exists in the given expense code" : error.message, level, targetLabel, code.expense_code);
      toast({ title: "Failed", description: error.message.includes("duplicate") ? "scope already exists" : error.message, variant: "destructive" }); return;
    }
    await writeAudit("allocate_add", { level, target: allocForm.target }, "scope successfully added", level, targetLabel, code.expense_code);
    toast({ title: "Allocated", description: "scope successfully added to the given expense code" });
    setAllocForm({ level: "CORPORATE", target: "" });
    setAllocOpen({ open: false, code: null });
    load();
  };

  const removeScope = async (scope: Scope, codeName: string) => {
    const { error } = await supabase.from("corporate_expense_code_scopes").delete().eq("id", scope.id);
    const targetLabel = scope.level === "GROUP" ? depts.find(d => d.id === scope.department_id)?.name ?? null
      : scope.level === "EMPLOYEE" ? employees.find(e => e.id === scope.employee_id)?.email ?? null
      : null;
    if (error) {
      await writeAudit("allocate_remove", { scope_id: scope.id }, error.message, scope.level, targetLabel, codeName);
      toast({ title: "Failed", description: error.message, variant: "destructive" }); return;
    }
    await writeAudit("allocate_remove", { scope_id: scope.id }, "scope removed", scope.level, targetLabel, codeName);
    load();
  };

  const runBulk = async () => {
    if (!corporateId) return;
    let parsed: Array<{ expense_code: string; description?: string; start_time?: string; end_time?: string; ride_cap?: number; scopes?: Array<{ expense_code_creation_level: string; expense_code_created_for: string | null }> }>;
    try {
      parsed = JSON.parse(bulkText);
      if (!Array.isArray(parsed)) throw new Error("Body must be an array");
    } catch (e) {
      toast({ title: "Invalid JSON", description: (e as Error).message, variant: "destructive" }); return;
    }
    let success = 0, failed = 0;
    const results: Array<{ expense_code: string; ok: boolean; message: string }> = [];
    for (const item of parsed) {
      const err = validateName(item.expense_code ?? "");
      if (err) { failed++; results.push({ expense_code: item.expense_code, ok: false, message: err }); continue; }
      const { data: ec, error } = await supabase.from("corporate_expense_codes").insert({
        corporate_id: corporateId,
        expense_code: item.expense_code.trim(),
        description: item.description ?? null,
        start_time: item.start_time ?? null,
        end_time: item.end_time ?? null,
        ride_cap: item.ride_cap ?? null,
        created_by: user?.id ?? null,
      }).select("id").single();
      if (error) {
        failed++;
        results.push({ expense_code: item.expense_code, ok: false, message: error.message });
        await writeAudit("bulk_create", item as unknown as Record<string, unknown>, error.message, undefined, undefined, item.expense_code);
        continue;
      }
      success++;
      // attach scopes
      for (const sc of item.scopes ?? []) {
        const lvl = sc.expense_code_creation_level as "CORPORATE" | "GROUP" | "EMPLOYEE";
        if (!["CORPORATE","GROUP","EMPLOYEE"].includes(lvl)) continue;
        let deptId: string | null = null, empId: string | null = null;
        if (lvl === "GROUP") deptId = depts.find(d => d.name === sc.expense_code_created_for)?.id ?? null;
        if (lvl === "EMPLOYEE") empId = employees.find(e => e.email === sc.expense_code_created_for)?.id ?? null;
        if ((lvl === "GROUP" && !deptId) || (lvl === "EMPLOYEE" && !empId)) continue;
        await supabase.from("corporate_expense_code_scopes").insert({
          corporate_id: corporateId, expense_code_id: ec!.id, level: lvl,
          department_id: deptId, employee_id: empId,
        });
      }
      results.push({ expense_code: item.expense_code, ok: true, message: "Expense code successfully created" });
      await writeAudit("bulk_create", item as unknown as Record<string, unknown>, "success", undefined, undefined, item.expense_code);
    }
    toast({ title: "Bulk complete", description: `${success} created, ${failed} failed` });
    trackEvent("bulk_complete", { successful_expense_codes: success, failed_expense_codes: failed, results });
    setBulkOpen(false); setBulkText(""); load();
  };

  const exportCodes = async () => {
    const header = ["expense_code", "description", "start_time", "end_time", "ride_cap", "rides_used", "active", "scopes"];
    const rows = codes.map((c) => [
      c.expense_code,
      c.description ?? "",
      c.start_time ?? "",
      c.end_time ?? "",
      c.ride_cap?.toString() ?? "",
      c.rides_used.toString(),
      c.active.toString(),
      (scopes[c.id] ?? []).map((s) => {
        if (s.level === "CORPORATE") return "CORPORATE";
        if (s.level === "GROUP") return `GROUP:${depts.find(d => d.id === s.department_id)?.name ?? "?"}`;
        return `EMPLOYEE:${employees.find(e => e.id === s.employee_id)?.email ?? "?"}`;
      }).join("|"),
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    await auditedExport(
      { dataset: "corporate_expense_codes", exportType: "csv", rowCount: rows.length, byteSize: new Blob([csv]).size, filters: { corporate_id: corporateId } },
      () => {
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `expense-codes-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        return blob;
      },
    );
  };

  if (!corporateId) {
    return <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Link a corporate account to manage expense codes.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2"><Tag className="h-5 w-5 text-primary" />Expense Codes</h2>
          <p className="text-sm text-muted-foreground">Project / cost-center tags enforced at booking — mirrors enterprise corporate APIs.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={loadAudit} aria-label="View expense code audit log"><History className="h-4 w-4 mr-1" />Audit</Button>
          <AppButton analytics="corporate_expense_codes_csv_download" action="submit" variant="outline" size="sm" onClick={exportCodes} aria-label="Export expense codes to CSV"><Download className="h-4 w-4 mr-1" />Export</AppButton>
          <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Bulk create expense codes from JSON"><Upload className="h-4 w-4 mr-1" />Bulk</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Bulk create expense codes</DialogTitle>
                <DialogDescription>Paste a JSON array. Schema mirrors the corporate /expenseCode/bulk API.</DialogDescription>
              </DialogHeader>
              <textarea
                className="w-full h-64 rounded-md border bg-background p-3 font-mono text-xs"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={`[\n  {\n    "expense_code": "PROJ-123",\n    "ride_cap": 100,\n    "start_time": "2026-01-01T00:00:00Z",\n    "end_time": "2026-12-31T23:59:59Z",\n    "scopes": [\n      { "expense_code_creation_level": "CORPORATE", "expense_code_created_for": null }\n    ]\n  }\n]`}
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
                <Button onClick={runBulk}>Run bulk import</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" aria-label="Create new expense code"><Plus className="h-4 w-4 mr-1" />New code</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create expense code</DialogTitle>
                <DialogDescription>Max 50 characters. Capping is optional.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div><Label>Expense code *</Label><Input value={form.expense_code} maxLength={50} onChange={(e) => setForm({ ...form, expense_code: e.target.value })} placeholder="PROJ-123" /></div>
                <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Start</Label><Input type="datetime-local" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
                  <div><Label>End</Label><Input type="datetime-local" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
                </div>
                <div><Label>Ride cap</Label><Input type="number" min={1} value={form.ride_cap} onChange={(e) => setForm({ ...form, ride_cap: e.target.value })} placeholder="Unlimited" /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={create}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Window</TableHead>
              <TableHead>Ride cap</TableHead>
              <TableHead>Allocations</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {codes.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No expense codes yet. Create one to enforce project tagging on corporate rides.</TableCell></TableRow>
            )}
            {codes.map((c) => {
              const codeScopes = scopes[c.id] ?? [];
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-medium">{c.expense_code}</div>
                    {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {c.start_time ? new Date(c.start_time).toLocaleDateString() : "—"}
                    {" → "}
                    {c.end_time ? new Date(c.end_time).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-xs">{c.ride_cap ? `${c.rides_used}/${c.ride_cap}` : "∞"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {codeScopes.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                      {codeScopes.map((s) => {
                        const label = s.level === "CORPORATE" ? "Entire corporate"
                          : s.level === "GROUP" ? depts.find(d => d.id === s.department_id)?.name ?? "Unknown group"
                          : employees.find(e => e.id === s.employee_id)?.email ?? "Unknown employee";
                        const Icon = s.level === "CORPORATE" ? Building2 : s.level === "GROUP" ? Users : UserIcon;
                        return (
                          <Badge key={s.id} variant="secondary" className="gap-1 pr-1">
                            <Icon className="h-3 w-3" />{label}
                            <button type="button" aria-label={`Remove ${label} allocation`} onClick={() => removeScope(s, c.expense_code)} className="ml-1 hover:text-destructive">×</button>
                          </Badge>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell><Switch checked={c.active} onCheckedChange={() => toggleActive(c)} aria-label={`Toggle ${c.expense_code} active`} /></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setAllocOpen({ open: true, code: c })} aria-label={`Add allocation to ${c.expense_code}`}>Allocate</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c)} aria-label={`Delete ${c.expense_code}`} className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Allocate dialog */}
      <Dialog open={allocOpen.open} onOpenChange={(o) => setAllocOpen({ open: o, code: o ? allocOpen.code : null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allocate “{allocOpen.code?.expense_code}”</DialogTitle>
            <DialogDescription>Choose the scope this code applies to.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Level</Label>
              <Select value={allocForm.level} onValueChange={(v) => setAllocForm({ level: v as typeof allocForm.level, target: "" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CORPORATE">Entire corporate</SelectItem>
                  <SelectItem value="GROUP">Department / group</SelectItem>
                  <SelectItem value="EMPLOYEE">Specific employee</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {allocForm.level === "GROUP" && (
              <div>
                <Label>Department</Label>
                <Select value={allocForm.target} onValueChange={(v) => setAllocForm({ ...allocForm, target: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick a department" /></SelectTrigger>
                  <SelectContent>{depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {allocForm.level === "EMPLOYEE" && (
              <div>
                <Label>Employee</Label>
                <Select value={allocForm.target} onValueChange={(v) => setAllocForm({ ...allocForm, target: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick an employee" /></SelectTrigger>
                  <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name ? `${e.full_name} — ${e.email}` : e.email}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllocOpen({ open: false, code: null })}>Cancel</Button>
            <Button onClick={addScope}>Add allocation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit dialog */}
      <Dialog open={showAudit} onOpenChange={setShowAudit}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Expense code audit log</DialogTitle>
            <DialogDescription>Last 200 entries · actor, action and result are recorded for compliance.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Code</TableHead><TableHead>Scope</TableHead><TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs">{new Date(a.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs"><Badge variant="outline">{a.action}</Badge></TableCell>
                    <TableCell className="text-xs">{a.expense_code}</TableCell>
                    <TableCell className="text-xs">{a.level ?? "—"}{a.created_for ? `: ${a.created_for}` : ""}</TableCell>
                    <TableCell className="text-xs">{a.result}</TableCell>
                  </TableRow>
                ))}
                {audit.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No audit entries yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
