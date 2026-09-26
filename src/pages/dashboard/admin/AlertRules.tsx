import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Bell, Plus, Trash2, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { simulateRule } from "@/lib/alertEngine";
import MonitorSettingsCard from "@/components/admin/MonitorSettingsCard";
import MuteWindowsCard from "@/components/admin/MuteWindowsCard";
import EscalationRoutesCard from "@/components/admin/EscalationRoutesCard";

interface Rule {
  id: string;
  name: string;
  stream: string;
  metric_key: string;
  operator: string;
  threshold: number | null;
  severity: string;
  enabled: boolean;
  cooldown_seconds: number;
  test_mode: boolean;
  target_roles: string[];
  notification_channels: string[];
  notify_email: boolean;
  notify_slack: boolean;
  slack_webhook_url: string | null;
  email_recipients: string[];
}

const blank = {
  name: "", stream: "trip", metric_key: "", operator: "gt",
  threshold: 0, severity: "warning", cooldown_seconds: 60,
  target_roles: "ceo,coo", notification_channels: "toast",
  notify_email: false, notify_slack: false,
  slack_webhook_url: "", email_recipients: "",
};

export default function AlertRules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState({ ...blank });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("executive_alert_rules")
      .select("*")
      .order("created_at", { ascending: false });
    setRules((data ?? []) as Rule[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  function csvToArr(v: string) { return v.split(",").map((s) => s.trim()).filter(Boolean); }

  async function save() {
    if (!draft.name || !draft.metric_key) { toast.error("Name and metric key required"); return; }
    const { error } = await (supabase as any).from("executive_alert_rules").insert({
      name: draft.name,
      stream: draft.stream,
      metric_key: draft.metric_key,
      operator: draft.operator,
      threshold: draft.threshold,
      severity: draft.severity,
      cooldown_seconds: draft.cooldown_seconds,
      target_roles: csvToArr(draft.target_roles),
      notification_channels: csvToArr(draft.notification_channels),
      notify_email: draft.notify_email,
      notify_slack: draft.notify_slack,
      slack_webhook_url: draft.slack_webhook_url || null,
      email_recipients: csvToArr(draft.email_recipients),
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Alert rule created");
    setDraft({ ...blank });
    void load();
  }

  async function toggle(r: Rule, field: "enabled" | "test_mode") {
    await (supabase as any).from("executive_alert_rules")
      .update({ [field]: !r[field] }).eq("id", r.id);
    void load();
  }

  async function remove(id: string) {
    await (supabase as any).from("executive_alert_rules").delete().eq("id", id);
    void load();
  }

  async function test(r: Rule) {
    try {
      const res = await simulateRule(r.id);
      toast.success(`Simulated → channels: ${res.dispatched.join(", ") || "none"}`);
    } catch (e) {
      toast.error(e.message ?? "Test failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary" /> Executive Alert Rules
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure thresholds, routing channels (toast / email / Slack), and target exec roles.
          Toggle <strong>Test mode</strong> to simulate a trigger without waiting for real metrics.
        </p>
      </div>

      <MonitorSettingsCard />
      <MuteWindowsCard />
      <EscalationRoutesCard />

      <Card>
        <CardHeader><CardTitle className="text-base">New rule</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="md:col-span-2"><Label>Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div><Label>Stream</Label>
              <Select value={draft.stream} onValueChange={(v) => setDraft({ ...draft, stream: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="trip">trip</SelectItem>
                  <SelectItem value="driver">driver</SelectItem>
                  <SelectItem value="finance">finance</SelectItem>
                </SelectContent>
              </Select></div>
            <div><Label>Metric key</Label>
              <Input placeholder="trip.completed" value={draft.metric_key}
                onChange={(e) => setDraft({ ...draft, metric_key: e.target.value })} /></div>
            <div><Label>Operator</Label>
              <Select value={draft.operator} onValueChange={(v) => setDraft({ ...draft, operator: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["gt","gte","lt","lte","eq","anomaly"].map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select></div>
            <div><Label>Threshold</Label>
              <Input type="number" value={draft.threshold ?? 0}
                onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })} /></div>
            <div><Label>Severity</Label>
              <Select value={draft.severity} onValueChange={(v) => setDraft({ ...draft, severity: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["info","warning","critical"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select></div>
            <div className="md:col-span-2"><Label>Target exec roles (csv)</Label>
              <Input value={draft.target_roles}
                onChange={(e) => setDraft({ ...draft, target_roles: e.target.value })}
                placeholder="ceo,coo,cfo" /></div>
            <div className="md:col-span-2"><Label>Channels (csv: toast,email,slack)</Label>
              <Input value={draft.notification_channels}
                onChange={(e) => setDraft({ ...draft, notification_channels: e.target.value })} /></div>
            <div className="md:col-span-2"><Label>Email recipients (csv)</Label>
              <Input value={draft.email_recipients}
                onChange={(e) => setDraft({ ...draft, email_recipients: e.target.value })} /></div>
            <div className="md:col-span-3"><Label>Slack webhook URL</Label>
              <Input value={draft.slack_webhook_url}
                onChange={(e) => setDraft({ ...draft, slack_webhook_url: e.target.value })}
                placeholder="https://hooks.slack.com/services/…" /></div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.notify_email}
                  onCheckedChange={(v) => setDraft({ ...draft, notify_email: v })} /> Email
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.notify_slack}
                  onCheckedChange={(v) => setDraft({ ...draft, notify_slack: v })} /> Slack
              </label>
            </div>
          </div>
          <Button className="mt-4" onClick={save}><Plus className="h-4 w-4 mr-1" /> Add rule</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Configured rules</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Stream</TableHead>
                <TableHead>Trigger</TableHead><TableHead>Channels</TableHead>
                <TableHead>Roles</TableHead><TableHead>Severity</TableHead>
                <TableHead>Test</TableHead><TableHead>On</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={9}>Loading…</TableCell></TableRow>}
              {!loading && rules.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-muted-foreground">No rules configured.</TableCell></TableRow>
              )}
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant="outline">{r.stream}</Badge></TableCell>
                  <TableCell className="text-xs">{r.metric_key} {r.operator} {r.threshold}</TableCell>
                  <TableCell className="text-xs">
                    {(r.notification_channels ?? []).join(", ") || "—"}
                    {r.notify_email && " · email"}{r.notify_slack && " · slack"}
                  </TableCell>
                  <TableCell className="text-xs">{(r.target_roles ?? []).join(", ") || "—"}</TableCell>
                  <TableCell><Badge>{r.severity}</Badge></TableCell>
                  <TableCell><Switch checked={r.test_mode} onCheckedChange={() => toggle(r, "test_mode")} /></TableCell>
                  <TableCell><Switch checked={r.enabled} onCheckedChange={() => toggle(r, "enabled")} /></TableCell>
                  <TableCell className="space-x-1">
                    <Button size="icon" variant="ghost" title="Simulate trigger" onClick={() => test(r)}>
                      <FlaskConical className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
