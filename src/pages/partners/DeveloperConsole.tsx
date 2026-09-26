/**
 * YALLA API PARTNERS — developer console.
 *
 * The authenticated technical surface behind /partners/api:
 *   • Usage, rate limits and remaining quota per environment
 *   • Postman collection and SDK exports per capability domain and tier
 *   • Versioned OpenAPI spec with changelog diffs between releases
 *   • Signed-webhook verification and replay harness
 *   • API credential issue / rotate / revoke with append-only audit history
 *
 * Credentials are minted by security-definer RPCs and the plaintext secret is
 * shown once, in-session only — nothing here persists a secret client-side.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, Copy, Download, FileJson,
  GitCompareArrows, History, KeyRound, RefreshCw, ShieldAlert, ShieldCheck,
  Terminal, Trash2, Radio,
} from "lucide-react";
import { toast } from "sonner";

import { MarketingPage } from "@/components/marketing/PageHero";
import { AppButton } from "@/components/nav/AppButton";
import { SeoHead } from "@/components/seo/SeoHead";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useDeepParam } from "@/lib/partners/useDeepParam";
import { SALES_MAILTO } from "@/config/contact";
import { API_ENDPOINTS, CAPABILITY_DOMAINS, COMMERCIAL_TIERS, WEBHOOK_EVENTS } from "@/lib/partners/apiPlatform";
import {
  API_RELEASES, buildOpenApiSpec, currentRelease, diffReleases,
} from "@/lib/partners/apiVersions";
import {
  buildExports, buildPostmanCollection, buildPythonSdk, buildTypeScriptSdk,
  downloadArtifact, tierDomains, scopedEndpoints,
} from "@/lib/partners/apiExports";
import {
  DEFAULT_TOLERANCE_SECONDS, samplePayload, signWebhook, verifyWebhook,
  type VerificationResult,
} from "@/lib/partners/webhookSignature";
import { fetchMyPartnerships } from "@/lib/partners/api";
import { AnalyticsPanel } from "@/components/partners/console/AnalyticsPanel";
import { RateLimitPanel } from "@/components/partners/console/RateLimitPanel";
import { DeliveryLogPanel } from "@/components/partners/console/DeliveryLogPanel";
import {
  fetchCredentialAudit, fetchCredentials, fetchUsage, issueCredential,
  quotaPosition, revokeCredential, rotateCredential, summariseUsage,
  type ApiEnvironment, type IssuedSecret,
} from "@/lib/partners/devPortal";

const TABS = [
  "usage", "analytics", "limits", "downloads", "spec", "webhooks", "deliveries", "keys",
] as const;

const ALL_SCOPES = [...new Set(API_ENDPOINTS.map((e) => e.scope))].filter((s) => s !== "—");

const nf = new Intl.NumberFormat("en-KE");

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 gap-1 px-2 text-xs"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error("Clipboard unavailable — select the value manually.");
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function DeveloperConsole() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useDeepParam("tab", TABS, "usage");
  const [environment, setEnvironment] = useState<ApiEnvironment>("sandbox");

  const memberships = useQuery({
    queryKey: ["partner-memberships", user?.id],
    queryFn: () => fetchMyPartnerships(user!.id),
    enabled: Boolean(user?.id),
  });
  const [selected, setSelected] = useState("");
  const list = memberships.data ?? [];
  const partnerId = selected || list[0]?.partner_id || "";
  const membership = list.find((m) => m.partner_id === partnerId);
  const canManage = ["owner", "admin"].includes(String(membership?.partner_role ?? ""));
  const enabled = Boolean(partnerId);

  const credentials = useQuery({
    queryKey: ["partner-api-credentials", partnerId],
    queryFn: () => fetchCredentials(partnerId),
    enabled,
  });
  const usage = useQuery({
    queryKey: ["partner-api-usage", partnerId],
    queryFn: () => fetchUsage(partnerId, 30),
    enabled,
  });
  const audit = useQuery({
    queryKey: ["partner-api-audit", partnerId],
    queryFn: () => fetchCredentialAudit(partnerId),
    enabled,
  });

  const creds = credentials.data ?? [];
  const usageRows = usage.data ?? [];
  const summary = useMemo(() => summariseUsage(usageRows, environment), [usageRows, environment]);
  const quota = useMemo(() => quotaPosition(usageRows, creds, environment), [usageRows, creds, environment]);

  /* ------------------------------------------------------------- downloads */
  const [exportDomain, setExportDomain] = useState<string>("all");
  const [exportTier, setExportTier] = useState<string>("integrate");
  const exportScope = useMemo(
    () => ({ domain: exportDomain === "all" ? undefined : exportDomain, tier: exportTier }),
    [exportDomain, exportTier],
  );
  const scopedCount = scopedEndpoints(exportScope).length;

  /* ------------------------------------------------------------ spec diffs */
  const [fromVersion, setFromVersion] = useState(API_RELEASES[1]?.version ?? API_RELEASES[0].version);
  const [toVersion, setToVersion] = useState(currentRelease().version);
  const diff = useMemo(() => diffReleases(fromVersion, toVersion), [fromVersion, toVersion]);
  const spec = useMemo(() => buildOpenApiSpec(toVersion), [toVersion]);

  /* --------------------------------------------------------------- webhook */
  const [whSecret, setWhSecret] = useState("whsec_sandbox_replace_me");
  const [whEvent, setWhEvent] = useState(WEBHOOK_EVENTS[0].event);
  const [whBody, setWhBody] = useState(() => samplePayload(WEBHOOK_EVENTS[0].event, WEBHOOK_EVENTS[0].payloadKeys));
  const [whHeader, setWhHeader] = useState("");
  const [whTolerance, setWhTolerance] = useState(DEFAULT_TOLERANCE_SECONDS);
  const [whResult, setWhResult] = useState<VerificationResult | null>(null);

  const signNow = async (offsetSeconds = 0) => {
    const signed = await signWebhook(whSecret, whBody, Math.floor(Date.now() / 1000) + offsetSeconds);
    setWhHeader(signed.header);
    setWhResult(null);
    toast.success(offsetSeconds ? `Signed with a ${offsetSeconds}s timestamp offset.` : "Payload signed.");
  };
  const verifyNow = async () => {
    setWhResult(await verifyWebhook(whSecret, whBody, whHeader, whTolerance));
  };

  /* ------------------------------------------------------------ credential */
  const [newLabel, setNewLabel] = useState("");
  const [newTier, setNewTier] = useState("integrate");
  const [newScopes, setNewScopes] = useState<string[]>(ALL_SCOPES.slice(0, 3));
  const [issued, setIssued] = useState<IssuedSecret | null>(null);

  const refreshKeys = () => {
    void qc.invalidateQueries({ queryKey: ["partner-api-credentials", partnerId] });
    void qc.invalidateQueries({ queryKey: ["partner-api-audit", partnerId] });
  };

  const issueMutation = useMutation({
    mutationFn: () =>
      issueCredential({
        partnerId,
        environment,
        label: newLabel.trim() || `${environment} integration`,
        scopes: newScopes,
        tier: newTier,
      }),
    onSuccess: (secret) => {
      setIssued(secret);
      setNewLabel("");
      refreshKeys();
      toast.success("Credential issued. Copy the secret now — it is never shown again.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not issue the credential."),
  });

  const rotateMutation = useMutation({
    mutationFn: (id: string) => rotateCredential(id, 24, "Partner-initiated rotation from the developer console"),
    onSuccess: (secret) => {
      setIssued(secret);
      refreshKeys();
      toast.success("Rotated. The previous secret stays valid for a 24-hour grace window.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not rotate the credential."),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeCredential(id, "Partner-initiated revocation from the developer console"),
    onSuccess: () => {
      refreshKeys();
      toast.success("Credential revoked. Calls with it now fail closed.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not revoke the credential."),
  });

  const envCreds = creds.filter((c) => c.environment === environment);

  return (
    <MarketingPage>
      <SeoHead
        title="Developer Console | Yalla API Partners"
        description="Usage, rate limits and quotas, Postman and SDK downloads, versioned OpenAPI specs, webhook replay testing and API credential rotation for Yalla API partners."
        path="/partners/api/console"
      />

      <header className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-4 py-10">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <Badge variant="outline" className="mb-3 gap-1.5">
                <Terminal className="h-3.5 w-3.5" aria-hidden /> Developer console
              </Badge>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                Your integration, instrumented
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Live consumption against your rate limits and quotas, generated client artefacts,
                the published specification with release diffs, a signed-webhook harness and
                governed credential rotation — all scoped to your partner account.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[190px]">
                <Label className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Environment</Label>
                <Select value={environment} onValueChange={(v) => setEnvironment(v as ApiEnvironment)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">Sandbox</SelectItem>
                    <SelectItem value="production">Production</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {list.length > 1 && (
                <div className="min-w-[220px]">
                  <Label className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Partner account</Label>
                  <Select value={partnerId} onValueChange={setSelected}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {list.map((m) => (
                        <SelectItem key={m.partner_id} value={m.partner_id}>
                          {m.partner.trading_name || m.partner.legal_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button asChild variant="outline">
                <Link to="/partners/api">API platform <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden /></Link>
              </Button>
            </div>
          </div>

          {!loading && !user && (
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-status-warning/40 bg-status-warning/10 p-4 text-sm">
              <ShieldAlert className="h-4 w-4 text-status-warning" aria-hidden />
              <span>
                Sign in with your partner login to see usage, quotas and credentials. Downloads,
                the specification and the webhook harness work without signing in.
              </span>
              <Button asChild size="sm" variant="outline"><Link to="/auth">Sign in</Link></Button>
            </div>
          )}
          {user && !loading && list.length === 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span>
                This login is not attached to a partner account yet. The integration desk links your
                login when your integration scope is signed.
              </span>
              <Button asChild size="sm" variant="outline"><Link to="/partners/apply">Start an application</Link></Button>
            </div>
          )}
        </div>
      </header>

      <div className="container mx-auto px-4 py-10">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="usage">Usage &amp; quotas</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="limits">Rate-limit simulator</TabsTrigger>
            <TabsTrigger value="downloads">Postman &amp; SDKs</TabsTrigger>
            <TabsTrigger value="spec">Spec &amp; changelog</TabsTrigger>
            <TabsTrigger value="webhooks">Webhook console</TabsTrigger>
            <TabsTrigger value="deliveries">Delivery log</TabsTrigger>
            <TabsTrigger value="keys">Keys &amp; rotation</TabsTrigger>
          </TabsList>

          {/* ============================================ USAGE & QUOTAS */}
          <TabsContent value="usage" className="mt-6 space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Requests (30 days)"
                value={nf.format(summary.requests)}
                hint={`${environment} environment`}
              />
              <Metric
                label="Error rate"
                value={`${(summary.errorRate * 100).toFixed(2)}%`}
                hint={`${nf.format(summary.errors)} errors, ${nf.format(summary.throttled)} throttled`}
              />
              <Metric
                label="Rate limit"
                value={quota.rateLimit ? `${nf.format(quota.rateLimit)}/min` : "—"}
                hint={`${quota.activeCredentials} live credential${quota.activeCredentials === 1 ? "" : "s"}`}
              />
              <Metric
                label="p95 latency"
                value={summary.p95LatencyMs ? `${nf.format(summary.p95LatencyMs)} ms` : "—"}
                hint="Worst observed daily p95"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Month-to-date quota</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3 text-sm">
                  <div>
                    <span className="text-2xl font-semibold tabular-nums">{nf.format(quota.used)}</span>
                    <span className="text-muted-foreground"> / {nf.format(quota.quota)} requests</span>
                  </div>
                  <div className="text-muted-foreground">
                    {nf.format(quota.remaining)} remaining · {(quota.utilisation * 100).toFixed(1)}% consumed
                  </div>
                </div>
                <Progress value={Math.min(100, quota.utilisation * 100)} aria-label="Quota consumed" />
                {quota.utilisation >= 0.8 && (
                  <p className="flex items-center gap-2 text-sm text-status-warning">
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                    Above 80% of the contracted monthly quota. Raise a capacity request before you
                    hit the ceiling — throttling fails closed with HTTP 429.
                  </p>
                )}
                {!enabled && (
                  <p className="text-sm text-muted-foreground">
                    Quota figures appear once your login is attached to a partner account.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Consumption by capability domain</CardTitle>
              </CardHeader>
              <CardContent>
                {summary.byDomain.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No {environment} traffic recorded in the last 30 days.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Errors</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.byDomain.map((d) => (
                        <TableRow key={d.domain}>
                          <TableCell className="font-medium">
                            {CAPABILITY_DOMAINS.find((c) => c.key === d.domain)?.name ?? d.domain}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{nf.format(d.requests)}</TableCell>
                          <TableCell className="text-right tabular-nums">{nf.format(d.errors)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {summary.requests ? `${((d.requests / summary.requests) * 100).toFixed(1)}%` : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================================================== ANALYTICS */}
          <TabsContent value="analytics" className="mt-6">
            <AnalyticsPanel partnerId={partnerId} partnerName={String(membership?.partner?.legal_name ?? membership?.partner?.trading_name ?? "Partner")} />
          </TabsContent>

          {/* ======================================= RATE-LIMIT SIMULATOR */}
          <TabsContent value="limits" className="mt-6">
            <RateLimitPanel />
          </TabsContent>

          {/* ============================================== DELIVERY LOG */}
          <TabsContent value="deliveries" className="mt-6">
            <DeliveryLogPanel partnerId={partnerId} />
          </TabsContent>

          {/* ================================================= DOWNLOADS */}
          <TabsContent value="downloads" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Generate client artefacts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm text-muted-foreground">
                  Collections and SDKs are generated from the same contract that powers the public
                  documentation and the published OpenAPI release, so a download can never describe
                  a surface that does not exist. No credential is embedded — exports read
                  <code className="mx-1 font-mono text-xs">client_id</code> and
                  <code className="mx-1 font-mono text-xs">client_secret</code> from your environment.
                </p>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="export-domain">Capability domain</Label>
                    <Select value={exportDomain} onValueChange={setExportDomain}>
                      <SelectTrigger id="export-domain" className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All entitled domains</SelectItem>
                        {CAPABILITY_DOMAINS.map((d) => (
                          <SelectItem key={d.key} value={d.key}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="export-tier">Commercial tier</Label>
                    <Select value={exportTier} onValueChange={setExportTier}>
                      <SelectTrigger id="export-tier" className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COMMERCIAL_TIERS.map((t) => (
                          <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    <div className="font-semibold text-foreground">{scopedCount} operations included</div>
                    Tier entitlement: {tierDomains(exportTier).length} domains · spec {currentRelease().version}
                  </div>
                </div>

                <Separator />

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Button
                    variant="outline"
                    className="justify-start gap-2"
                    onClick={() => {
                      downloadArtifact({
                        filename: `yalla-api-${exportDomain}-${exportTier}-${currentRelease().version}.postman_collection.json`,
                        mime: "application/json",
                        contents: JSON.stringify(buildPostmanCollection(exportScope), null, 2),
                      });
                      toast.success("Postman collection downloaded.");
                    }}
                  >
                    <Download className="h-4 w-4" aria-hidden /> Postman collection
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start gap-2"
                    onClick={() => {
                      downloadArtifact({
                        filename: `yalla-sdk-${exportDomain}-${exportTier}.ts`,
                        mime: "text/plain",
                        contents: buildTypeScriptSdk(exportScope),
                      });
                      toast.success("TypeScript SDK downloaded.");
                    }}
                  >
                    <Download className="h-4 w-4" aria-hidden /> TypeScript SDK
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start gap-2"
                    onClick={() => {
                      downloadArtifact({
                        filename: `yalla_sdk_${exportDomain}_${exportTier}.py`,
                        mime: "text/plain",
                        contents: buildPythonSdk(exportScope),
                      });
                      toast.success("Python SDK downloaded.");
                    }}
                  >
                    <Download className="h-4 w-4" aria-hidden /> Python SDK
                  </Button>
                  <Button
                    className="justify-start gap-2"
                    onClick={() => {
                      buildExports(exportScope).forEach(downloadArtifact);
                      toast.success("Full integration bundle downloaded.");
                    }}
                  >
                    <Download className="h-4 w-4" aria-hidden /> Full bundle
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tier entitlement matrix</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      {COMMERCIAL_TIERS.map((t) => (
                        <TableHead key={t.key} className="text-center">{t.name}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {CAPABILITY_DOMAINS.map((d) => (
                      <TableRow key={d.key}>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        {COMMERCIAL_TIERS.map((t) => (
                          <TableCell key={t.key} className="text-center">
                            {tierDomains(t.key).includes(d.key) ? (
                              <CheckCircle2 className="mx-auto h-4 w-4 text-status-success" aria-label="Included" />
                            ) : (
                              <span className="text-muted-foreground" aria-label="Not included">—</span>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================ SPEC & CHANGELOG */}
          <TabsContent value="spec" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitCompareArrows className="h-4 w-4" aria-hidden /> Release diff
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="diff-from">From release</Label>
                    <Select value={fromVersion} onValueChange={setFromVersion}>
                      <SelectTrigger id="diff-from" className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {API_RELEASES.map((r) => (
                          <SelectItem key={r.version} value={r.version}>{r.version} · {r.status}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="diff-to">To release</Label>
                    <Select value={toVersion} onValueChange={setToVersion}>
                      <SelectTrigger id="diff-to" className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {API_RELEASES.map((r) => (
                          <SelectItem key={r.version} value={r.version}>{r.version} · {r.status}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end gap-2">
                    <AppButton
                      variant="outline"
                      className="gap-2"
                      analytics="api_console_download_openapi"
                      action="noop"
                      onClick={() => {
                        downloadArtifact({
                          filename: `yalla-openapi-${toVersion}.json`,
                          mime: "application/json",
                          contents: JSON.stringify(spec, null, 2),
                        });
                        toast.success(`OpenAPI ${toVersion} downloaded.`);
                      }}
                    >
                      <FileJson className="h-4 w-4" aria-hidden /> Download OpenAPI
                    </AppButton>
                  </div>
                </div>

                {diff && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="text-sm font-semibold">Operations added</div>
                      {diff.addedOperations.length === 0 ? (
                        <p className="mt-1 text-sm text-muted-foreground">None.</p>
                      ) : (
                        <ul className="mt-2 space-y-1">
                          {diff.addedOperations.map((op) => (
                            <li key={op} className="font-mono text-xs text-status-success">+ {op}</li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-4 text-sm font-semibold">Operations removed</div>
                      {diff.removedOperations.length === 0 ? (
                        <p className="mt-1 text-sm text-muted-foreground">None.</p>
                      ) : (
                        <ul className="mt-2 space-y-1">
                          {diff.removedOperations.map((op) => (
                            <li key={op} className="font-mono text-xs text-destructive">- {op}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="text-sm font-semibold">Breaking changes to action</div>
                      {diff.breakingChanges.length === 0 ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          No breaking change between {diff.from} and {diff.to}.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {diff.breakingChanges.map((c, i) => (
                            <li key={i} className="flex gap-2 text-sm">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden />
                              <span><Badge variant="outline" className="mr-1.5 text-[10px] uppercase">{c.domain}</Badge>{c.summary}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-4 text-sm font-semibold">Other changes</div>
                      <ul className="mt-2 space-y-2">
                        {diff.otherChanges.map((c, i) => (
                          <li key={i} className="text-sm text-muted-foreground">
                            <Badge variant="secondary" className="mr-1.5 text-[10px] uppercase">{c.kind}</Badge>
                            {c.summary}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Release history</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {API_RELEASES.map((r) => (
                  <div key={r.version} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{r.version}</span>
                      <Badge variant={r.status === "current" ? "default" : "outline"} className="text-[10px] uppercase">
                        {r.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">Released {r.releasedOn}</span>
                      {r.sunsetOn && <span className="text-xs text-status-warning">Sunset {r.sunsetOn}</span>}
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground">{r.headline}</p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {r.changelog.map((c, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px] uppercase">{c.kind}</Badge>
                          {c.breaking && <Badge variant="destructive" className="text-[10px] uppercase">breaking</Badge>}
                          <span className="text-muted-foreground">{c.summary}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Specification preview — {toVersion}</CardTitle></CardHeader>
              <CardContent>
                <pre className="max-h-96 overflow-auto rounded-xl border border-border bg-muted/50 p-4 text-xs leading-relaxed">
                  <code>{JSON.stringify(spec, null, 2).slice(0, 6000)}</code>
                </pre>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================= WEBHOOK CONSOLE */}
          <TabsContent value="webhooks" className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Radio className="h-4 w-4" aria-hidden /> Sign, replay and verify
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm text-muted-foreground">
                  Scheme v2: the header is <code className="font-mono text-xs">t=&lt;unix&gt;,v1=&lt;hmac-sha256&gt;</code>{" "}
                  computed over <code className="font-mono text-xs">{"${t}.${rawBody}"}</code>. Verification runs
                  entirely in this page using Web Crypto — your signing secret is never transmitted.
                </p>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="wh-event">Event</Label>
                    <Select
                      value={whEvent}
                      onValueChange={(v) => {
                        setWhEvent(v);
                        const def = WEBHOOK_EVENTS.find((w) => w.event === v)!;
                        setWhBody(samplePayload(def.event, def.payloadKeys));
                        setWhHeader("");
                        setWhResult(null);
                      }}
                    >
                      <SelectTrigger id="wh-event" className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {WEBHOOK_EVENTS.map((w) => (
                          <SelectItem key={w.event} value={w.event}>{w.event}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="wh-secret">Signing secret</Label>
                    <Input
                      id="wh-secret"
                      type="password"
                      className="mt-1 font-mono"
                      value={whSecret}
                      onChange={(e) => setWhSecret(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="wh-tolerance">Tolerance (seconds)</Label>
                    <Input
                      id="wh-tolerance"
                      type="number"
                      className="mt-1"
                      value={whTolerance}
                      onChange={(e) => setWhTolerance(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="wh-body">Raw request body</Label>
                  <Textarea
                    id="wh-body"
                    className="mt-1 min-h-[200px] font-mono text-xs"
                    value={whBody}
                    onChange={(e) => { setWhBody(e.target.value); setWhResult(null); }}
                  />
                </div>

                <div>
                  <Label htmlFor="wh-header">Yalla-Signature header</Label>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Input
                      id="wh-header"
                      className="min-w-[280px] flex-1 font-mono text-xs"
                      placeholder="t=1756070000,v1=…"
                      value={whHeader}
                      onChange={(e) => { setWhHeader(e.target.value); setWhResult(null); }}
                    />
                    {whHeader && <CopyButton value={whHeader} label="signature header" />}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void signNow()} className="gap-2">
                    <ShieldCheck className="h-4 w-4" aria-hidden /> Sign now
                  </Button>
                  <Button variant="outline" onClick={() => void verifyNow()} className="gap-2">
                    <CheckCircle2 className="h-4 w-4" aria-hidden /> Verify
                  </Button>
                  <Button variant="outline" onClick={() => void signNow(-3600)} className="gap-2">
                    <History className="h-4 w-4" aria-hidden /> Replay an hour-old delivery
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                      setWhHeader((h) => h.replace(/v1=([0-9a-f]{4})/, "v1=dead"));
                      setWhResult(null);
                      toast.info("Signature tampered — verify to see the failure diagnosis.");
                    }}
                  >
                    <AlertTriangle className="h-4 w-4" aria-hidden /> Tamper signature
                  </Button>
                </div>

                {whResult && (
                  <div
                    role="status"
                    className={`rounded-xl border p-4 text-sm ${
                      whResult.valid
                        ? "border-status-success/40 bg-status-success/10"
                        : "border-destructive/40 bg-destructive/10"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      {whResult.valid
                        ? <ShieldCheck className="h-4 w-4 text-status-success" aria-hidden />
                        : <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden />}
                      {whResult.valid ? "Signature valid" : `Rejected — ${whResult.failure}`}
                    </div>
                    <p className="mt-1.5 text-muted-foreground">{whResult.detail}</p>
                    {whResult.expectedSignature && (
                      <dl className="mt-3 grid gap-1 font-mono text-[11px]">
                        <div className="truncate"><dt className="inline text-muted-foreground">expected </dt><dd className="inline">{whResult.expectedSignature}</dd></div>
                        <div className="truncate"><dt className="inline text-muted-foreground">provided </dt><dd className="inline">{whResult.providedSignature}</dd></div>
                        <div className="truncate"><dt className="inline text-muted-foreground">signed payload </dt><dd className="inline">{whResult.signedPayloadPreview}…</dd></div>
                      </dl>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Verification reference</CardTitle></CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-xl border border-border bg-muted/50 p-4 text-xs leading-relaxed">
<code>{`import crypto from "node:crypto";

export function verifyYallaWebhook(rawBody: string, header: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=")));
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t));
  if (!Number.isFinite(Number(parts.t)) || skew > ${DEFAULT_TOLERANCE_SECONDS}) return false; // replay guard

  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${parts.t}.\${rawBody}\`)   // raw bytes — never a re-serialised object
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? ""));
}`}</code>
                </pre>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================== KEYS & ROTATION */}
          <TabsContent value="keys" className="mt-6 space-y-6">
            {issued && (
              <Card className="border-status-success/40 bg-status-success/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <KeyRound className="h-4 w-4 text-status-success" aria-hidden /> Secret shown once
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground">
                    Store this in your secret manager now. Yalla keeps only a one-way hash — it cannot be
                    retrieved or re-sent. {issued.replaces_client_id && (
                      <>The previous credential <code className="font-mono text-xs">{issued.replaces_client_id}</code>{" "}
                      stays valid until {issued.grace_expires_at?.slice(0, 16).replace("T", " ")} UTC.</>
                    )}
                  </p>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-28 text-xs uppercase tracking-[0.12em] text-muted-foreground">Client ID</span>
                      <code className="flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">{issued.client_id}</code>
                      <CopyButton value={issued.client_id} label="client id" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-28 text-xs uppercase tracking-[0.12em] text-muted-foreground">Client secret</span>
                      <code className="flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">{issued.client_secret}</code>
                      <CopyButton value={issued.client_secret} label="client secret" />
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setIssued(null)}>I have stored it</Button>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle className="text-base">Issue a credential</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="key-label">Label</Label>
                    <Input
                      id="key-label"
                      className="mt-1"
                      placeholder="Checkout service — EU region"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="key-tier">Tier</Label>
                    <Select value={newTier} onValueChange={setNewTier}>
                      <SelectTrigger id="key-tier" className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COMMERCIAL_TIERS.map((t) => (
                          <SelectItem key={t.key} value={t.key}>{t.name} · {t.rateLimit}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Issued into the <strong className="text-foreground">{environment}</strong> environment.
                    Switch environment in the header above.
                  </div>
                </div>

                <fieldset>
                  <legend className="text-sm font-medium">Scopes (least privilege)</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ALL_SCOPES.map((s) => {
                      const on = newScopes.includes(s);
                      return (
                        <Button
                          key={s}
                          type="button"
                          size="sm"
                          variant={on ? "default" : "outline"}
                          aria-pressed={on}
                          className="h-7 font-mono text-xs"
                          onClick={() =>
                            setNewScopes((prev) => (on ? prev.filter((x) => x !== s) : [...prev, s]))
                          }
                        >
                          {s}
                        </Button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    className="gap-2"
                    disabled={!enabled || !canManage || newScopes.length === 0 || issueMutation.isPending}
                    onClick={() => issueMutation.mutate()}
                  >
                    <KeyRound className="h-4 w-4" aria-hidden />
                    {issueMutation.isPending ? "Issuing…" : "Issue credential"}
                  </Button>
                  {enabled && !canManage && (
                    <span className="text-sm text-muted-foreground">
                      Only partner owners and admins can issue, rotate or revoke credentials.
                    </span>
                  )}
                  {!enabled && (
                    <span className="text-sm text-muted-foreground">
                      Sign in with a partner login to manage credentials. Need access?{" "}
                      <a href={SALES_MAILTO} className="underline">Contact the integration desk</a>.
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">{environment} credentials</CardTitle></CardHeader>
              <CardContent>
                {envCreds.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No {environment} credentials issued yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Label</TableHead>
                        <TableHead>Client ID</TableHead>
                        <TableHead>Scopes</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Limits</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {envCreds.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">
                            {c.label}
                            <div className="text-xs text-muted-foreground">
                              Created {c.created_at.slice(0, 10)}
                              {c.last_used_at && ` · last used ${c.last_used_at.slice(0, 10)}`}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {c.client_id.slice(0, 18)}…
                            <div className="text-muted-foreground">secret ••••{c.secret_fingerprint}</div>
                          </TableCell>
                          <TableCell className="max-w-[220px]">
                            <div className="flex flex-wrap gap-1">
                              {c.scopes.map((s) => (
                                <Badge key={s} variant="secondary" className="font-mono text-[10px]">{s}</Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={c.status === "active" ? "default" : c.status === "rotating" ? "outline" : "destructive"}
                              className="text-[10px] uppercase"
                            >
                              {c.status}
                            </Badge>
                            {c.status === "rotating" && c.grace_expires_at && (
                              <div className="mt-1 text-[11px] text-status-warning">
                                grace ends {c.grace_expires_at.slice(0, 16).replace("T", " ")}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {nf.format(c.rate_limit_per_min)}/min
                            <div className="text-muted-foreground">{nf.format(c.monthly_quota)}/mo</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 px-2 text-xs"
                                disabled={!canManage || c.status === "revoked" || rotateMutation.isPending}
                                onClick={() => rotateMutation.mutate(c.id)}
                              >
                                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Rotate
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 px-2 text-xs text-destructive"
                                disabled={!canManage || c.status === "revoked" || revokeMutation.isPending}
                                onClick={() => revokeMutation.mutate(c.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Revoke
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-4 w-4" aria-hidden /> Credential audit history
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(audit.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No credential activity recorded. Every issue, rotation and revocation is written to an
                    append-only ledger that cannot be edited or deleted.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Environment</TableHead>
                        <TableHead>Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(audit.data ?? []).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap text-xs tabular-nums">
                            {row.created_at.slice(0, 16).replace("T", " ")}
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.action === "revoked" ? "destructive" : "secondary"} className="text-[10px] uppercase">
                              {row.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{row.environment}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.reason ?? JSON.stringify(row.metadata ?? {})}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MarketingPage>
  );
}
