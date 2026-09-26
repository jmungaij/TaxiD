import { useEffect, useState } from "react";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Timer, Save } from "lucide-react";

interface Settings {
  id: string;
  cadence_minutes: number;
  spike_absolute_threshold: number;
  spike_multiplier: number;
  enabled: boolean;
}

const CADENCE_PRESETS = [1, 5, 15, 30, 60, 120];

export default function MonitorSettingsCard() {
  const [row, setRow] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await untypedDb
      .from("alert_monitor_settings")
      .select("*").limit(1).maybeSingle();
    if (data) setRow(data as Settings);
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!row) return;
    setSaving(true);
    const { error } = await untypedDb
      .from("alert_monitor_settings")
      .update({
        cadence_minutes: row.cadence_minutes,
        spike_absolute_threshold: row.spike_absolute_threshold,
        spike_multiplier: row.spike_multiplier,
        enabled: row.enabled,
      })
      .eq("id", row.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Monitor settings saved. Update the pg_cron schedule to match the new cadence.");
  }

  if (!row) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Timer className="h-4 w-4 text-primary" />
          Privileged metrics monitor
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-4">
        <div>
          <Label>Cadence (minutes)</Label>
          <Input type="number" min={1} max={1440}
            value={row.cadence_minutes}
            onChange={(e) => setRow({ ...row, cadence_minutes: Number(e.target.value) })} />
          <div className="mt-1 flex flex-wrap gap-1">
            {CADENCE_PRESETS.map((n) => (
              <Button key={n} type="button" size="sm" variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => setRow({ ...row, cadence_minutes: n })}>{n}m</Button>
            ))}
          </div>
        </div>
        <div>
          <Label>Absolute spike threshold</Label>
          <Input type="number" min={1}
            value={row.spike_absolute_threshold}
            onChange={(e) => setRow({ ...row, spike_absolute_threshold: Number(e.target.value) })} />
        </div>
        <div>
          <Label>Spike multiplier vs baseline</Label>
          <Input type="number" min={1} step="0.1"
            value={row.spike_multiplier}
            onChange={(e) => setRow({ ...row, spike_multiplier: Number(e.target.value) })} />
        </div>
        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={row.enabled}
              onCheckedChange={(v) => setRow({ ...row, enabled: v })} /> Enabled
          </label>
          <Button onClick={save} disabled={saving}>
            <Save className="h-4 w-4 mr-1" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        <p className="md:col-span-4 text-xs text-muted-foreground">
          The edge function reads these values on every run. If you change the cadence, also update the
          matching <code>pg_cron</code> schedule for <code>privileged-metrics-monitor</code> so the
          function is invoked at the new frequency.
        </p>
      </CardContent>
    </Card>
  );
}
