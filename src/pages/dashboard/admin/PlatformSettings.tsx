import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { Save, Mail, Shield, Settings as SettingsIcon, Globe, ExternalLink, Wrench, Landmark } from "lucide-react";
import { certifyControlPlane, controlPlaneGapMatrix } from "@/lib/platform/settingsControlPlane";
import OnboardingMessageCard from "@/components/admin/OnboardingMessageCard";

type Platform = {
  id?: string;
  brand_name: string;
  support_email: string | null;
  support_phone: string | null;
  default_currency: string;
  default_timezone: string;
  default_locale: string;
  maintenance_mode: boolean;
  maintenance_message: string | null;
  email_from_name: string | null;
  email_from_address: string | null;
  email_reply_to: string | null;
  feature_flags: Record<string, boolean>;
};

type Notif = {
  id?: string;
  contact_inbox: string | null;
  demo_inbox: string | null;
  support_inbox: string | null;
  send_user_confirmation: boolean;
  spam_cutoff: number;
  honeypot_weight: number;
  min_elapsed_ms: number;
  rate_limit_per_10min: number;
  rate_limit_per_hour: number;
};

const KNOWN_FLAGS: { key: string; label: string; description: string }[] = [
  { key: "corporate_wallets", label: "Corporate wallets", description: "Enable dual-wallet flows for corporate riders." },
  { key: "delivery_marketplace", label: "Delivery marketplace", description: "Public 3PL marketplace for shippers." },
  { key: "rental_marketplace", label: "Rental marketplace", description: "Self-drive and chauffeur rental listings." },
  { key: "ai_eta_v2", label: "AI ETA v2", description: "Use the next-gen ETA model in dispatch." },
  { key: "phishing_reporting", label: "Phishing reporting", description: "Show the public phishing report form." },
];

/** Section ids are deep-linkable via ?section=… so ops can bookmark a control surface. */
const SECTION_IDS = ["brand", "email", "antispam", "flags", "maintenance", "controlplane"] as const;
type SectionId = (typeof SECTION_IDS)[number];

