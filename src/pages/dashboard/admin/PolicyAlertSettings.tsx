import type { LooseRow } from "@/lib/types/loose";
/**
 * PAF Alert Settings — per-severity Slack webhook + email routing.
 * Test-send action dispatches a synthetic alert via the configured channels.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Bell, Send, Save } from "lucide-react";

type Row = {
  severity: "critical" | "high" | "medium" | "low";
  slack_webhook_url: string | null;
  email_recipients: string[];
  enabled: boolean;
};

const SEVERITIES: Row["severity"][] = ["critical", "high", "medium", "low"];
const sevColor: Record<string, string> = {
  critical: "bg-status-danger text-ice", high: "bg-status-warning text-ice",
  medium: "bg-status-warning text-ink", low: "bg-ai text-ice",
};

export default function PolicyAlertSettings() {
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [loading, setLoading] = useState(true);
  const [savingSev, setSavingSev] = useState<string | null>(null);
  const [testingSev, setTestingSev] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase.from("paf_alert_settings")
      .select("severity,slack_webhook_url,email_recipients,enabled");
    if (error) toast.error(error.message);
    const map: Record<string, Row> = {};
    for (const s of SEVERITIES) {
      map[s] = { severity: s, slack_webhook_url: "", email_recipients: [], enabled: true };
    }
    for (const r of (data ?? []) as Row[]) map[r.severity] = { ...r, slack_webhook_url: r.slack_webhook_url ?? "" };
    setRows(map);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const update = (sev: string, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [sev]: { ...r[sev], ...patch } }));

  const save = async (sev: string) => {
    const r = rows[sev];
    if (r.slack_webhook_url && !/^https:\/\/hooks\.slack\.com\//.test(r.slack_webhook_url)) {
      toast.error("Slack webhook URL must start with https://hooks.slack.com/");
      return;
    }
    const invalid = r.email_recipients.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (invalid.length) { toast.error(`Invalid email: ${invalid.join(", ")}`); return; }
    setSavingSev(sev);
    const { data: userRes } = await supabase.auth.getUser();
    const { error } = await supabase.from("paf_alert_settings").upsert({
      severity: sev,
      slack_webhook_url: r.slack_webhook_url || null,
      email_recipients: r.email_recipients,
      enabled: r.enabled,
      updated_by: userRes.user?.id ?? null,
      updated_at: new Date().toISOString(),
    });
    setSavingSev(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Saved routing for ${sev}`);
  };

  const testSend = async (sev: string) => {
    setTestingSev(sev);
    const { data, error } = await supabase.functions.invoke("paf-alert-test", { body: { severity: sev } });
    setTestingSev(null);
    if (error) { toast.error(error.message); return; }
    const results = data?.results ?? {};
    const parts: string[] = [];
    if ((results.slack as LooseRow)?.ok) parts.push("Slack ✓");
    else if ((results.slack as LooseRow)?.skipped) parts.push(`Slack skipped (${(results.slack as LooseRow).skipped})`);
    else parts.push(`Slack ✗ ${(results.slack as LooseRow)?.error ?? ""}`);
    if ((results.email as LooseRow)?.ok) parts.push(`Email ✓ (${(results.email as LooseRow).recipients})`);
    else if ((results.email as LooseRow)?.skipped) parts.push(`Email skipped`);
    else parts.push(`Email ✗ ${(results.email as LooseRow)?.error ?? ""}`);
    toast.success(`Test [${sev}]: ${parts.join(" · ")}`);
  };

  if (loading) return <div className="p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2"><Bell className="text-primary" /> PAF Alert Routing</h1>
        <p className="text-muted-foreground">Configure Slack webhook and email recipients per finding severity. Use the test button to verify delivery before relying on scheduled scans.</p>
      </div>

      <div className="grid gap-4">
        {SEVERITIES.map((sev) => {
          const r = rows[sev];
          return (
            <Card key={sev}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Badge className={sevColor[sev]}>{sev}</Badge>
                  <span className="text-base">routing</span>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`en-${sev}`} className="text-xs">Enabled</Label>
                  <Switch id={`en-${sev}`} checked={r.enabled} onCheckedChange={(v) => update(sev, { enabled: v })} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Slack webhook URL</Label>
                  <Input placeholder="https://hooks.slack.com/services/..."
                    value={r.slack_webhook_url ?? ""}
                    onChange={(e) => update(sev, { slack_webhook_url: e.target.value })} />
                </div>
                <div>
                  <Label>Email recipients (comma-separated)</Label>
                  <Input placeholder="ops@company.com, security@company.com"
                    value={r.email_recipients.join(", ")}
                    onChange={(e) => update(sev, {
                      email_recipients: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })} />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => testSend(sev)} disabled={testingSev === sev || !r.enabled}>
                    {testingSev === sev ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Test send
                  </Button>
                  <Button onClick={() => save(sev)} disabled={savingSev === sev}>
                    {savingSev === sev ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
