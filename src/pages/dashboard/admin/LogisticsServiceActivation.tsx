/**
 * Logistics Service Activation — the administrative surface over the
 * authoritative activation record (public.logistics_service_config).
 *
 * Everything shown here is computed server-side by the serviceability engine:
 * the dependency matrix, the unmet requirement codes and activation
 * eligibility. Saving configuration re-evaluates immediately, so supplying an
 * operational field is sufficient to move a service towards BOOKABLE — no code
 * change and no further engineering request.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldQuestion } from "lucide-react";
import { Helmet } from "react-helmet-async";
import { LogisticsLiveOps } from "@/components/logistics/LogisticsLiveOps";

type DependencyStatus =
  | "PASS"
  | "FAIL"
  | "MISSING_CONFIGURATION"
  | "OWNER_ACTION_REQUIRED"
  | "EXTERNAL_PROVIDER_REQUIRED"
  | "APPROVAL_REQUIRED";

interface Dependency {
  domain: string;
  status: DependencyStatus;
  reason_codes: string[];
  message: string;
  blocking: boolean;
  owner: string;
}

interface ServiceConfigShape {
  offering_code: string;
  lifecycle: string;
  self_service_booking: boolean;
  enquiry_enabled: boolean;
  service_areas: string[];
  operating_hours: { start: string; end: string; days: number[] } | null;
  daily_capacity_orders: number | null;
  rate_plan_id: string | null;
  pricing_verified: boolean;
  pod_required: string[];
  returns_policy: string | null;
  claims_policy: string | null;
  restricted_goods_policy: string | null;
  partner_eligibility_required: boolean;
  compliance_status: string;
  legal_approval_reference: string | null;
  activation_authority: string | null;
  notes: string | null;
}

interface ServiceSnapshot {
  offering_code: string;
  name: string;
  family: string;
  route: string;
  config: ServiceConfigShape;
  lifecycle: string;
  availability: string;
  self_service_bookable_public: boolean;
  pilot_only: boolean;
  dependencies: Dependency[];
  activation: { eligible: boolean; completeness: number; missing: { code: string; message: string; field: string }[] };
}

const statusTone: Record<DependencyStatus, string> = {
  PASS: "bg-primary/10 text-primary border-primary/30",
  FAIL: "bg-destructive/10 text-destructive border-destructive/30",
  MISSING_CONFIGURATION: "bg-muted text-muted-foreground border-border",
  OWNER_ACTION_REQUIRED: "bg-muted text-muted-foreground border-border",
  EXTERNAL_PROVIDER_REQUIRED: "bg-muted text-muted-foreground border-border",
  APPROVAL_REQUIRED: "bg-accent/10 text-accent-foreground border-accent/30",
};

const call = async (payload: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("logistics-service-activation", { body: payload });
  if (error) {
    // The function answers structured refusals with a non-2xx status; surface the
    // engine's own reason rather than a generic invocation message.
    const ctx = (error as { context?: { json?: () => Promise<Record<string, unknown>> } }).context;
    let detail: Record<string, unknown> | null = null;
    try {
      detail = ctx?.json ? await ctx.json() : null;
    } catch {
      detail = null;
    }
    throw Object.assign(new Error(String(detail?.message ?? error.message)), { detail });
  }
  return data as Record<string, unknown>;
};

export default function LogisticsServiceActivation() {
  const [services, setServices] = useState<ServiceSnapshot[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [draft, setDraft] = useState<Partial<ServiceConfigShape>>({});
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await call({ action: "status" });
      const list = (data.services as ServiceSnapshot[]) ?? [];
      setServices(list);
      setSelected((cur) => cur || list[0]?.offering_code || "");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Unable to load activation records.");
      setServices([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => services?.find((s) => s.offering_code === selected) ?? null, [services, selected]);

  useEffect(() => {
    setDraft({});
  }, [selected]);

  const field = <K extends keyof ServiceConfigShape>(key: K): ServiceConfigShape[K] | undefined =>
    (draft[key] as ServiceConfigShape[K] | undefined) ?? active?.config[key];

  const save = async () => {
    if (!active || Object.keys(draft).length === 0) return;
    setBusy(true);
    try {
      const data = await call({ action: "save", offering_code: active.offering_code, config: draft });
      const svc = data.service as ServiceSnapshot;
      setServices((prev) => (prev ?? []).map((s) => (s.offering_code === svc.offering_code ? svc : s)));
      setDraft({});
      toast.success("Configuration saved and re-evaluated", {
        description: svc.activation.eligible
          ? "All required dependencies now pass — this service can be activated."
          : `${svc.activation.completeness}% complete · ${svc.activation.missing.length} requirement(s) outstanding.`,
      });
    } catch (e) {
      toast.error("Save rejected", { description: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setBusy(false);
    }
  };

  const lifecycle = async (lifecycle_action: "ACTIVATE" | "PILOT" | "SUSPEND" | "DEACTIVATE") => {
    if (!active) return;
    setBusy(true);
    try {
      const data = await call({ action: "lifecycle", offering_code: active.offering_code, lifecycle_action });
      const svc = data.service as ServiceSnapshot;
      setServices((prev) => (prev ?? []).map((s) => (s.offering_code === svc.offering_code ? svc : s)));
      toast.success(`Lifecycle set to ${svc.lifecycle}`);
    } catch (e) {
      const detail = (e as { detail?: { missing?: { message: string }[] } }).detail;
      toast.error("Activation refused by the dependency engine", {
        description: detail?.missing?.map((m) => m.message).join(" ") ?? (e instanceof Error ? e.message : ""),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto max-w-7xl px-4 py-10">
      <Helmet>
        <title>Logistics Service Activation | Yalla Mobility Admin</title>
        <meta name="description" content="Configure, validate and activate logistics service offerings from the authoritative dependency engine." />
      </Helmet>

      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Delivery &amp; Logistics</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Service Activation &amp; Dependency Engine</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Bookability is calculated, never declared. Each offering is evaluated against eleven dependency domains; a service
          becomes bookable online only when every required dependency passes.
        </p>
      </header>

      <div className="mb-8">
        <LogisticsLiveOps />
      </div>

      {loadError && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Activation records unavailable</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {!services ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <nav aria-label="Service offerings" className="space-y-2">
            {services.map((s) => (
              <button
                key={s.offering_code}
                onClick={() => setSelected(s.offering_code)}
                className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                  s.offering_code === selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                }`}
              >
                <span className="block text-sm font-medium">{s.name}</span>
                <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{s.availability}</Badge>
                  {s.activation.completeness}% ready
                </span>
              </button>
            ))}
          </nav>

          {active && (
            <div className="space-y-6">
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {active.name}
                      <Badge variant="outline">{active.lifecycle}</Badge>
                    </CardTitle>
                    <CardDescription>
                      Public availability: <strong>{active.availability}</strong> ·{" "}
                      {active.self_service_bookable_public ? "online booking open" : "online booking closed"}
                      {active.pilot_only && " · pilot accounts only"}
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Re-evaluate
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void lifecycle("ACTIVATE")} disabled={busy || !active.activation.eligible}>
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      Activate for production
                    </Button>
                    <Button variant="outline" onClick={() => void lifecycle("PILOT")} disabled={busy}>
                      Run as pilot
                    </Button>
                    <Button variant="outline" onClick={() => void lifecycle("DEACTIVATE")} disabled={busy}>
                      Enquiry only
                    </Button>
                    <Button variant="destructive" onClick={() => void lifecycle("SUSPEND")} disabled={busy}>
                      Suspend
                    </Button>
                  </div>
                  {!active.activation.eligible && (
                    <Alert>
                      <ShieldQuestion className="h-4 w-4" />
                      <AlertTitle>Why is this service not bookable?</AlertTitle>
                      <AlertDescription>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                          {active.activation.missing.map((m) => (
                            <li key={m.code}>
                              <code className="text-xs">{m.code}</code> — {m.message}
                            </li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Dependency matrix</CardTitle>
                  <CardDescription>Server-evaluated. Missing configuration is never reported as a pass.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {active.dependencies.map((d) => (
                    <div key={d.domain} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{d.domain.replace(/_/g, " ")}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone[d.status]}`}>
                          {d.status}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{d.message}</p>
                      {d.reason_codes.length > 0 && (
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">{d.reason_codes.join(", ")}</p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Operational configuration</CardTitle>
                  <CardDescription>Owner-provided values. Saving re-runs validation immediately.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="areas">Served areas (comma separated)</Label>
                      <Input
                        id="areas"
                        value={(field("service_areas") ?? []).join(", ")}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            service_areas: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                          }))
                        }
                        placeholder="Nairobi CBD, Westlands, Ngara"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="capacity">Daily capacity (orders)</Label>
                      <Input
                        id="capacity"
                        type="number"
                        min={0}
                        value={field("daily_capacity_orders") ?? ""}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, daily_capacity_orders: e.target.value === "" ? null : Number(e.target.value) }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hours-start">Operating hours start</Label>
                      <Input
                        id="hours-start"
                        type="time"
                        value={field("operating_hours")?.start ?? ""}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            operating_hours: {
                              start: e.target.value,
                              end: field("operating_hours")?.end ?? "",
                              days: field("operating_hours")?.days ?? [1, 2, 3, 4, 5, 6],
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hours-end">Operating hours end</Label>
                      <Input
                        id="hours-end"
                        type="time"
                        value={field("operating_hours")?.end ?? ""}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            operating_hours: {
                              start: field("operating_hours")?.start ?? "",
                              end: e.target.value,
                              days: field("operating_hours")?.days ?? [1, 2, 3, 4, 5, 6],
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pod">Proof of delivery methods (comma separated)</Label>
                      <Input
                        id="pod"
                        value={(field("pod_required") ?? []).join(", ")}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            pod_required: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                          }))
                        }
                        placeholder="SIGNATURE, PHOTO, OTP"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="authority">Activation authority (accountable owner)</Label>
                      <Input
                        id="authority"
                        value={field("activation_authority") ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, activation_authority: e.target.value }))}
                        placeholder="Head of Logistics Operations"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="legal">Legal / compliance approval reference</Label>
                      <Input
                        id="legal"
                        value={field("legal_approval_reference") ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, legal_approval_reference: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="compliance">Compliance status</Label>
                      <Input
                        id="compliance"
                        value={field("compliance_status") ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, compliance_status: e.target.value.toUpperCase() }))}
                        placeholder="APPROVED | NOT_ASSESSED | REJECTED"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    {[
                      { key: "returns_policy" as const, label: "Returns policy" },
                      { key: "claims_policy" as const, label: "Claims policy" },
                      { key: "restricted_goods_policy" as const, label: "Restricted goods policy" },
                    ].map(({ key, label }) => (
                      <div key={key} className="space-y-2">
                        <Label htmlFor={key}>{label}</Label>
                        <Textarea
                          id={key}
                          rows={3}
                          value={field(key) ?? ""}
                          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    {[
                      { key: "pricing_verified" as const, label: "Pricing verified" },
                      { key: "self_service_booking" as const, label: "Allow online booking" },
                      { key: "enquiry_enabled" as const, label: "Accept enquiries" },
                    ].map(({ key, label }) => (
                      <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                        <Label htmlFor={key} className="text-sm">
                          {label}
                        </Label>
                        <Switch
                          id={key}
                          checked={Boolean(field(key))}
                          onCheckedChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-3">
                    <Button onClick={() => void save()} disabled={busy || Object.keys(draft).length === 0}>
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save &amp; validate
                    </Button>
                    <Button variant="ghost" onClick={() => setDraft({})} disabled={Object.keys(draft).length === 0}>
                      Discard changes
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
