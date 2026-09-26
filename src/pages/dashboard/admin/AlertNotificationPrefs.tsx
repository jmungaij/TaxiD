/**
 * Per-role alert notification preferences.
 *
 * Controls which roles receive email and/or Slack notifications, and at which
 * severities. `alert-dispatch` reads these rows before resolving recipients,
 * so muting a role here actually stops the notification going out.
 */
import { useEffect, useState } from "react";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { BellRing, Save, Plus } from "lucide-react";
import { ALERT_SEVERITIES, type NotificationPref } from "@/lib/security/notificationPrefs";

interface PrefRow extends NotificationPref {
  id: string;
  updated_at?: string;
}

const KNOWN_ROLES = ["admin", "super_admin", "finance_admin", "compliance_admin", "support_agent"];

export default function AlertNotificationPrefs() {
  const [rows, setRows] = useState<PrefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [newRole, setNewRole] = useState("");
  const { toast } = useToast();
  const db = untypedDb;

  const load = async () => {
    setLoading(true);
    const { data, error } = await db
      .from("alert_notification_prefs").select("*").order("role");
    if (error) toast({ title: "Could not load preferences", description: error.message, variant: "destructive" });
    setRows((data ?? []) as PrefRow[]);
    setLoading(false);
  };

  useEffect(() => { void load();   }, []);

  const patch = (role: string, key: keyof PrefRow, value: unknown) =>
    setRows((cur) => cur.map((r) => (r.role === role ? { ...r, [key]: value } as PrefRow : r)));

  const save = async (row: PrefRow) => {
    setSaving(row.role);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await db.from("alert_notification_prefs").update({
      email_enabled: row.email_enabled,
      slack_enabled: row.slack_enabled,
      severity_info: row.severity_info,
      severity_warning: row.severity_warning,
      severity_critical: row.severity_critical,
      slack_webhook_url: row.slack_webhook_url || null,
      updated_by: auth?.user?.id ?? null,
    }).eq("role", row.role);
    setSaving(null);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else toast({ title: "Preferences saved", description: `${row.role} notification routing updated.` });
  };

  const addRole = async () => {
    const role = newRole.trim();
    if (!role) return;
    const { error } = await db.from("alert_notification_prefs").insert({ role });
    if (error) {
      toast({ title: "Could not add role", description: error.message, variant: "destructive" });
      return;
    }
    setNewRole("");
    void load();
  };

  return (
    <AdminOnly>
      <div className="p-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BellRing className="h-5 w-5 text-primary" /> Alert notification preferences
          </h1>
          <p className="text-sm text-muted-foreground">
            Per-role channel and severity routing applied by the alert dispatcher. Roles without a
            row here keep the caller's default routing.
          </p>
        </header>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add a role</CardTitle>
            <CardDescription>Create routing preferences for another platform role.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="anp-role">Role</Label>
              <Input
                id="anp-role"
                list="anp-known-roles"
                placeholder="e.g. compliance_admin"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-64"
              />
              <datalist id="anp-known-roles">
                {KNOWN_ROLES.map((r) => <option key={r} value={r} />)}
              </datalist>
            </div>
            <Button onClick={() => void addRole()} disabled={!newRole.trim()}>
              <Plus className="mr-2 h-4 w-4" /> Add role
            </Button>
          </CardContent>
        </Card>

        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {rows.map((row) => (
              <Card key={row.role}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-mono">{row.role}</CardTitle>
                  <CardDescription>Channels and severities this role receives.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor={`${row.role}-email`}>Email</Label>
                      <Switch
                        id={`${row.role}-email`}
                        checked={row.email_enabled}
                        onCheckedChange={(v) => patch(row.role, "email_enabled", v)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor={`${row.role}-slack`}>Slack</Label>
                      <Switch
                        id={`${row.role}-slack`}
                        checked={row.slack_enabled}
                        onCheckedChange={(v) => patch(row.role, "slack_enabled", v)}
                      />
                    </div>
                  </div>

                  <div className="space-y-3 border-t pt-3">
                    {ALERT_SEVERITIES.map((sev) => {
                      const key = `severity_${sev}` as keyof PrefRow;
                      return (
                        <div key={sev} className="flex items-center justify-between">
                          <Label htmlFor={`${row.role}-${sev}`} className="capitalize">{sev}</Label>
                          <Switch
                            id={`${row.role}-${sev}`}
                            checked={Boolean(row[key])}
                            onCheckedChange={(v) => patch(row.role, key, v)}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-1 border-t pt-3">
                    <Label htmlFor={`${row.role}-hook`}>Role Slack webhook (optional)</Label>
                    <Input
                      id={`${row.role}-hook`}
                      placeholder="https://hooks.slack.com/services/..."
                      value={row.slack_webhook_url ?? ""}
                      onChange={(e) => patch(row.role, "slack_webhook_url", e.target.value)}
                    />
                  </div>

                  <Button onClick={() => void save(row)} disabled={saving === row.role}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving === row.role ? "Saving..." : "Save"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AdminOnly>
  );
}
