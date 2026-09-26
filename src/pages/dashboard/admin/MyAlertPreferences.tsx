/**
 * My alert preferences — per-user control over how executive alerts arrive.
 *
 * Chooses toast vs email per alert family (service-level, integration
 * incidents, circuit-breaker degraded mode), sets a minimum severity, mutes
 * individual integrations and defines quiet hours during which non-critical
 * alerts stay silent. Stored in `user_alert_prefs` (row-level scoped to the
 * signed-in user) and applied by `executiveAlertDispatch`.
 */
import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SeoHead } from "@/components/seo/SeoHead";
import { BellRing, Moon, Save } from "lucide-react";
import {
  DEFAULT_USER_ALERT_PREFS, formatMinuteOfDay, inQuietHours, loadUserAlertPrefs,
  parseMinuteOfDay, saveUserAlertPrefs, type UserAlertPrefs,
} from "@/lib/corporate/userAlertPrefs";

const INTEGRATIONS = ["mpesa", "email", "maps", "etims", "storage", "dispatch", "sms"];

const FAMILIES: Array<{
  label: string;
  description: string;
  toastKey: keyof UserAlertPrefs;
  emailKey: keyof UserAlertPrefs;
}> = [
  {
    label: "Service-level degradation",
    description: "Approval SLA compliance drops below target.",
    toastKey: "sla_toast", emailKey: "sla_email",
  },
  {
    label: "Integration incidents",
    description: "M-Pesa, email, maps, eTIMS and other integrations failing.",
    toastKey: "integration_toast", emailKey: "integration_email",
  },
  {
    label: "Circuit-breaker degraded mode",
    description: "An integration fell back to degraded operation.",
    toastKey: "circuit_toast", emailKey: "circuit_email",
  },
];

