/**
 * Logistics Integration Control Centre — /dashboard/admin/logistics-integrations
 *
 * Operates the Phase 4 platform: the canonical event stream, partner webhook
 * endpoints, delivery telemetry with retries and dead letters, tenant
 * entitlements, rate limits and API observability. Every control on this page
 * calls a real backend operation; nothing here is illustrative.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Activity, AlertTriangle, KeyRound, Play, Plug, RefreshCw, Rocket, ShieldAlert, Webhook } from "lucide-react";
import { toast } from "sonner";
import {
  HEALTH_TONE,
  INTEGRATION_EVENT_TYPES,
  LOGISTICS_API_SCOPES,
  deriveIntegrationHealth,
  eventsByAggregate,
  validateWebhookUrl,
} from "@/lib/logistics/integration/eventCatalogue";
import {
  fetchApiRequests,
  fetchDeliveries,
  fetchEndpoints,
  fetchEvents,
  fetchOverview,
  fetchPartners,
  fetchRateLimits,
  fetchTenantGrants,
  grantTenant,
  replayDelivery,
  rotateEndpointSecret,
  runDispatcher,
  revokeTenant,
  saveEndpoint,
  setEndpointStatus,
  type ApiEnvironment,
  type ApiRequestRow,
  type DeliveryRow,
  type IntegrationEventRow,
  type IntegrationOverview,
  type WebhookEndpointRow,
} from "@/lib/logistics/integration/integrationEngine";

const toneClass: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  info: "bg-info/10 text-info border-info/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  muted: "bg-muted text-muted-foreground border-border",
};

const statusTone: Record<string, string> = {
  delivered: "success",
  pending: "info",
  processing: "info",
  retrying: "warning",
  failed: "danger",
  dead_letter: "danger",
};

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }) : "—");

export default function LogisticsIntegrations() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<IntegrationOverview | null>(null);
  const [endpoints, setEndpoints] = useState<WebhookEndpointRow[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [events, setEvents] = useState<IntegrationEventRow[]>([]);
  const [requests, setRequests] = useState<ApiRequestRow[]>([]);
  const [partners, setPartners] = useState<{ id: string; partner_code: string; legal_name: string; status: string }[]>([]);
  const [grants, setGrants] = useState<Awaited<ReturnType<typeof fetchTenantGrants>>>([]);
  const [limits, setLimits] = useState<Awaited<ReturnType<typeof fetchRateLimits>>>([]);
  const [deliveryFilter, setDeliveryFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [secretOnce, setSecretOnce] = useState<{ label: string; secret: string } | null>(null);
  const [inspect, setInspect] = useState<DeliveryRow | null>(null);

  const [form, setForm] = useState<{
    id: string | null;
    partnerId: string;
    label: string;
    url: string;
    environment: ApiEnvironment;
    events: string[];
    tenantId: string;
  }>({ id: null, partnerId: "", label: "", url: "", environment: "sandbox", events: [], tenantId: "" });

  const [grantForm, setGrantForm] = useState({ partnerId: "", tenantId: "", environment: "sandbox" as ApiEnvironment, scopes: [] as string[] });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [o, e, d, ev, r, p, g, l] = await Promise.all([
        fetchOverview(),
        fetchEndpoints(),
        fetchDeliveries({ limit: 150 }),
        fetchEvents({ limit: 100 }),
        fetchApiRequests(100),
        fetchPartners(),
        fetchTenantGrants(),
        fetchRateLimits(),
      ]);
      setOverview(o);
      setEndpoints(e);
      setDeliveries(d);
      setEvents(ev);
      setRequests(r);
      setPartners(p);
      setGrants(g);
      setLimits(l);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load integration state.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredDeliveries = useMemo(
    () => (deliveryFilter === "all" ? deliveries : deliveries.filter((d) => d.status === deliveryFilter)),
    [deliveries, deliveryFilter],
  );

  const urlCheck = form.url ? validateWebhookUrl(form.url) : { valid: true as const };

  const act = async (key: string, fn: () => Promise<{ ok: boolean; code?: string; message?: string; secret?: unknown }>, success: string) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.message ?? res.code ?? "Operation refused");
        return null;
      }
      toast.success(success);
      await load();
      return res;
    } finally {
      setBusy(null);
    }
  };

  const submitEndpoint = async () => {
    if (!form.partnerId) return toast.error("Choose the partner this endpoint belongs to.");
    if (!form.label.trim()) return toast.error("Give the endpoint a label.");
    if (!urlCheck.valid) return toast.error(urlCheck.reason ?? "Destination refused.");
    if (form.events.length === 0) return toast.error("Subscribe the endpoint to at least one event.");
    const res = await act(
      "endpoint",
      () =>
        saveEndpoint({
          id: form.id,
          partnerId: form.partnerId,
          label: form.label.trim(),
          url: form.url.trim(),
          environment: form.environment,
          events: form.events,
          tenantId: form.tenantId.trim() || null,
        }),
      form.id ? "Endpoint updated." : "Endpoint created.",
    );
    if (res?.secret) setSecretOnce({ label: form.label.trim(), secret: String(res.secret) });
    if (res?.ok) setForm({ id: null, partnerId: "", label: "", url: "", environment: "sandbox", events: [], tenantId: "" });
  };

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Plug className="h-6 w-6 text-primary" aria-hidden />
            Logistics Integration Control Centre
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            One event model, published outward. Events are emitted by the authoritative transaction, fanned out to
            subscribed partner endpoints in shipment order, signed, retried with bounded backoff and dead-lettered —
            never regenerated from this screen.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
          </Button>
          <Button
            onClick={async () => {
              setBusy("dispatch");
              const res = await runDispatcher(25);
              setBusy(null);
              if (!res.ok) toast.error(res.message ?? "Dispatcher run failed.");
              else toast.success(`Dispatcher processed ${res.claimed ?? 0} delivery attempt(s).`);
              void load();
            }}
            disabled={busy === "dispatch"}
          >
            <Play className="mr-2 h-4 w-4" aria-hidden /> Run dispatcher
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Events (24h)", value: overview?.events_24h ?? 0, hint: `${overview?.events_total ?? 0} total` },
          { label: "Delivery success (24h)", value: overview?.delivery_success_rate_24h != null ? `${overview.delivery_success_rate_24h}%` : "—", hint: "derived from attempts" },
          { label: "Dead letters", value: overview?.dead_letters ?? 0, hint: "await replay" },
          { label: "API calls (24h)", value: overview?.api_requests_24h ?? 0, hint: `${overview?.api_error_rate_24h ?? 0}% errors` },
          { label: "API p95 latency", value: overview?.api_p95_latency_ms != null ? `${overview.api_p95_latency_ms} ms` : "—", hint: "partner-facing" },
          { label: "Active endpoints", value: overview?.endpoints?.ACTIVE ?? 0, hint: `${endpoints.length} registered` },
        ].map((m) => (
          <Card key={m.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{m.label}</p>
            <p className="mt-1 text-2xl font-semibold">{m.value}</p>
            <p className="text-xs text-muted-foreground">{m.hint}</p>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="endpoints">
        <TabsList className="flex-wrap">
          <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries &amp; retries</TabsTrigger>
          <TabsTrigger value="events">Event stream</TabsTrigger>
          <TabsTrigger value="tenants">Tenant entitlements</TabsTrigger>
          <TabsTrigger value="api">API usage</TabsTrigger>
          <TabsTrigger value="catalogue">Catalogue &amp; scopes</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------ endpoints */}
        <TabsContent value="endpoints" className="space-y-4">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Webhook className="h-5 w-5 text-primary" aria-hidden /> {form.id ? "Edit endpoint" : "Register endpoint"}
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Partner</Label>
                <Select value={form.partnerId} onValueChange={(v) => setForm((f) => ({ ...f, partnerId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select partner" /></SelectTrigger>
                  <SelectContent>
                    {partners.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.legal_name} · {p.partner_code}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Environment</Label>
                <Select value={form.environment} onValueChange={(v) => setForm((f) => ({ ...f, environment: v as ApiEnvironment }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">Sandbox (synthetic traffic only)</SelectItem>
                    <SelectItem value="production">Production</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ep-label">Label</Label>
                <Input id="ep-label" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Acme fulfilment callbacks" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ep-tenant">Tenant id (optional)</Label>
                <Input id="ep-tenant" value={form.tenantId} onChange={(e) => setForm((f) => ({ ...f, tenantId: e.target.value }))} placeholder="Leave blank for all entitled tenants" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="ep-url">Destination URL</Label>
                <Input id="ep-url" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://partner.example.com/hooks/yalla" />
                {!urlCheck.valid && <p className="text-xs text-destructive">{urlCheck.reason}</p>}
              </div>
            </div>

            <Separator className="my-4" />
            <p className="text-sm font-medium">Event subscriptions</p>
            <p className="mb-3 text-xs text-muted-foreground">
              A partner receives only what it is subscribed to and entitled to. Internal operational events are never
              published automatically.
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              {eventsByAggregate().map((group) => (
                <div key={group.aggregate} className="rounded-md border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.aggregate}</p>
                  <div className="mt-2 space-y-2">
                    {group.events.map((e) => (
                      <label key={e.eventType} className="flex items-start gap-2 text-xs">
                        <Checkbox
                          checked={form.events.includes(e.eventType)}
                          onCheckedChange={(c) =>
                            setForm((f) => ({
                              ...f,
                              events: c ? [...f.events, e.eventType] : f.events.filter((x) => x !== e.eventType),
                            }))
                          }
                        />
                        <span className="font-mono">{e.eventType}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <Button onClick={() => void submitEndpoint()} disabled={busy === "endpoint"}>
                {form.id ? "Save endpoint" : "Create endpoint"}
              </Button>
              {form.id && (
                <Button variant="ghost" onClick={() => setForm({ id: null, partnerId: "", label: "", url: "", environment: "sandbox", events: [], tenantId: "" })}>
                  Cancel
                </Button>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Registered endpoints</h3>
            {endpoints.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No endpoints registered yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2">Endpoint</th><th>Env</th><th>Health</th><th>Events</th>
                      <th>Delivered</th><th>Consecutive failures</th><th>Secret</th><th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpoints.map((e) => {
                      const health = deriveIntegrationHealth({
                        status: e.status,
                        consecutiveFailures: e.consecutive_failures,
                        deliveredCount: e.delivered_count,
                        lastSuccessAt: e.last_success_at,
                        lastFailureAt: e.last_failure_at,
                      });
                      return (
                        <tr key={e.id} className="border-t align-top">
                          <td className="py-2">
                            <p className="font-medium">{e.label}</p>
                            <p className="max-w-[280px] truncate font-mono text-xs text-muted-foreground">{e.url}</p>
                            <p className="text-xs text-muted-foreground">{e.partner_name}</p>
                          </td>
                          <td className="capitalize">{e.environment}</td>
                          <td><Badge variant="outline" className={toneClass[HEALTH_TONE[health]]}>{health}</Badge></td>
                          <td>{e.subscribed_events.length}</td>
                          <td>{e.delivered_count}</td>
                          <td>{e.consecutive_failures}</td>
                          <td className="font-mono text-xs">…{e.secret_fingerprint}</td>
                          <td className="space-x-1 text-right">
                            <Button size="sm" variant="ghost" onClick={() => setForm({ id: e.id, partnerId: e.partner_id, label: e.label, url: e.url, environment: e.environment, events: e.subscribed_events, tenantId: e.tenant_id ?? "" })}>
                              Edit
                            </Button>
                            {e.status !== "ACTIVE" ? (
                              <Button size="sm" variant="outline" onClick={() => void act(`act-${e.id}`, () => setEndpointStatus(e.id, "ACTIVE"), "Endpoint activated.")}>
                                <Rocket className="mr-1 h-3 w-3" aria-hidden /> Activate
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => void act(`sus-${e.id}`, () => setEndpointStatus(e.id, "SUSPENDED", "Suspended by operator"), "Endpoint suspended.")}>
                                Suspend
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                const res = await act(`rot-${e.id}`, () => rotateEndpointSecret(e.id), "Signing secret rotated.");
                                if (res?.secret) setSecretOnce({ label: e.label, secret: String(res.secret) });
                              }}
                            >
                              <KeyRound className="mr-1 h-3 w-3" aria-hidden /> Rotate
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void act(`rev-${e.id}`, () => setEndpointStatus(e.id, "REVOKED", "Revoked by operator"), "Endpoint revoked.")}>
                              Revoke
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ deliveries */}
        <TabsContent value="deliveries" className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Activity className="h-4 w-4" aria-hidden /> Delivery history
              </h3>
              <Select value={deliveryFilter} onValueChange={setDeliveryFilter}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["all", "pending", "processing", "retrying", "delivered", "failed", "dead_letter"].map((s) => (
                    <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {filteredDeliveries.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No deliveries match this filter.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Event</th><th>Seq</th><th>Status</th><th>Attempt</th><th>HTTP</th><th>Latency</th><th>Next retry</th><th>Reason</th><th className="text-right">Actions</th></tr>
                  </thead>
                  <tbody>
                    {filteredDeliveries.map((d) => (
                      <tr key={d.id} className="border-t">
                        <td className="py-2 font-mono text-xs">{d.event_type}</td>
                        <td>{d.sequence}</td>
                        <td><Badge variant="outline" className={toneClass[statusTone[d.status] ?? "muted"]}>{d.status}</Badge></td>
                        <td>{d.attempt}/{d.max_attempts}</td>
                        <td>{d.http_status ?? "—"}</td>
                        <td>{d.latency_ms != null ? `${d.latency_ms} ms` : "—"}</td>
                        <td className="text-xs">{d.status === "retrying" ? fmt(d.next_retry_at) : "—"}</td>
                        <td className="max-w-[200px] truncate text-xs text-muted-foreground">{d.failure_reason ?? "—"}</td>
                        <td className="space-x-1 text-right">
                          <Button size="sm" variant="ghost" onClick={() => setInspect(d)}>Inspect</Button>
                          <Button size="sm" variant="outline" disabled={busy === `rp-${d.id}`} onClick={() => void act(`rp-${d.id}`, () => replayDelivery(d.id), "Replay queued with the original payload.")}>
                            Replay
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ events */}
        <TabsContent value="events">
          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Canonical event stream</h3>
            {events.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No integration events recorded yet. Events appear as real logistics transactions complete.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Type</th><th>Aggregate</th><th>Seq</th><th>Env</th><th>Actor</th><th>Correlation</th><th>Occurred</th></tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.event_id} className="border-t">
                        <td className="py-2 font-mono text-xs">{e.event_type} <span className="text-muted-foreground">{e.event_version}</span></td>
                        <td className="font-mono text-xs">{e.aggregate_type}/{e.aggregate_id.slice(0, 8)}</td>
                        <td>{e.sequence}</td>
                        <td>{e.is_synthetic ? <Badge variant="outline" className={toneClass.warning}>test</Badge> : e.environment}</td>
                        <td className="text-xs">{e.actor_type}</td>
                        <td className="font-mono text-xs">{e.correlation_id.slice(0, 12)}</td>
                        <td className="text-xs">{fmt(e.occurred_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ tenants */}
        <TabsContent value="tenants" className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Grant tenant entitlement</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              A partner can read a tenant's logistics data only through an active grant. Tenant isolation is enforced in
              the database, not in the API layer.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <Select value={grantForm.partnerId} onValueChange={(v) => setGrantForm((f) => ({ ...f, partnerId: v }))}>
                <SelectTrigger><SelectValue placeholder="Partner" /></SelectTrigger>
                <SelectContent>{partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.legal_name}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="Tenant id (uuid)" value={grantForm.tenantId} onChange={(e) => setGrantForm((f) => ({ ...f, tenantId: e.target.value }))} />
              <Select value={grantForm.environment} onValueChange={(v) => setGrantForm((f) => ({ ...f, environment: v as ApiEnvironment }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="sandbox">Sandbox</SelectItem><SelectItem value="production">Production</SelectItem></SelectContent>
              </Select>
              <Button
                onClick={() => {
                  if (!grantForm.partnerId || !grantForm.tenantId.trim()) return toast.error("Partner and tenant id are required.");
                  void act("grant", () => grantTenant({ ...grantForm, tenantId: grantForm.tenantId.trim() }), "Entitlement granted.");
                }}
                disabled={busy === "grant"}
              >
                Grant
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {LOGISTICS_API_SCOPES.map((s) => (
                <label key={s.scope} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                  <Checkbox
                    checked={grantForm.scopes.includes(s.scope)}
                    onCheckedChange={(c) => setGrantForm((f) => ({ ...f, scopes: c ? [...f.scopes, s.scope] : f.scopes.filter((x) => x !== s.scope) }))}
                  />
                  <span className="font-mono">{s.scope}</span>
                </label>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Active grants</h3>
            {grants.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No tenant entitlements granted.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">Partner</th><th>Tenant</th><th>Env</th><th>Scopes</th><th>Status</th><th className="text-right">Action</th></tr>
                </thead>
                <tbody>
                  {grants.map((g) => (
                    <tr key={g.id} className="border-t">
                      <td className="py-2">{partners.find((p) => p.id === g.partner_id)?.legal_name ?? g.partner_id.slice(0, 8)}</td>
                      <td className="font-mono text-xs">{g.tenant_label ?? g.tenant_id.slice(0, 12)}</td>
                      <td className="capitalize">{g.environment}</td>
                      <td className="text-xs">{g.scopes.length}</td>
                      <td><Badge variant="outline" className={toneClass[g.status === "active" ? "success" : "muted"]}>{g.status}</Badge></td>
                      <td className="text-right">
                        {g.status === "active" && (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void act(`gr-${g.id}`, () => revokeTenant(g.id), "Entitlement revoked.")}>
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ api usage */}
        <TabsContent value="api" className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Rate limits</h3>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr><th className="py-2">Scope</th><th>Value</th><th>Environment</th><th>Per minute</th><th>Burst</th></tr>
              </thead>
              <tbody>
                {limits.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-2 capitalize">{l.scope_kind}</td>
                    <td className="font-mono text-xs">{l.scope_value}</td>
                    <td className="capitalize">{l.environment}</td>
                    <td>{l.limit_per_minute}</td>
                    <td>{l.burst}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent API requests</h3>
            {requests.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No partner API traffic recorded yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Operation</th><th>Method</th><th>Status</th><th>Scope</th><th>Latency</th><th>Replay</th><th>When</th></tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="py-2 font-mono text-xs">{r.operation}</td>
                        <td>{r.method}</td>
                        <td><Badge variant="outline" className={toneClass[r.http_status >= 500 ? "danger" : r.http_status >= 400 ? "warning" : "success"]}>{r.http_status}{r.error_code ? ` ${r.error_code}` : ""}</Badge></td>
                        <td className="font-mono text-xs">{r.scope_required ?? "—"}</td>
                        <td>{r.latency_ms} ms</td>
                        <td>{r.idempotent_replay ? "yes" : "—"}</td>
                        <td className="text-xs">{fmt(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ catalogue */}
        <TabsContent value="catalogue" className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Event catalogue ({INTEGRATION_EVENT_TYPES.length} published events)
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Versioned. A breaking change ships as a new event version; an existing schema is never altered in place.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {eventsByAggregate().map((g) => (
                <div key={g.aggregate} className="rounded-md border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.aggregate}</p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {g.events.map((e) => (
                      <li key={e.eventType} className="flex items-start justify-between gap-3">
                        <span className="font-mono">{e.eventType}</span>
                        <span className="text-right text-muted-foreground">{e.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">API scopes</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {LOGISTICS_API_SCOPES.map((s) => (
                <li key={s.scope} className="flex flex-wrap items-baseline gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{s.scope}</code>
                  <span className="text-muted-foreground">{s.summary}</span>
                </li>
              ))}
            </ul>
            <Alert className="mt-4">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              <AlertDescription className="text-xs">
                Webhook signature scheme v2 — <code>SAFARID-Signature: t=&lt;unix&gt;,v1=&lt;hex hmac-sha256&gt;</code> over
                <code> ${"{t}"}.${"{rawBody}"}</code>. Verify with a ±300s timestamp tolerance and reject a repeated
                <code> SAFARID-Event-Id</code>. Signing secrets are shown once at creation and rotation, and are never
                readable afterwards.
              </AlertDescription>
            </Alert>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!secretOnce} onOpenChange={(o) => !o && setSecretOnce(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Signing secret — shown once</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Share this with {secretOnce?.label} over a secure channel. SAFARID cannot show it again.</p>
          <code className="block break-all rounded bg-muted p-3 text-xs">{secretOnce?.secret}</code>
          <DialogFooter><Button onClick={() => setSecretOnce(null)}>I have stored it</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!inspect} onOpenChange={(o) => !o && setInspect(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Delivery payload (frozen for replay)</DialogTitle></DialogHeader>
          <pre className="max-h-[420px] overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(inspect?.request_payload ?? {}, null, 2)}</pre>
          <DialogFooter><Button variant="outline" onClick={() => setInspect(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
