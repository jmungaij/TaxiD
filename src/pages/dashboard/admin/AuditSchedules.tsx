import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CalendarClock, Plus, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Schedule {
  id: string;
  name: string;
  cadence: string;
  range_days: number;
  recipients: string[];
  include_audit: boolean;
  include_login: boolean;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string;
}

interface Run {
  id: string;
  schedule_id: string;
  range_from: string;
  range_to: string;
  audit_count: number;
  login_count: number;
  first_hash: string | null;
  last_hash: string | null;
  hash_summary: string | null;
  status: string;
  created_at: string;
}

const blank = { name: "", cadence: "daily", range_days: 7, recipients: "", include_audit: true, include_login: true };

export default function AuditSchedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [draft, setDraft] = useState({ ...blank });

  async function load() {
    const [{ data: s }, { data: r }] = await Promise.all([
      untypedDb.from("audit_report_schedules").select("*").order("created_at", { ascending: false }),
      untypedDb.from("audit_report_runs").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    setSchedules((s ?? []) as Schedule[]);
    setRuns((r ?? []) as Run[]);
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!draft.name) { toast.error("Name required"); return; }
    const recipients = draft.recipients.split(",").map((s) => s.trim()).filter(Boolean);
    const { error } = await untypedDb.from("audit_report_schedules").insert({
      name: draft.name,
      cadence: draft.cadence,
      range_days: Number(draft.range_days),
      recipients,
      include_audit: draft.include_audit,
      include_login: draft.include_login,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Schedule created");
    setDraft({ ...blank });
    void load();
  }

  async function runNow(id: string) {
    await untypedDb.from("audit_report_schedules")
      .update({ next_run_at: new Date().toISOString() }).eq("id", id);
    const { error } = await supabase.functions.invoke("audit-report-dispatcher", { body: {} });
    if (error) toast.error(error.message); else toast.success("Dispatcher invoked");
    void load();
  }

  async function toggle(s: Schedule) {
    await untypedDb.from("audit_report_schedules").update({ enabled: !s.enabled }).eq("id", s.id);
    void load();
  }

  async function remove(id: string) {
    await untypedDb.from("audit_report_schedules").delete().eq("id", id);
    void load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarClock className="h-6 w-6 text-primary" /> Scheduled Audit Reports
        </h1>
        <p className="text-sm text-muted-foreground">
          Automatically generate hash-chain-verified audit reports on a recurring cadence.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">New schedule</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="md:col-span-2"><Label>Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div><Label>Cadence</Label>
              <Select value={draft.cadence} onValueChange={(v) => setDraft({ ...draft, cadence: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">daily</SelectItem>
                  <SelectItem value="weekly">weekly</SelectItem>
                  <SelectItem value="monthly">monthly</SelectItem>
                </SelectContent>
              </Select></div>
            <div><Label>Range (days)</Label>
              <Input type="number" value={draft.range_days}
                onChange={(e) => setDraft({ ...draft, range_days: Number(e.target.value) })} /></div>
            <div className="md:col-span-2"><Label>Recipients (comma-separated)</Label>
              <Input value={draft.recipients}
                onChange={(e) => setDraft({ ...draft, recipients: e.target.value })} /></div>
          </div>
          <div className="flex items-center gap-6 mt-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.include_audit}
                onCheckedChange={(v) => setDraft({ ...draft, include_audit: v })} /> Audit events
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.include_login}
                onCheckedChange={(v) => setDraft({ ...draft, include_login: v })} /> Login events
            </label>
            <Button onClick={save}><Plus className="h-4 w-4 mr-1" /> Add schedule</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Active schedules</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>Cadence</TableHead>
              <TableHead>Range</TableHead><TableHead>Next run</TableHead>
              <TableHead>Last run</TableHead><TableHead>Enabled</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {schedules.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-muted-foreground">No schedules configured.</TableCell></TableRow>
              )}
              {schedules.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell><Badge variant="outline">{s.cadence}</Badge></TableCell>
                  <TableCell className="text-xs">{s.range_days}d</TableCell>
                  <TableCell className="text-xs">{new Date(s.next_run_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{s.last_run_at ? new Date(s.last_run_at).toLocaleString() : "—"}</TableCell>
                  <TableCell><Switch checked={s.enabled} onCheckedChange={() => toggle(s)} /></TableCell>
                  <TableCell className="space-x-1">
                    <Button size="icon" variant="ghost" onClick={() => runNow(s.id)} title="Run now"><Play className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(s.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent runs</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>When</TableHead><TableHead>Range</TableHead>
              <TableHead>Audit</TableHead><TableHead>Login</TableHead>
              <TableHead>Status</TableHead><TableHead>Hash summary</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {runs.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">No runs yet.</TableCell></TableRow>
              )}
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{r.range_from.slice(0,10)} → {r.range_to.slice(0,10)}</TableCell>
                  <TableCell>{r.audit_count}</TableCell>
                  <TableCell>{r.login_count}</TableCell>
                  <TableCell><Badge variant={r.status === "generated" ? "default" : "destructive"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{(r.hash_summary ?? "").slice(0, 16)}…</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