export default function MyAlertPreferences() {
  const [prefs, setPrefs] = React.useState<UserAlertPrefs | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [quietStart, setQuietStart] = React.useState("21:00");
  const [quietEnd, setQuietEnd] = React.useState("07:00");

  React.useEffect(() => {
    void (async () => {
      const loaded = await loadUserAlertPrefs();
      setPrefs(loaded);
      if (loaded) {
        setQuietStart(formatMinuteOfDay(loaded.quiet_start_minute));
        setQuietEnd(formatMinuteOfDay(loaded.quiet_end_minute));
      }
      setLoading(false);
    })();
  }, []);

  const patch = (key: keyof UserAlertPrefs, value: unknown) =>
    setPrefs((cur) => (cur ? ({ ...cur, [key]: value } as UserAlertPrefs) : cur));

  const toggleIntegration = (key: string) =>
    setPrefs((cur) => {
      if (!cur) return cur;
      const muted = cur.muted_integrations.includes(key)
        ? cur.muted_integrations.filter((k) => k !== key)
        : [...cur.muted_integrations, key];
      return { ...cur, muted_integrations: muted };
    });

  const save = async () => {
    if (!prefs) return;
    const start = parseMinuteOfDay(quietStart);
    const end = parseMinuteOfDay(quietEnd);
    if (prefs.quiet_hours_enabled && (start == null || end == null)) {
      toast.error("Quiet hours must use HH:MM (24-hour) times");
      return;
    }
    setSaving(true);
    const next: UserAlertPrefs = {
      ...prefs,
      quiet_start_minute: start ?? prefs.quiet_start_minute,
      quiet_end_minute: end ?? prefs.quiet_end_minute,
    };
    const { error } = await saveUserAlertPrefs(next);
    setSaving(false);
    if (error) toast.error(error);
    else {
      setPrefs(next);
      toast.success("Alert preferences saved");
    }
  };

  const reset = () => {
    if (!prefs) return;
    setPrefs({ ...DEFAULT_USER_ALERT_PREFS, user_id: prefs.user_id });
    setQuietStart(formatMinuteOfDay(DEFAULT_USER_ALERT_PREFS.quiet_start_minute));
    setQuietEnd(formatMinuteOfDay(DEFAULT_USER_ALERT_PREFS.quiet_end_minute));
  };

  return (
    <div className="space-y-6">
      <SeoHead
        title="My Alert Preferences | Yalla"
        description="Control which service-level, integration and circuit-breaker alerts reach you by toast or email, and set quiet hours."
        path="/dashboard/admin/my-alert-preferences"
      />

      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BellRing className="h-5 w-5" aria-hidden /> My alert preferences
        </h1>
        <p className="text-sm text-muted-foreground">
          Personal delivery rules applied on top of the role-level notification settings.
        </p>
      </header>

      {loading || !prefs ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Channels per alert family</CardTitle>
              <CardDescription>Toast shows in-app instantly; email goes through the alert dispatcher.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {FAMILIES.map((f) => (
                <div key={f.label} className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border/60 p-3">
                  <div>
                    <p className="text-sm font-medium">{f.label}</p>
                    <p className="text-xs text-muted-foreground">{f.description}</p>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`${String(f.toastKey)}`}
                        checked={Boolean(prefs[f.toastKey])}
                        onCheckedChange={(v) => patch(f.toastKey, v)}
                      />
                      <Label htmlFor={`${String(f.toastKey)}`} className="text-xs">Toast</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`${String(f.emailKey)}`}
                        checked={Boolean(prefs[f.emailKey])}
                        onCheckedChange={(v) => patch(f.emailKey, v)}
                      />
                      <Label htmlFor={`${String(f.emailKey)}`} className="text-xs">Email</Label>
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 p-3">
                <div>
                  <p className="text-sm font-medium">Minimum severity</p>
                  <p className="text-xs text-muted-foreground">Drop anything below this level.</p>
                </div>
                <Select
                  value={prefs.min_severity}
                  onValueChange={(v) => patch("min_severity", v as UserAlertPrefs["min_severity"])}
                >
                  <SelectTrigger className="w-[190px]" aria-label="Minimum severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warning">Warning and above</SelectItem>
                    <SelectItem value="critical">Critical only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Decision requests on blocked work</CardTitle>
              <CardDescription>
                When a colleague clicks “Request decision” in My Workspace, you are the decision
                owner for that queue. Choose how you hear about it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border/60 p-3">
                <div>
                  <p className="text-sm font-medium">In-app notification</p>
                  <p className="text-xs text-muted-foreground">
                    Appears in your notification bell with the work item, queue, priority, requester
                    and the reason given.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="decision_request_portal"
                    checked={prefs.decision_request_portal}
                    onCheckedChange={(v) => patch("decision_request_portal", v)}
                  />
                  <Label htmlFor="decision_request_portal" className="text-xs">In-app</Label>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border/60 p-3">
                <div>
                  <p className="text-sm font-medium">Email me as well</p>
                  <p className="text-xs text-muted-foreground">
                    Optional. High and critical priority requests are emailed regardless, so nothing
                    urgent waits for you to open My Workspace.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="decision_request_email"
                    checked={prefs.decision_request_email}
                    onCheckedChange={(v) => patch("decision_request_email", v)}
                  />
                  <Label htmlFor="decision_request_email" className="text-xs">Email</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Muted integrations</CardTitle>
              <CardDescription>Alerts for these integrations never reach you.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {INTEGRATIONS.map((key) => {
                const muted = prefs.muted_integrations.includes(key);
                return (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={muted ? "secondary" : "outline"}
                    onClick={() => toggleIntegration(key)}
                    aria-pressed={muted}
                    className="capitalize"
                  >
                    {key}
                    {muted && <Badge variant="outline" className="ml-2">muted</Badge>}
                  </Button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Moon className="h-4 w-4" aria-hidden /> Quiet hours
              </CardTitle>
              <CardDescription>
                Silence alerts overnight. Windows crossing midnight are supported.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="quiet-enabled"
                  checked={prefs.quiet_hours_enabled}
                  onCheckedChange={(v) => patch("quiet_hours_enabled", v)}
                />
                <Label htmlFor="quiet-enabled">Enable quiet hours</Label>
                {prefs.quiet_hours_enabled && (
                  <Badge variant="outline">
                    {inQuietHours(prefs) ? "Currently quiet" : "Currently active"}
                  </Badge>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="quiet-start">Start (HH:MM)</Label>
                  <Input
                    id="quiet-start"
                    value={quietStart}
                    onChange={(e) => setQuietStart(e.target.value)}
                    disabled={!prefs.quiet_hours_enabled}
                    placeholder="21:00"
                  />
                </div>
                <div>
                  <Label htmlFor="quiet-end">End (HH:MM)</Label>
                  <Input
                    id="quiet-end"
                    value={quietEnd}
                    onChange={(e) => setQuietEnd(e.target.value)}
                    disabled={!prefs.quiet_hours_enabled}
                    placeholder="07:00"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="quiet-critical"
                  checked={prefs.quiet_allow_critical}
                  onCheckedChange={(v) => patch("quiet_allow_critical", v)}
                  disabled={!prefs.quiet_hours_enabled}
                />
                <Label htmlFor="quiet-critical">Still deliver critical alerts during quiet hours</Label>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={saving}>
              <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save preferences"}
            </Button>
            <Button variant="outline" onClick={reset} disabled={saving}>Restore defaults</Button>
          </div>
        </>
      )}
    </div>
  );
}
