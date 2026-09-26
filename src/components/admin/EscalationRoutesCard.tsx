import { useEffect, useState } from "react";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Radio, Plus, Trash2 } from "lucide-react";

interface Route {
  id: string;
  name: string;
  severity: "info" | "warning" | "critical";
  match_rule_id: string | null;
  match_metric_key: string | null;
  email_recipients: string[];
  slack_webhook_urls: string[];
  target_roles: string[];
  priority: number;
  enabled: boolean;
}

const blank = {
  name: "", severity: "critical" as Route["severity"],
  match_rule_id: "", match_metric_key: "",
  email_recipients: "", slack_webhook_urls: "", target_roles: "",
  priority: 100, enabled: true,
};

export default function EscalationRoutesCard() {
  const [rows, setRows] = useState<Route[]>([]);
  const [draft, setDraft] = useState({ ...blank });

  async function load() {
    const { data } = await untypedDb
      .from("alert_escalation_routes").select("*").order("priority", { ascending: true });
    setRows((data ?? []) as Route[]);
  }
  useEffect(() => { void load(); }, []);

  const csv = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

  async function save() {
    if (!draft.name) { toast.error("Name required"); return; }
    const { error } = await untypedDb.from("alert_escalation_routes").insert({
      name: draft.name,
      severity: draft.severity,
      match_rule_id: draft.match_rule_id || null,
      match_metric_key: draft.match_metric_key || null,
      email_recipients: csv(draft.email_recipients),
      slack_webhook_urls: csv(draft.slack_webhook_urls),
      target_roles: csv(draft.target_roles),
      priority: draft.priority,
      enabled: draft.enabled,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Escalation route added");
    setDraft({ ...blank });
    void load();
  }

  async function toggle(r: Route) {
    await untypedDb.from("alert_escalation_routes")
      .update({ enabled: !r.enabled }).eq("id", r.id);
    void load();
  }

  async function remove(id: string) {
    await untypedDb.from("alert_escalation_routes").delete().eq("id", id);
    void load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" /> Escalation routes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2"><Label>Name</Label>
            <Input value={draft.name} placeholder="Critical → CFO + #ops-alerts"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <div><Label>Severity</Label>
            <Select value={draft.severity}
              onValueChange={(v) => setDraft({ ...draft, severity: v as Route["severity"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["info","warning","critical"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select></div>
          <div><Label>Rule ID (optional)</Label>
            <Input value={draft.match_rule_id}
              onChange={(e) => setDraft({ ...draft, match_rule_id: e.target.value })} /></div>
          <div><Label>Metric key (optional)</Label>
            <Input value={draft.match_metric_key}
              onChange={(e) => setDraft({ ...draft, match_metric_key: e.target.value })} /></div>
          <div><Label>Priority</Label>
            <Input type="number" value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} /></div>
          <div className="md:col-span-2"><Label>Email recipients (csv)</Label>
            <Input value={draft.email_recipients} placeholder="cfo@corp.com, oncall@corp.com"
              onChange={(e) => setDraft({ ...draft, email_recipients: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Slack webhook URLs (csv)</Label>
            <Input value={draft.slack_webhook_urls} placeholder="https://hooks.slack.com/..."
              onChange={(e) => setDraft({ ...draft, slack_webhook_urls: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Target roles (csv)</Label>
            <Input value={draft.target_roles} placeholder="admin, super_admin, finance_admin"
              onChange={(e) => setDraft({ ...draft, target_roles: e.target.value })} /></div>
          <div className="md:col-span-6 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.enabled}
                onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} /> Enabled
            </label>
            <Button onClick={save}><Plus className="h-4 w-4 mr-1" /> Add route</Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-2">On</th><th className="p-2">Name</th>
                <th className="p-2">Severity</th><th className="p-2">Match</th>
                <th className="p-2">Fan-out</th><th className="p-2">Priority</th><th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="p-3 text-center text-muted-foreground">No escalation routes.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2"><Switch checked={r.enabled} onCheckedChange={() => toggle(r)} /></td>
                  <td className="p-2 font-medium">{r.name}</td>
                  <td className="p-2"><Badge variant={r.severity === "critical" ? "destructive" : "secondary"}>{r.severity}</Badge></td>
                  <td className="p-2 text-xs">
                    {r.match_rule_id && <div>rule: {r.match_rule_id}</div>}
                    {r.match_metric_key && <div>metric: {r.match_metric_key}</div>}
                    {!r.match_rule_id && !r.match_metric_key && <em>any</em>}
                  </td>
                  <td className="p-2 text-xs">
                    {r.email_recipients?.length ? <div>✉ {r.email_recipients.length}</div> : null}
                    {r.slack_webhook_urls?.length ? <div>💬 {r.slack_webhook_urls.length} webhooks</div> : null}
                    {r.target_roles?.length ? <div>👥 {r.target_roles.join(",")}</div> : null}
                  </td>
                  <td className="p-2">{r.priority}</td>
                  <td className="p-2">
                    <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
