/**
 * WHITE-LABEL PARTNER WORKSPACE — the authenticated tenant surface.
 *
 * Five tabs, each backed by a real record or a real contract:
 *   Configuration · brand configuration for the tenant (and the immutables it
 *                   can never override)
 *   Authentication · credentials per environment, rotation and audit
 *   Sandbox        · the tenant-scoped operation surface and a runnable sample
 *   Webhooks       · tenant webhook contracts and signature verification
 *   Readiness      · the certification-gated production checklist
 *   Downloads      · versioned tenant-scoped specs and changelog diffs
 *   Evidence       · signed audit artifacts with immutable version history
 *   Incidents      · raise, assign and resolve tenant incidents
 *
 * Everything is read through RLS-scoped queries; the page never asks for a
 * tenant it was not granted, and provisioning/certification are server-side.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, Building2, CheckCircle2, Copy, Download, KeyRound, ListChecks, Palette,
  ScrollText, ShieldCheck, TerminalSquare, Webhook,
} from "lucide-react";

import MarketingLayout from "@/components/marketing/MarketingLayout";
import { AppButton } from "@/components/nav/AppButton";
import EvidenceVault from "@/components/partners/whitelabel/EvidenceVault";
import IncidentManager from "@/components/partners/whitelabel/IncidentManager";
import ProvisioningWizard from "@/components/partners/whitelabel/ProvisioningWizard";
import TenantDownloads from "@/components/partners/whitelabel/TenantDownloads";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { useAuth } from "@/hooks/useAuth";
import { fetchMyPartnerships } from "@/lib/partners/api";
import { useDeepParam } from "@/lib/partners/useDeepParam";
import { BRAND_IMMUTABLES, STATUS_TONE } from "@/lib/partners/whiteLabel";
import {
  TENANT_HEADER, WHITE_LABEL_DOMAINS, buildWhiteLabelOpenApi, currentWhiteLabelRelease,
  tenantScopedEndpoints, tenantWebhookContracts, whiteLabelSpecFilename,
} from "@/lib/partners/whiteLabelApi";
import {
  READINESS_ITEMS, certifyTenant, fetchBrandConfig, fetchEnvironments, fetchReadiness,
  fetchTenants, readinessProgress, saveBrandConfig, upsertReadiness,
  type WlBrandConfig,
} from "@/lib/partners/whiteLabelTenants";
import { fetchCredentials } from "@/lib/partners/devPortal";
import { samplePayload, verifyWebhook } from "@/lib/partners/webhookSignature";
import { API_SANDBOX_URL } from "@/lib/partners/apiPlatform";

const TABS = [
  "configuration", "auth", "sandbox", "webhooks", "downloads", "evidence", "incidents", "readiness",
] as const;

const copy = (value: string, what: string) => {
  void navigator.clipboard.writeText(value);
  toast.success(`${what} copied`);
};

export default function WhiteLabelWorkspace() {
  const [tab, setTab] = useDeepParam("tab", TABS, "configuration");
  const [params, setParams] = useSearchParams();
  const tenantId = params.get("tenant") ?? "";
  const setTenantId = (id: string) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tenant", id);
      return p;
    }, { replace: true });
  const qc = useQueryClient();
  const { user } = useAuth();

  const tenantsQ = useQuery({ queryKey: ["wl-tenants"], queryFn: () => fetchTenants() });
  const tenants = tenantsQ.data ?? [];
  const activeTenant = tenants.find((t) => t.id === tenantId) ?? tenants[0];

  /* Partner identity for provisioning — from the active tenant when one exists,
   * otherwise from the signed-in login's memberships. */
  const membershipsQ = useQuery({
    queryKey: ["wl-my-partnerships", user?.id],
    queryFn: () => fetchMyPartnerships(user!.id),
    enabled: !!user,
  });
  const myPartnerId = activeTenant?.partner_id ?? membershipsQ.data?.[0]?.partner_id ?? null;

  const onProvisioned = (tenant_id: string) => {
    void qc.invalidateQueries({ queryKey: ["wl-tenants"] });
    setTenantId(tenant_id);
  };



  const brandQ = useQuery({
    queryKey: ["wl-brand", activeTenant?.id],
    queryFn: () => fetchBrandConfig(activeTenant!.id),
    enabled: !!activeTenant,
  });
  const envQ = useQuery({
    queryKey: ["wl-envs", activeTenant?.id],
    queryFn: () => fetchEnvironments(activeTenant!.id),
    enabled: !!activeTenant,
  });
  const credQ = useQuery({
    queryKey: ["wl-creds", activeTenant?.partner_id],
    queryFn: () => fetchCredentials(activeTenant!.partner_id),
    enabled: !!activeTenant,
  });
  const readyQ = useQuery({
    queryKey: ["wl-readiness", activeTenant?.id],
    queryFn: () => fetchReadiness(activeTenant!.id),
    enabled: !!activeTenant,
  });

  const progress = useMemo(() => readinessProgress(readyQ.data ?? []), [readyQ.data]);
  const readyByKey = useMemo(
    () => new Map((readyQ.data ?? []).map((r) => [r.item_key, r])),
    [readyQ.data],
  );

  /* ---------------- brand form ---------------- */
  const [form, setForm] = useState<Partial<WlBrandConfig>>({});
  useEffect(() => { if (brandQ.data) setForm(brandQ.data); }, [brandQ.data]);

  const saveBrand = useMutation({
    mutationFn: async () => {
      if (!activeTenant) throw new Error("No tenant selected");
      await saveBrandConfig(activeTenant.id, {
        logo_url: form.logo_url ?? null,
        primary_color: form.primary_color ?? null,
        accent_color: form.accent_color ?? null,
        font_family: form.font_family ?? null,
        email_sender_name: form.email_sender_name ?? null,
        support_email: form.support_email ?? null,
        legal_entity: form.legal_entity ?? null,
        policy_url: form.policy_url ?? null,
      });
    },
    onSuccess: () => {
      toast.success("Brand configuration saved");
      void qc.invalidateQueries({ queryKey: ["wl-brand", activeTenant?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markReady = useMutation({
    mutationFn: async ({ key, status }: { key: string; status: string }) => {
      if (!activeTenant) throw new Error("No tenant selected");
      await upsertReadiness(activeTenant.id, activeTenant.partner_id, key, status);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["wl-readiness", activeTenant?.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const certify = useMutation({
    mutationFn: async () => {
      if (!activeTenant) throw new Error("No tenant selected");
      return certifyTenant(activeTenant.id);
    },
    onSuccess: (r) => {
      if (r.ok) {
        toast.success("Tenant certified for production");
        void qc.invalidateQueries({ queryKey: ["wl-tenants"] });
      } else {
        toast.error(`Not certifiable — ${r.pending ?? 0} checklist item(s) outstanding`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ---------------- webhook verification harness ---------------- */
  const contracts = useMemo(() => tenantWebhookContracts(), []);
  const [event, setEvent] = useState(contracts[0]?.event ?? "order.confirmed");
  const [secret, setSecret] = useState("");
  const [body, setBody] = useState("");
  const [header, setHeader] = useState("");
  const [result, setResult] = useState<{ valid: boolean; detail: string } | null>(null);

  useEffect(() => {
    const c = contracts.find((x) => x.event === event);
    if (c) setBody(samplePayload(c.event, c.payloadKeys));
  }, [event, contracts]);

  const runVerify = async () => {
    const r = await verifyWebhook(secret, body, header);
    setResult({ valid: r.valid, detail: r.detail });
  };

  const release = currentWhiteLabelRelease();
  const endpoints = useMemo(() => tenantScopedEndpoints(), []);

  const downloadSpec = () => {
    const spec = buildWhiteLabelOpenApi(release.version);
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = whiteLabelSpecFilename(release.version);
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (tenantsQ.isLoading) {
    return (
      <MarketingLayout>
        <div className="container mx-auto max-w-6xl space-y-4 py-16">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MarketingLayout>
    );
  }

  if (!activeTenant) {
    return (
      <MarketingLayout>
        <div className="container mx-auto max-w-3xl py-20">
          <Card>
            <CardHeader>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <Building2 className="h-5 w-5 text-primary" /> No white-label tenant yet
              </h1>


              <CardDescription>
                A tenant is provisioned by the SAFARID partner desk once the agreement is executed.
                When your tenant exists, this workspace shows its brand configuration, credentials,
                sandbox surface, webhook contracts and the production readiness checklist.
              </CardDescription>
            </CardHeader>
            {myPartnerId && (
              <CardContent>
                <ProvisioningWizard
                  partnerId={myPartnerId}
                  onProvisioned={(r) => onProvisioned(r.tenant_id)}
                />
              </CardContent>
            )}
          </Card>
        </div>
      </MarketingLayout>
    );
  }

  return (
    <MarketingLayout>
      <div className="container mx-auto max-w-6xl space-y-6 py-12">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            White-label workspace
          </p>
          <h1 className="text-3xl font-semibold">{activeTenant.display_name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{activeTenant.tenant_code}</Badge>
            <Badge variant="outline">{activeTenant.environment}</Badge>
            <Badge variant="outline">{activeTenant.status}</Badge>
            <Badge variant="outline">spec {release.version}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {tenants.length > 1 && (
              <div className="max-w-xs">
                <Select value={activeTenant.id} onValueChange={setTenantId}>
                  <SelectTrigger aria-label="Select tenant"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {tenants.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <ProvisioningWizard
              partnerId={activeTenant.partner_id}
              onProvisioned={(r) => onProvisioned(r.tenant_id)}
            />
          </div>
        </header>

        <Tabs value={TABS.includes(tab as typeof TABS[number]) ? tab : "configuration"} onValueChange={setTab}>
          <TabsList className="flex w-full flex-wrap">
            <TabsTrigger value="configuration"><Palette className="mr-2 h-4 w-4" />Configuration</TabsTrigger>
            <TabsTrigger value="auth"><KeyRound className="mr-2 h-4 w-4" />Authentication</TabsTrigger>
            <TabsTrigger value="sandbox"><TerminalSquare className="mr-2 h-4 w-4" />Sandbox</TabsTrigger>
            <TabsTrigger value="webhooks"><Webhook className="mr-2 h-4 w-4" />Webhooks</TabsTrigger>
            <TabsTrigger value="downloads"><Download className="mr-2 h-4 w-4" />Downloads</TabsTrigger>
            <TabsTrigger value="evidence"><ScrollText className="mr-2 h-4 w-4" />Evidence</TabsTrigger>
            <TabsTrigger value="incidents"><AlertTriangle className="mr-2 h-4 w-4" />Incidents</TabsTrigger>
            <TabsTrigger value="readiness"><ListChecks className="mr-2 h-4 w-4" />Readiness</TabsTrigger>
          </TabsList>

          {/* ---------------- Configuration ---------------- */}
          <TabsContent value="configuration" className="space-y-4 pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Brand configuration</CardTitle>
                <CardDescription>
                  Applied to the branded surfaces admitted to your programme. Saved changes are
                  recorded against the tenant.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {([
                  ["logo_url", "Logo URL"],
                  ["primary_color", "Primary colour"],
                  ["accent_color", "Accent colour"],
                  ["font_family", "Typeface"],
                  ["email_sender_name", "Email sender name"],
                  ["support_email", "Support email"],
                  ["legal_entity", "Legal entity"],
                  ["policy_url", "Customer policy URL"],
                ] as [keyof WlBrandConfig, string][]).map(([key, label]) => (
                  <div key={String(key)} className="space-y-1.5">
                    <Label htmlFor={`brand-${String(key)}`}>{label}</Label>
                    <Input
                      id={`brand-${String(key)}`}
                      value={(form[key] as string) ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <Button onClick={() => saveBrand.mutate()} disabled={saveBrand.isPending}>
                    Save configuration
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Not overridable by branding
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {BRAND_IMMUTABLES.map((i) => <li key={i}>• {i}</li>)}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Authentication ---------------- */}
          <TabsContent value="auth" className="space-y-4 pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Environments</CardTitle>
                <CardDescription>
                  Sandbox and production are separate tenants; credentials never cross the boundary.
                  Every request must carry <code className="font-mono">{TENANT_HEADER}: {activeTenant.tenant_code}</code>.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Environment</TableHead><TableHead>Base URL</TableHead>
                      <TableHead>Webhook endpoint</TableHead><TableHead>Enabled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(envQ.data ?? []).map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.environment}</TableCell>
                        <TableCell className="font-mono text-xs">{e.base_url}</TableCell>
                        <TableCell className="font-mono text-xs">{e.webhook_url ?? "—"}</TableCell>
                        <TableCell>{e.is_enabled ? "Yes" : "No"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Credentials</CardTitle>
                <CardDescription>
                  Issued by the integration desk per tenant and environment. Rotation and revocation
                  are managed in the developer console; every action is audited.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead><TableHead>Environment</TableHead>
                      <TableHead>Client ID</TableHead><TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(credQ.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-sm text-muted-foreground">
                        No credentials issued yet.
                      </TableCell></TableRow>
                    )}
                    {(credQ.data ?? []).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{c.label}</TableCell>
                        <TableCell>{c.environment}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <button className="hover:underline" onClick={() => copy(c.client_id, "Client ID")}>
                            {c.client_id.slice(0, 22)}…
                          </button>
                        </TableCell>
                        <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Sandbox ---------------- */}
          <TabsContent value="sandbox" className="space-y-4 pt-4">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Tenant-scoped surface</CardTitle>
                  <CardDescription>
                    The same operations as the API partner surface, bound to your tenant. Statuses come
                    from the one capability model.
                  </CardDescription>
                </div>
                <AppButton variant="outline" onClick={downloadSpec} analytics="wl_workspace_download_openapi" action="noop">Download OpenAPI</AppButton>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {WHITE_LABEL_DOMAINS.map((d) => (
                    <div key={d.key} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{d.name}</span>
                        <Badge variant="outline" className={STATUS_TONE[d.status]}>{d.status}</Badge>
                      </div>
                      <p className="pt-1 text-xs text-muted-foreground">{d.evidence}</p>
                    </div>
                  ))}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Operation</TableHead><TableHead>Domain</TableHead><TableHead>Scope</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {endpoints.map((e) => (
                      <TableRow key={`${e.method} ${e.path}`}>
                        <TableCell className="font-mono text-xs">{e.method} {e.path}</TableCell>
                        <TableCell>{e.domain}</TableCell>
                        <TableCell className="font-mono text-xs">{e.scope}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="space-y-2">
                  <Label>Sandbox request</Label>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
{`curl -X POST ${API_SANDBOX_URL}/quotes \\
  -H "Authorization: Bearer $YALLA_SANDBOX_TOKEN" \\
  -H "${TENANT_HEADER}: ${activeTenant.tenant_code}" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"service":"ride","pickup":{"lat":-1.2921,"lng":36.8219},"dropoff":{"lat":-1.3192,"lng":36.9278}}'`}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Webhooks ---------------- */}
          <TabsContent value="webhooks" className="space-y-4 pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Tenant webhook contracts</CardTitle>
                <CardDescription>
                  Every envelope carries the tenant identity so a delivery can never be attributed to
                  the wrong tenant.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Event</TableHead><TableHead>When</TableHead><TableHead>Payload</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {contracts.map((c) => (
                      <TableRow key={c.event}>
                        <TableCell className="font-mono text-xs">{c.event}</TableCell>
                        <TableCell className="text-sm">{c.when}</TableCell>
                        <TableCell className="font-mono text-xs">{c.payloadKeys.join(", ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Signature verification harness</CardTitle>
                <CardDescription>
                  Runs entirely in this page — no secret leaves the browser.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="wl-event">Event</Label>
                    <Select value={event} onValueChange={setEvent}>
                      <SelectTrigger id="wl-event"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {contracts.map((c) => <SelectItem key={c.event} value={c.event}>{c.event}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wl-secret">Webhook secret</Label>
                    <Input id="wl-secret" value={secret} onChange={(e) => setSecret(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wl-body">Raw body</Label>
                  <Textarea id="wl-body" rows={8} className="font-mono text-xs"
                    value={body} onChange={(e) => setBody(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wl-header">SAFARID-Signature header</Label>
                  <Input id="wl-header" className="font-mono text-xs" placeholder="t=…,v1=…"
                    value={header} onChange={(e) => setHeader(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void runVerify()}>Verify signature</Button>
                  <Button variant="outline" onClick={() => copy(body, "Payload")}>
                    <Copy className="mr-2 h-4 w-4" />Copy payload
                  </Button>
                </div>
                {result && (
                  <p className={`text-sm ${result.valid ? "text-status-success" : "text-destructive"}`}>
                    {result.detail}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Downloads ---------------- */}
          <TabsContent value="downloads" className="space-y-4 pt-4">
            <TenantDownloads tenantCode={activeTenant.tenant_code} />
          </TabsContent>

          {/* ---------------- Evidence ---------------- */}
          <TabsContent value="evidence" className="space-y-4 pt-4">
            <EvidenceVault tenantId={activeTenant.id} partnerId={activeTenant.partner_id} />
          </TabsContent>

          {/* ---------------- Incidents ---------------- */}
          <TabsContent value="incidents" className="space-y-4 pt-4">
            <IncidentManager
              tenantId={activeTenant.id}
              tenantLabel={`${activeTenant.display_name} · ${activeTenant.tenant_code}`}
            />
          </TabsContent>

          {/* ---------------- Readiness ---------------- */}
          <TabsContent value="readiness" className="space-y-4 pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Production readiness</CardTitle>
                <CardDescription>
                  Production exposure is certification-gated: every item must be verified before the
                  tenant can be certified.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Progress value={progress.percent} />
                  <p className="text-sm text-muted-foreground">
                    {progress.verified} of {progress.total} verified · {progress.blockingOutstanding} blocking item(s) outstanding
                  </p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead><TableHead>Owner</TableHead>
                      <TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {READINESS_ITEMS.map((item) => {
                      const row = readyByKey.get(item.key);
                      const verified = row?.status === "verified";
                      return (
                        <TableRow key={item.key}>
                          <TableCell>
                            <div className="font-medium">{item.title}</div>
                            <div className="text-xs text-muted-foreground">{item.requirement}</div>
                            <div className="pt-1 text-xs text-muted-foreground">{item.section}{item.blocking ? " · blocking" : ""}</div>
                          </TableCell>
                          <TableCell>{item.owner}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{row?.status ?? "pending"}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm" variant={verified ? "outline" : "default"}
                              disabled={markReady.isPending}
                              onClick={() => markReady.mutate({ key: item.key, status: verified ? "pending" : "verified" })}
                            >
                              {verified ? "Reopen" : "Mark verified"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <Button
                  onClick={() => certify.mutate()}
                  disabled={!progress.certifiable || certify.isPending}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Request production certification
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MarketingLayout>
  );
}
