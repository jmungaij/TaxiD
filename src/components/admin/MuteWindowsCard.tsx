import { useEffect, useState } from "react";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { VolumeX, Plus, Trash2 } from "lucide-react";

interface Window {
  id: string;
  label: string;
  rule_id: string | null;
  metric_key: string | null;
  severity: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

const blank = {
  label: "", rule_id: "", metric_key: "", severity: "",
  starts_at: new Date().toISOString().slice(0, 16),
  ends_at: new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16),
  reason: "",
};

export default function MuteWindowsCard() {
  const [rows, setRows] = useState<Window[]>([]);
  const [draft, setDraft] = useState({ ...blank });

  async function load() {
    const { data } = await untypedDb
      .from("alert_mute_windows").select("*").order("starts_at", { ascending: false });
    setRows((data ?? []) as Window[]);
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!draft.label || !draft.ends_at) { toast.error("Label and end time required"); return; }
    const { error } = await untypedDb.from("alert_mute_windows").insert({
      label: draft.label,
      rule_id: draft.rule_id || null,
      metric_key: draft.metric_key || null,
      severity: draft.severity || null,
      starts_at: new Date(draft.starts_at).toISOString(),
      ends_at: new Date(draft.ends_at).toISOString(),
      reason: draft.reason || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Mute window created");
    setDraft({ ...blank });
    void load();
  }

  async function remove(id: string) {
    await untypedDb.from("alert_mute_windows").delete().eq("id", id);
    void load();
  }

  const isActive = (w: Window) => {
    const n = Date.now();
    return n >= new Date(w.starts_at).getTime() && n <= new Date(w.ends_at).getTime();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <VolumeX className="h-4 w-4 text-primary" />
          Alert mute windows
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <Label>Label</Label>
            <Input value={draft.label} placeholder="Weekend maintenance"
              onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </div>
          <div><Label>Rule ID (optional)</Label>
            <Input value={draft.rule_id}
              onChange={(e) => setDraft({ ...draft, rule_id: e.target.value })}
              placeholder="privileged-metrics-monitor" /></div>
          <div><Label>Metric key (optional)</Label>
            <Input value={draft.metric_key}
              onChange={(e) => setDraft({ ...draft, metric_key: e.target.value })}
              placeholder="forbidden_update_rate" /></div>
          <div><Label>Severity (optional)</Label>
            <Input value={draft.severity}
              onChange={(e) => setDraft({ ...draft, severity: e.target.value })}
              placeholder="critical" /></div>
          <div><Label>Starts</Label>
            <Input type="datetime-local" value={draft.starts_at}
              onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })} /></div>
          <div><Label>Ends</Label>
            <Input type="datetime-local" value={draft.ends_at}
              onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })} /></div>
          <div className="md:col-span-3"><Label>Reason</Label>
            <Input value={draft.reason} placeholder="Incident #123 rollback"
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></div>
          <div className="md:col-span-3 flex items-end">
            <Button onClick={save}><Plus className="h-4 w-4 mr-1" /> Add mute window</Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-2">Status</th><th className="p-2">Label</th>
                <th className="p-2">Match</th><th className="p-2">Window</th>
                <th className="p-2">Reason</th><th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-muted-foreground">No mute windows.</td></tr>}
              {rows.map((w) => (
                <tr key={w.id} className="border-t">
                  <td className="p-2">
                    <Badge variant={isActive(w) ? "destructive" : "outline"}>{isActive(w) ? "Active" : "Scheduled/expired"}</Badge>
                  </td>
                  <td className="p-2">{w.label}</td>
                  <td className="p-2 text-xs">
                    {w.rule_id && <div>rule: {w.rule_id}</div>}
                    {w.metric_key && <div>metric: {w.metric_key}</div>}
                    {w.severity && <div>sev: {w.severity}</div>}
                    {!w.rule_id && !w.metric_key && !w.severity && <em>all alerts</em>}
                  </td>
                  <td className="p-2 text-xs whitespace-nowrap">
                    {new Date(w.starts_at).toLocaleString()}<br />→ {new Date(w.ends_at).toLocaleString()}
                  </td>
                  <td className="p-2 text-xs">{w.reason ?? "—"}</td>
                  <td className="p-2">
                    <Button size="icon" variant="ghost" onClick={() => remove(w.id)}>
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
