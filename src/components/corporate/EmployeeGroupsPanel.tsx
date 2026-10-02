import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarOff, Plus, Trash2, Users } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export interface EmployeeGroup { id: string; name: string; description: string | null; active: boolean }
interface Emp { id: string; full_name: string | null; email: string | null; group_id: string | null }
interface Holiday { id: string; holiday_date: string; name: string }

/** Company employee groups (shared rules) and company holidays used by the policy engine. */
export function EmployeeGroupsPanel({ corporateId, onGroupsChange }: { corporateId: string; onGroupsChange?: (g: EmployeeGroup[]) => void }) {
  const [groups, setGroups] = useState<EmployeeGroup[]>([]);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [name, setName] = useState("");
  const [hDate, setHDate] = useState("");
  const [hName, setHName] = useState("");

  const fail = (m: string) => toast({ title: "Couldn't save", description: m, variant: "destructive" });

  const load = async () => {
    const [g, e, h] = await Promise.all([
      supabase.from("corporate_employee_groups").select("id,name,description,active").eq("corporate_id", corporateId).order("name"),
      supabase.from("corporate_employees").select("id,full_name,email,group_id").eq("corporate_id", corporateId).neq("status", "removed").order("full_name"),
      supabase.from("corporate_holidays").select("id,holiday_date,name").eq("corporate_id", corporateId).order("holiday_date"),
    ]);
    const gs = (g.data ?? []) as EmployeeGroup[];
    setGroups(gs); onGroupsChange?.(gs);
    setEmps((e.data ?? []) as Emp[]);
    setHolidays((h.data ?? []) as Holiday[]);
  };
  useEffect(() => { load(); }, [corporateId]);

  const addGroup = async () => {
    if (!name.trim()) return;
    const { error } = await supabase.from("corporate_employee_groups").insert({ corporate_id: corporateId, name: name.trim() });
    if (error) return fail(error.message);
    setName(""); load();
  };
  const removeGroup = async (id: string) => {
    if (!confirm("Delete this group? Its group-only policies are deleted too and members become ungrouped.")) return;
    const { error } = await supabase.from("corporate_employee_groups").delete().eq("id", id);
    if (error) return fail(error.message);
    load();
  };
  const assign = async (empId: string, groupId: string) => {
    const { error } = await supabase.from("corporate_employees").update({ group_id: groupId === "none" ? null : groupId }).eq("id", empId);
    if (error) return fail(error.message);
    load();
  };
  const addHoliday = async () => {
    if (!hDate || !hName.trim()) return;
    const { error } = await supabase.from("corporate_holidays").insert({ corporate_id: corporateId, holiday_date: hDate, name: hName.trim() });
    if (error) return fail(error.message);
    setHDate(""); setHName(""); load();
  };
  const removeHoliday = async (id: string) => {
    const { error } = await supabase.from("corporate_holidays").delete().eq("id", id);
    if (error) return fail(error.message);
    load();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Employee groups</h3>
        <p className="text-sm text-muted-foreground">Group staff (e.g. Executives, Sales, Guests) so they share one set of rules. Create a policy and choose the group it applies to.</p>
        <div className="flex gap-2">
          <Input placeholder="New group name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={addGroup} className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <Badge key={g.id} variant="secondary" className="gap-1">
              {g.name} · {emps.filter((e) => e.group_id === g.id).length}
              <button aria-label={`Delete ${g.name}`} onClick={() => removeGroup(g.id)}><Trash2 className="h-3 w-3" /></button>
            </Badge>
          ))}
          {groups.length === 0 && <span className="text-sm text-muted-foreground">No groups yet.</span>}
        </div>
        {groups.length > 0 && (
          <div className="space-y-1 max-h-64 overflow-auto">
            {emps.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{e.full_name || e.email}</span>
                <Select value={e.group_id ?? "none"} onValueChange={(v) => assign(e.id, v)}>
                  <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No group</SelectItem>
                    {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><CalendarOff className="h-4 w-4" /> Company holidays</h3>
        <p className="text-sm text-muted-foreground">Used by the "No trips on company holidays" rule. Dates follow Nairobi time.</p>
        <div className="flex gap-2">
          <Input type="date" value={hDate} onChange={(e) => setHDate(e.target.value)} className="w-40" />
          <Input placeholder="e.g. Madaraka Day" value={hName} onChange={(e) => setHName(e.target.value)} />
          <Button onClick={addHoliday}><Plus className="h-4 w-4" /></Button>
        </div>
        <div className="space-y-1">
          {holidays.map((h) => (
            <div key={h.id} className="flex items-center justify-between text-sm border rounded p-2">
              <span>{h.holiday_date} — {h.name}</span>
              <Button size="sm" variant="ghost" onClick={() => removeHoliday(h.id)}><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
          {holidays.length === 0 && <span className="text-sm text-muted-foreground">No holidays added.</span>}
        </div>
      </Card>
    </div>
  );
}
