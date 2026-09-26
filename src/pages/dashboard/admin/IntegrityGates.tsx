/**
 * Integrity Gates — per-environment CI/prebuild thresholds for the navigation
 * integrity service. Persisted in `nav_integrity_thresholds`.
 */
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

interface Threshold {
  id: string;
  environment: string;
  max_dead_routes: number;
  max_registry_mismatch: number;
  max_unbound_critical: number;
  max_orphan_routes: number;
  max_missing_analytics: number;
  block_deploy: boolean;
  notify_emails: string[];
}

const FIELDS: Array<{ key: keyof Threshold; label: string; hint: string }> = [
  { key: "max_dead_routes",      label: "Max dead routes",        hint: "Links pointing to a route that does not exist" },
  { key: "max_registry_mismatch",label: "Max registry mismatch",  hint: "Routes declared in App.tsx but missing from routes.ts (or vice-versa)" },
  { key: "max_unbound_critical", label: "Max unbound critical CTAs", hint: "Apply/SignUp/Demo buttons with no handler" },
  { key: "max_orphan_routes",    label: "Max orphan routes",      hint: "Routes nobody links to" },
  { key: "max_missing_analytics",label: "Max missing analytics",  hint: "AppButtons without analytics prop" },
];

export default function IntegrityGates() {
  const [rows, setRows] = React.useState<Threshold[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<string | null>(null);

  React.useEffect(() => {
    void supabase.from("nav_integrity_thresholds").select("*").order("environment").then(({ data }) => {
      setRows((data as any) ?? []);
      setLoading(false);
    });
  }, []);

  const update = (id: string, patch: Partial<Threshold>) =>
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));

  const save = async (row: Threshold) => {
    setSaving(row.id);
    const { id, ...patch } = row;
    const { error } = await supabase.from("nav_integrity_thresholds").update(patch).eq("id", id);
    setSaving(null);
    if (error) toast.error(error.message);
    else toast.success(`${row.environment} thresholds saved`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Integrity Gates</h1>
        <p className="text-muted-foreground">
          Thresholds for the navigation integrity check. When exceeded, the CI
          job exits non-zero and (if <em>Block deploy</em> is on) prevents the
          environment from shipping.
        </p>
      </div>

      {loading ? <Skeleton className="h-64 w-full" /> : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(row => (
            <Card key={row.id}>
              <CardHeader>
                <CardTitle className="capitalize flex items-center justify-between">
                  {row.environment}
                  <div className="flex items-center gap-2 text-sm font-normal">
                    <Label htmlFor={`block-${row.id}`}>Block deploy</Label>
                    <Switch
                      id={`block-${row.id}`}
                      checked={row.block_deploy}
                      onCheckedChange={v => update(row.id, { block_deploy: v })}
                    />
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {FIELDS.map(f => (
                  <div key={f.key as string} className="space-y-1">
                    <Label htmlFor={`${row.id}-${f.key as string}`} className="text-xs">{f.label}</Label>
                    <Input
                      id={`${row.id}-${f.key as string}`}
                      type="number"
                      min={0}
                      value={(row as any)[f.key] ?? 0}
                      onChange={e => update(row.id, { [f.key]: Number(e.target.value) } as any)}
                    />
                    <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-xs">Notify emails (comma-separated)</Label>
                  <Input
                    value={row.notify_emails?.join(", ") ?? ""}
                    placeholder="ops@safarid.org"
                    onChange={e => update(row.id, {
                      notify_emails: e.target.value.split(",").map(s => s.trim()).filter(Boolean),
                    })}
                  />
                </div>
                <Button className="w-full" disabled={saving === row.id} onClick={() => save(row)}>
                  {saving === row.id ? "Saving…" : "Save"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">CI usage</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>The integrity script reads thresholds at runtime when these env vars are set in the workflow:</p>
          <pre className="bg-muted rounded p-3 text-xs overflow-x-auto">{`NAV_MAX_DEAD=0
NAV_MAX_MISMATCH=0
NAV_MAX_UNBOUND_CRITICAL=0
bun run nav:check`}</pre>
          <p>Wire the workflow to <code>SELECT max_dead_routes, max_registry_mismatch, max_unbound_critical FROM nav_integrity_thresholds WHERE environment = $ENV</code> before running the script.</p>
        </CardContent>
      </Card>
    </div>
  );
}