export default function PlatformSettings() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [notif, setNotif] = useState<Notif | null>(null);
  const [savingP, setSavingP] = useState(false);
  const [savingN, setSavingN] = useState(false);
  const baseline = useRef<{ platform: string; notif: string }>({ platform: "", notif: "" });
  const [params, setParams] = useSearchParams();
  const requested = params.get("section") as SectionId | null;
  const section: SectionId = requested && SECTION_IDS.includes(requested) ? requested : "brand";
  const setSection = (v: string) => {
    const next = new URLSearchParams(params);
    next.set("section", v);
    setParams(next, { replace: true });
  };


  const load = async () => {
    const [{ data: p }, { data: n }] = await Promise.all([
      supabase.from("platform_settings").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle(),
      supabase.from("notification_settings").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle(),
    ]);
    const pv = (p as Platform) ?? {
      brand_name: "Yalla Mobility", support_email: null, support_phone: null,
      default_currency: "KES", default_timezone: "Africa/Nairobi", default_locale: "en",
      maintenance_mode: false, maintenance_message: null,
      email_from_name: null, email_from_address: null, email_reply_to: null, feature_flags: {},
    };
    const nv = (n as Notif) ?? {
      contact_inbox: "", demo_inbox: "", support_inbox: "", send_user_confirmation: true,
      spam_cutoff: 60, honeypot_weight: 100, min_elapsed_ms: 1500,
      rate_limit_per_10min: 3, rate_limit_per_hour: 10,
    };
    // Baseline snapshot powers the per-section "unsaved changes" indicators.
    baseline.current = { platform: JSON.stringify(pv), notif: JSON.stringify(nv) };
    setPlatform(pv);
    setNotif(nv);
  };
  useEffect(() => { load(); }, []);

  const savePlatform = async () => {
    if (!platform) return;
    setSavingP(true);
    const { id, ...payload } = platform;
    const q = id
      ? supabase.from("platform_settings").update(payload).eq("id", id)
      : supabase.from("platform_settings").insert(payload);
    const { error } = await q;
    setSavingP(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    toast({ title: "Platform settings saved" });
    load();
  };

  const saveNotif = async () => {
    if (!notif) return;
    setSavingN(true);
    const { id, ...payload } = notif;
    const q = id
      ? supabase.from("notification_settings").update(payload).eq("id", id)
      : supabase.from("notification_settings").insert(payload);
    const { error } = await q;
    setSavingN(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    toast({ title: "Anti-spam & inbox settings saved" });
    load();
  };

  const setFlag = (k: string, v: boolean) =>
    setPlatform((p) => p && ({ ...p, feature_flags: { ...p.feature_flags, [k]: v } }));

  const platformDirty = !!platform && JSON.stringify(platform) !== baseline.current.platform;
  const notifDirty = !!notif && JSON.stringify(notif) !== baseline.current.notif;
  const dirty = platformDirty || notifDirty;
  const activeFlags = platform ? KNOWN_FLAGS.filter((f) => platform.feature_flags?.[f.key]).length : 0;

  const controlPlane = useMemo(() => certifyControlPlane(), []);
  const gapMatrix = useMemo(() => controlPlaneGapMatrix(controlPlane), [controlPlane]);

  const SETTINGS_GROUPS = useMemo(
    () => [
      {
        label: "Brand & communications",
        items: [
          { value: "brand", label: "Brand & localization", description: "Identity, currency, timezone", icon: Globe, dirty: platformDirty },
          { value: "email", label: "Email & domain", description: "Sender identity and inboxes", icon: Mail, dirty: platformDirty || notifDirty },
        ],
      },
      {
        label: "Trust & controls",
        items: [
          { value: "antispam", label: "Anti-spam & rate limits", description: "Form thresholds and throttles", icon: Shield, dirty: notifDirty },
          { value: "flags", label: "Feature flags", description: `${activeFlags}/${KNOWN_FLAGS.length} capabilities live`, icon: SettingsIcon, dirty: platformDirty },
        ],
      },
      {
        label: "Operations",
        items: [
          {
            value: "maintenance",
            label: "Maintenance",
            description: platform?.maintenance_mode ? "Maintenance mode is ON" : "Incident banner and gating",
            icon: Wrench,
            dirty: platformDirty,
          },
          {
            value: "controlplane",
            label: "Capability control plane",
            description: `${controlPlane.counts.governed}/${controlPlane.surfaces.length} surfaces governed`,
            icon: Landmark,
            dirty: false,
          },
        ],
      },
    ],
    [platformDirty, notifDirty, activeFlags, platform?.maintenance_mode, controlPlane],
  );



  if (!platform || !notif) {
    return <div className="container mx-auto px-4 py-8">Loading…</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Platform settings</h1>
          <p className="text-muted-foreground">Brand, email, anti-spam thresholds, and feature flags — without redeploying code.</p>
        </div>
        {dirty && (
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
            Unsaved changes
          </span>
        )}
      </div>

      <Tabs value={section} onValueChange={setSection} orientation="vertical">
        <div className="grid gap-6 lg:grid-cols-[268px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <nav aria-label="Platform settings sections">
              {SETTINGS_GROUPS.map((group) => (
                <div key={group.label} className="mb-4">
                  <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </p>
                  <TabsList className="h-auto w-full flex-col items-stretch gap-1 bg-transparent p-0">
                    {group.items.map((item) => (
                      <TabsTrigger
                        key={item.value}
                        value={item.value}
                        className="w-full justify-start gap-3 rounded-lg border border-transparent px-3 py-2 text-left data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-sm"
                      >
                        <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{item.label}</span>
                          <span className="block truncate text-xs font-normal text-muted-foreground">{item.description}</span>
                        </span>
                        {item.dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unsaved" />}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
              ))}
            </nav>
          </aside>

          <div className="min-w-0 space-y-6">


        <TabsContent value="brand" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Brand & localization</CardTitle>
              <CardDescription>Public-facing brand and default regional formats.</CardDescription>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div><Label>Brand name</Label>
                <Input value={platform.brand_name} onChange={(e) => setPlatform({ ...platform, brand_name: e.target.value })} />
              </div>
              <div><Label>Support email</Label>
                <Input type="email" value={platform.support_email ?? ""} onChange={(e) => setPlatform({ ...platform, support_email: e.target.value })} />
              </div>
              <div><Label>Support phone</Label>
                <Input value={platform.support_phone ?? ""} onChange={(e) => setPlatform({ ...platform, support_phone: e.target.value })} />
              </div>
              <div><Label>Default currency</Label>
                <Input value={platform.default_currency} onChange={(e) => setPlatform({ ...platform, default_currency: e.target.value.toUpperCase() })} />
              </div>
              <div><Label>Default timezone</Label>
                <Input value={platform.default_timezone} onChange={(e) => setPlatform({ ...platform, default_timezone: e.target.value })} />
              </div>
              <div><Label>Default locale</Label>
                <Input value={platform.default_locale} onChange={(e) => setPlatform({ ...platform, default_locale: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Button onClick={savePlatform} disabled={savingP}><Save className="h-4 w-4 mr-2" />{savingP ? "Saving…" : "Save"}</Button>
              </div>
            </CardContent>
          </Card>
          <OnboardingMessageCard />
        </TabsContent>

        <TabsContent value="email">
          <Card>
            <CardHeader>
              <CardTitle>Email domain & sender identity</CardTitle>
              <CardDescription>Connect a sender domain so contact, demo and transactional emails arrive reliably. After verifying DNS the platform will auto-route emails through this domain.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-medium">Sender domain</div>
                    <p className="text-xs text-muted-foreground max-w-md">
                      Set up a subdomain like <code>notify.yourdomain.com</code>. We auto-configure SPF/DKIM/MX once you delegate DNS.
                    </p>
                  </div>
                  <a
                    href="https://docs.lovable.dev/features/cloud/emails"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    Open email setup <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div><Label>From name</Label>
                  <Input placeholder="Yalla Mobility" value={platform.email_from_name ?? ""} onChange={(e) => setPlatform({ ...platform, email_from_name: e.target.value })} />
                </div>
                <div><Label>From address</Label>
                  <Input type="email" placeholder="hello@notify.yourdomain.com" value={platform.email_from_address ?? ""} onChange={(e) => setPlatform({ ...platform, email_from_address: e.target.value })} />
                </div>
                <div><Label>Reply-to</Label>
                  <Input type="email" placeholder="support@yourdomain.com" value={platform.email_reply_to ?? ""} onChange={(e) => setPlatform({ ...platform, email_reply_to: e.target.value })} />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4 pt-2">
                <div><Label>Contact inbox</Label>
                  <Input type="email" value={notif.contact_inbox ?? ""} onChange={(e) => setNotif({ ...notif, contact_inbox: e.target.value })} />
                </div>
                <div><Label>Demo / sales inbox</Label>
                  <Input type="email" value={notif.demo_inbox ?? ""} onChange={(e) => setNotif({ ...notif, demo_inbox: e.target.value })} />
                </div>
                <div><Label>Support inbox</Label>
                  <Input type="email" value={notif.support_inbox ?? ""} onChange={(e) => setNotif({ ...notif, support_inbox: e.target.value })} />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <div className="text-sm font-medium">Send confirmation to the submitter</div>
                  <div className="text-xs text-muted-foreground">Automatic "we got your message" reply.</div>
                </div>
                <Switch checked={notif.send_user_confirmation} onCheckedChange={(v) => setNotif({ ...notif, send_user_confirmation: v })} />
              </div>

              <div className="flex gap-2">
                <Button onClick={savePlatform} disabled={savingP} variant="outline"><Save className="h-4 w-4 mr-2" />Save sender</Button>
                <Button onClick={saveNotif} disabled={savingN}><Save className="h-4 w-4 mr-2" />Save inboxes</Button>
              </div>
            </CardContent>
          </Card>

          <DomainStatusPanel />
        </TabsContent>

        <TabsContent value="antispam">
          <Card>
            <CardHeader>
              <CardTitle>Anti-spam thresholds & rate limits</CardTitle>
              <CardDescription>Tune the public contact and demo forms without redeploying.</CardDescription>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div><Label>Spam cutoff (score ≥ flags as spam)</Label>
                <Input type="number" min={10} max={200} value={notif.spam_cutoff} onChange={(e) => setNotif({ ...notif, spam_cutoff: Number(e.target.value) })} />
              </div>
              <div><Label>Honeypot weight</Label>
                <Input type="number" min={10} max={200} value={notif.honeypot_weight} onChange={(e) => setNotif({ ...notif, honeypot_weight: Number(e.target.value) })} />
              </div>
              <div><Label>Min elapsed time (ms)</Label>
                <Input type="number" min={0} max={30000} value={notif.min_elapsed_ms} onChange={(e) => setNotif({ ...notif, min_elapsed_ms: Number(e.target.value) })} />
              </div>
              <div><Label>Max per IP / 10 min</Label>
                <Input type="number" min={1} max={100} value={notif.rate_limit_per_10min} onChange={(e) => setNotif({ ...notif, rate_limit_per_10min: Number(e.target.value) })} />
              </div>
              <div><Label>Max per IP / hour</Label>
                <Input type="number" min={1} max={500} value={notif.rate_limit_per_hour} onChange={(e) => setNotif({ ...notif, rate_limit_per_hour: Number(e.target.value) })} />
              </div>
              <div className="md:col-span-2">
                <Button onClick={saveNotif} disabled={savingN}><Save className="h-4 w-4 mr-2" />{savingN ? "Saving…" : "Save thresholds"}</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="flags">
          <Card>
            <CardHeader><CardTitle>Feature flags</CardTitle>
              <CardDescription>Toggle product capabilities live. Changes take effect immediately.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {KNOWN_FLAGS.map((f) => (
                <div key={f.key} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-xs text-muted-foreground">{f.description}</div>
                  </div>
                  <Switch
                    checked={!!platform.feature_flags?.[f.key]}
                    onCheckedChange={(v) => setFlag(f.key, v)}
                  />
                </div>
              ))}
              <Button onClick={savePlatform} disabled={savingP}><Save className="h-4 w-4 mr-2" />Save flags</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="maintenance">
          <Card>
            <CardHeader><CardTitle>Maintenance mode</CardTitle>
              <CardDescription>Display a banner and gate sensitive flows during incidents.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="text-sm font-medium">Enable maintenance mode</div>
                <Switch checked={platform.maintenance_mode} onCheckedChange={(v) => setPlatform({ ...platform, maintenance_mode: v })} />
              </div>
              <div>
                <Label>Message shown to users</Label>
                <Textarea rows={3} value={platform.maintenance_message ?? ""}
                  onChange={(e) => setPlatform({ ...platform, maintenance_message: e.target.value })} />
              </div>
              <Button onClick={savePlatform} disabled={savingP}><Save className="h-4 w-4 mr-2" />Save</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="controlplane">
          <Card>
            <CardHeader>
              <CardTitle>Capability control plane</CardTitle>
              <CardDescription>
                Governed configuration coverage for every implemented enterprise capability — derived from the
                Capability, Process and Policy registries. Coverage {controlPlane.score}/100 ·{" "}
                {controlPlane.counts.governed} governed · {controlPlane.counts.partial} partial · {controlPlane.counts.gap} gaps.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {gapMatrix.map((row) => (
                <div key={row.area} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">{row.area}</div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        row.status === "governed"
                          ? "bg-primary/10 text-primary"
                          : row.status === "partial"
                            ? "bg-muted text-muted-foreground"
                            : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-2">
                    {row.surfaces.map((s) => (
                      <li key={s.id} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{s.purpose}</span>{" "}
                        <span>
                          — {s.backing.replace(/_/g, " ")} · {s.mutation.replace(/_/g, " ")} ·{" "}
                          audit: {s.auditSink ?? "none"} · {s.versioned ? "versioned" : "unversioned"} ·{" "}
                          capabilities: {s.capabilities.join(", ")}
                          {s.policies.length > 0 && <> · policies: {s.policies.join(", ")}</>}
                        </span>
                        {s.gaps.length > 0 && (
                          <span className="block text-destructive">Gaps: {s.gaps.join("; ")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {controlPlane.uncoveredCapabilities.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Capabilities without any configuration surface: {controlPlane.uncoveredCapabilities.join(", ")}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        </div>
        </div>
      </Tabs>
    </div>
  );
}

type DomainCheck = {
  spf: "pass" | "fail" | "unknown";
  dkim: "pass" | "fail" | "unknown";
  sender: "pass" | "fail" | "unknown";
  domain: string | null;
  configured: boolean;
  recentErrors: Array<{ recipient_email: string; error_message: string | null; created_at: string; status: string }>;
};

function DomainStatusPanel() {
  const [check, setCheck] = useState<DomainCheck | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    // Pull sender domain from platform_settings + recent delivery errors from email_send_log if it exists.
    const { data: ps } = await supabase
      .from("platform_settings")
      .select("email_from_address")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const fromAddr = (ps as { email_from_address?: string } | null)?.email_from_address ?? null;
    const domain = fromAddr ? fromAddr.split("@")[1] ?? null : null;

    let recentErrors: DomainCheck["recentErrors"] = [];
    try {
      const { data } = await (supabase as never as { from: (t: string) => { select: (s: string) => { in: (c: string, v: string[]) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: never[] | null }> } } } } })
        .from("email_send_log")
        .select("recipient_email,error_message,created_at,status")
        .in("status", ["failed", "dlq", "bounced", "complained"])
        .order("created_at", { ascending: false })
        .limit(20);
      recentErrors = (data ?? []) as DomainCheck["recentErrors"];
    } catch {
      recentErrors = [];
    }

    setCheck({
      spf: domain ? "unknown" : "fail",
      dkim: domain ? "unknown" : "fail",
      sender: domain ? "unknown" : "fail",
      domain,
      configured: !!domain,
      recentErrors,
    });
    setLoading(false);
  };

  useEffect(() => { run(); }, []);

  const Pill = ({ s, label }: { s: "pass" | "fail" | "unknown"; label: string }) => {
    const cls =
      s === "pass" ? "bg-status-success/10 text-status-success border-status-success/30"
      : s === "fail" ? "bg-destructive/10 text-destructive border-destructive/30"
      : "bg-muted text-muted-foreground border-border";
    return (
      <div className={`rounded-lg border p-3 ${cls}`}>
        <div className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</div>
        <div className="text-lg font-semibold capitalize">{s === "unknown" ? "Pending verification" : s}</div>
      </div>
    );
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Domain verification status</CardTitle>
        <CardDescription>
          SPF, DKIM, and SES-sender state for your configured sender domain, plus recent delivery errors.
          Verification is managed automatically once DNS is delegated in Cloud → Emails.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <span className="text-muted-foreground">Sender domain: </span>
            <span className="font-mono">{check?.domain ?? "— not set —"}</span>
          </div>
          <Button onClick={run} disabled={loading} variant="outline" size="sm">{loading ? "Checking…" : "Re-check"}</Button>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <Pill s={check?.spf ?? "unknown"} label="SPF" />
          <Pill s={check?.dkim ?? "unknown"} label="DKIM" />
          <Pill s={check?.sender ?? "unknown"} label="SES sender" />
        </div>
        {!check?.configured && (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            Add a sender domain in Cloud → Emails. Lovable auto-provisions SPF/DKIM via NS delegation — no manual records needed in GoDaddy beyond the two NS records shown during setup.
          </div>
        )}
        <div>
          <div className="text-sm font-medium mb-2">Recent delivery errors (last 20)</div>
          {check?.recentErrors.length === 0 ? (
            <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">No recent errors logged.</div>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left">
                  <tr><th className="p-2">When</th><th className="p-2">Recipient</th><th className="p-2">Status</th><th className="p-2">Error</th></tr>
                </thead>
                <tbody>
                  {check?.recentErrors.map((e, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2 text-muted-foreground whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                      <td className="p-2">{e.recipient_email}</td>
                      <td className="p-2"><span className="font-mono">{e.status}</span></td>
                      <td className="p-2 text-destructive truncate max-w-xs">{e.error_message ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
