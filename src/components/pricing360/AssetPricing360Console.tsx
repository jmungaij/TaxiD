import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Layers, Lock, PlayCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppButton } from "@/components/nav/AppButton";
import { PricingExplained } from "@/components/pricing360/PricingExplained";
import { Ap360AuditTimeline } from "@/components/pricing360/Ap360AuditTimeline";
import { Ap360ShadowCompare } from "@/components/pricing360/Ap360ShadowCompare";
import { logPricingAction } from "@/lib/pricing360/audit";
import {
  ap360Quote, createDraftVersion, fetchCategories, fetchCostInputs, fetchEngines, fetchFamilies,
  fetchAp360Capabilities, fetchProfiles, fetchVersions, saveDraftParams, transitionVersion, validateVersion,
  AP360_NO_CAPABILITIES, type Ap360Capabilities,
  type Ap360Category, type Ap360CostInput, type Ap360Engine, type Ap360Family, type Ap360Profile,
  type Ap360Quote, type Ap360Validation, type Ap360Version, type Ap360Action,
} from "@/lib/pricing360/ap360";

/** The lifecycle exactly as the backend enforces it. */
const LIFECYCLE: { key: string; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Validated & submitted" },
  { key: "approved", label: "Approved" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
];

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-info/10 text-info",
  approved: "bg-success/10 text-success",
  scheduled: "bg-warning/10 text-warning-foreground",
  published: "bg-primary/10 text-primary",
  active: "bg-primary/10 text-primary",
  rejected: "bg-destructive/10 text-destructive",
  superseded: "bg-muted text-muted-foreground",
  archived: "bg-muted text-muted-foreground",
};

/** Mission inputs each engine actually consumes — nothing irrelevant is asked. */
const ENGINE_TEST_FIELDS: Record<string, { key: string; label: string; def: number }[]> = {
  time_distance: [
    { key: "days", label: "Days", def: 1 },
    { key: "distance_km", label: "Distance (km)", def: 250 },
  ],
  trip_payload: [
    { key: "distance_km", label: "Distance (km)", def: 320 },
    { key: "empty_return_km", label: "Empty return (km)", def: 0 },
    { key: "waiting_hours", label: "Waiting hours", def: 0 },
  ],
  hours_mobilisation: [
    { key: "hours", label: "Operating hours", def: 8 },
    { key: "days", label: "Days on site", def: 1 },
    { key: "standby_hours", label: "Standby hours", def: 0 },
  ],
  block_hour: [
    { key: "hours", label: "Block hours", def: 2 },
    { key: "positioning_hours", label: "Positioning hours", def: 0.5 },
    { key: "landings", label: "Landings", def: 2 },
    { key: "passengers", label: "Passengers", def: 4 },
  ],
  vessel_hours: [
    { key: "hours", label: "Cruising hours", def: 4 },
    { key: "passengers", label: "Passengers", def: 8 },
    { key: "nights", label: "Nights", def: 0 },
  ],
  negotiated: [],
  contract: [
    { key: "days", label: "Days", def: 20 },
    { key: "distance_km", label: "Distance (km)", def: 0 },
    { key: "passengers", label: "Passengers", def: 0 },
  ],
};

/** Human labels so the console reads as commercial policy, not database keys. */
function humanise(key: string): string {
  return key
    .replace(/_pct$/, " %")
    .replace(/_kes$/, " (KES)")
    .replace(/_l_per_hour$/, " (litres/hour)")
    .replace(/_l_per_100km$/, " (litres/100km)")
    .replace(/_t$/, " (tonnes)")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Asset Pricing 360 — engine-aware governance console.
 *
 * Each asset family is priced by its own engine, so the editor renders only the
 * parameters that engine accepts, marks the ones it requires, and refuses to
 * advance a version the server says is invalid. Every state shown here
 * (draft → submitted → approved → published) is the state the backend
 * confirmed, never an optimistic client guess.
 */
export function AssetPricing360Console() {
  const [loading, setLoading] = useState(true);
  const [engines, setEngines] = useState<Ap360Engine[]>([]);
  const [families, setFamilies] = useState<Ap360Family[]>([]);
  const [categories, setCategories] = useState<Ap360Category[]>([]);
  const [family, setFamily] = useState<string>("");
  const [categoryCode, setCategoryCode] = useState<string>("");
  const [profiles, setProfiles] = useState<Ap360Profile[]>([]);
  const [profileId, setProfileId] = useState<string>("");
  const [versions, setVersions] = useState<Ap360Version[]>([]);
  const [versionId, setVersionId] = useState<string>("");
  const [costs, setCosts] = useState<Ap360CostInput[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [validation, setValidation] = useState<Ap360Validation | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<Ap360Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  /** Permissions as the backend decides them — never inferred on the client. */
  const [caps, setCaps] = useState<Ap360Capabilities>(AP360_NO_CAPABILITIES);
  /** Set when the server itself refused an action, so the UI can say so plainly. */
  const [denial, setDenial] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [e, f, c, k] = await Promise.all([
          fetchEngines(), fetchFamilies(), fetchCategories(), fetchAp360Capabilities(),
        ]);
        setEngines(e); setFamilies(f); setCategories(c); setCaps(k);
        const firstFamily = f[0]?.code ?? "";
        setFamily(firstFamily);
        setCategoryCode(c.find((x) => x.family_code === firstFamily)?.code ?? "");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load the pricing taxonomy");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const category = useMemo(() => categories.find((c) => c.code === categoryCode) ?? null, [categories, categoryCode]);
  const version = useMemo(() => versions.find((v) => v.id === versionId) ?? null, [versions, versionId]);
  const engine = useMemo(
    () => engines.find((e) => e.code === (version?.engine_code ?? category?.engine_code)) ?? null,
    [engines, version, category],
  );
  const isDraftState = version?.status === "draft" || version?.status === "rejected";
  /** Editable only when the record allows it AND the backend grants draft authority. */
  const editable = isDraftState && caps.can_edit_draft;

  useEffect(() => {
    if (!categoryCode) { setProfiles([]); setProfileId(""); return; }
    void fetchProfiles(categoryCode)
      .then((p) => { setProfiles(p); setProfileId(p[0]?.id ?? ""); })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not load pricing profiles"));
  }, [categoryCode]);

  const loadVersions = useCallback(async (pid: string) => {
    const v = await fetchVersions(pid);
    setVersions(v);
    setVersionId(v[0]?.id ?? "");
  }, []);

  useEffect(() => {
    if (!profileId) { setVersions([]); setVersionId(""); return; }
    void loadVersions(profileId).catch((e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not load pricing versions"));
  }, [profileId, loadVersions]);

  useEffect(() => {
    setValidation(null); setQuote(null);
    if (!version) { setDraft({}); setCosts([]); return; }
    const params = version.params ?? {};
    setDraft(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v === null ? "" : String(v)])));
    setReason(version.reason ?? "");
    void fetchCostInputs(version.id).then(setCosts).catch(() => setCosts([]));
  }, [version]);

  useEffect(() => {
    const fields = ENGINE_TEST_FIELDS[engine?.code ?? ""] ?? [];
    setTest(Object.fromEntries(fields.map((f) => [f.key, f.def])));
  }, [engine?.code]);

  const runValidation = useCallback(async () => {
    if (!version) return null;
    const v = await validateVersion(version.id);
    setValidation(v);
    return v;
  }, [version]);

  const persistDraft = async () => {
    if (!version || !editable) return;
    setBusy(true);
    try {
      const params: Record<string, number | string | boolean> = {};
      for (const [k, raw] of Object.entries(draft)) {
        if (raw === "" || raw === undefined) continue;
        const num = Number(raw);
        params[k] = Number.isFinite(num) && raw.trim() !== "" ? num : raw;
      }
      await saveDraftParams(version.id, { params, reason });
      await logPricingAction({
        rbac: "allowed",
        action: "save", entity: "ap360_version", entityId: version.id,
        reason: reason || `Draft parameters saved for ${category?.label ?? categoryCode}`,
        before: version.params as Record<string, unknown>, after: params,
      });
      await loadVersions(profileId);
      const v = await validateVersion(version.id);
      setValidation(v);
      toast.success(v.valid ? "Draft saved and valid" : "Draft saved — validation still failing");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the draft");
    } finally {
      setBusy(false);
    }
  };

  const move = async (action: Ap360Action) => {
    if (!version) return;
    if (!reason.trim()) { toast.error("A written reason is required for every pricing state change"); return; }
    setBusy(true);
    try {
      const res = await transitionVersion(version.id, action, reason.trim());
      if (!res.ok) {
        setValidation(res.validation ?? null);
        toast.error("Blocked: the pricing authority rejected this version until validation passes");
        return;
      }
      await logPricingAction({
        rbac: "allowed",
        action: action === "publish" ? "publish" : action === "approve" ? "approve" : action === "reject" ? "reject" : "save",
        entity: "ap360_version", entityId: version.id, reason: reason.trim(),
        before: { status: version.status }, after: { status: res.status },
      });
      await loadVersions(profileId);
      setValidation(null);
      toast.success(`Version is now ${res.status}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "The transition was refused";
      const refused = /not authoris|permission denied|row-level security/i.test(message);
      setDenial(refused ? message : null);
      await logPricingAction({
        rbac: refused ? "denied" : "error",
        action: action === "publish" ? "publish" : action === "approve" ? "approve" : action === "reject" ? "reject" : "save",
        entity: "ap360_version", entityId: version.id,
        reason: `${action} refused: ${message}`,
      });
      toast.error(refused ? "Insufficient permissions for this pricing action" : message);
    } finally {
      setBusy(false);
    }
  };

  const openDraft = async () => {
    if (!version) return;
    setBusy(true);
    try {
      const next = Math.max(...versions.map((v) => v.version), 0) + 1;
      const id = await createDraftVersion(version, next);
      await logPricingAction({
        rbac: "allowed",
        action: "save", entity: "ap360_version", entityId: id,
        reason: `Draft v${next} opened from v${version.version}`,
      });
      await loadVersions(profileId);
      setVersionId(id);
      toast.success(`Draft v${next} opened`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open a draft");
    } finally {
      setBusy(false);
    }
  };

  const runQuote = async () => {
    if (!categoryCode) return;
    setQuoting(true);
    try {
      setQuote(await ap360Quote({ category_code: categoryCode, ...test }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The pricing authority did not answer");
    } finally {
      setQuoting(false);
    }
  };

  if (loading) return <Skeleton className="h-64 w-full" />;

  const stageIndex = LIFECYCLE.findIndex((s) => s.key === (version?.status === "active" ? "published" : version?.status));

  /**
   * The operator's authority, stated action by action. Rendered in both the
   * granted and the refused state so assistive technology always hears which
   * pricing verbs are blocked and why, never a bare word.
   */
  const authorityList = (
    <span className="ml-auto flex flex-wrap gap-1.5" role="list" aria-label="Pricing actions you may take">
      {[
        { label: "Edit drafts", on: caps.can_edit_draft },
        { label: "Submit", on: caps.can_submit },
        { label: "Approve", on: caps.can_approve },
        { label: "Reject", on: caps.can_reject },
        { label: "Publish", on: caps.can_publish },
        { label: "Archive", on: caps.can_archive },
        { label: "Compare", on: caps.can_compare },
      ].map((g) => (
        <Badge
          key={g.label}
          role="listitem"
          aria-label={`${g.label}: ${g.on ? "granted" : "blocked — insufficient permissions"}`}
          className={g.on ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}
        >
          {g.on ? g.label : `${g.label} — blocked`}
        </Badge>
      ))}
      {caps.roles.map((r) => <Badge key={r} variant="outline">{r}</Badge>)}
    </span>
  );

  if (!caps.can_view) {
    return (
      <Card data-testid="ap360-console" role="region" aria-labelledby="ap360-denied-heading">
        <CardHeader className="pb-3">
          <CardTitle id="ap360-denied-heading" className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-warning-foreground" aria-hidden /> Insufficient permissions
          </CardTitle>
          <CardDescription>Asset Pricing 360 governs live commercial pricing, so access is granted by role.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p
            role="alert"
            aria-label={`Insufficient permissions: ${caps.reason}`}
            className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning-foreground"
          >
            {caps.reason}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">{authorityList}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="ap360-console">
      {/* What this operator may actually do, straight from the pricing authority. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
        <span className="font-medium">Your pricing authority</span>
        <span className="text-muted-foreground">{caps.reason}</span>
        {authorityList}
      </div>


      {denial && (
        <p
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4" aria-hidden />
          Insufficient permissions — the pricing authority refused that action: {denial}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" aria-hidden /> Asset family and pricing engine
          </CardTitle>
          <CardDescription>
            Each family is governed by its own economic model. The editor shows only the parameters that model accepts.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Family</Label>
            <Select
              value={family}
              onValueChange={(v) => {
                setFamily(v);
                setCategoryCode(categories.find((c) => c.family_code === v)?.code ?? "");
              }}
            >
              <SelectTrigger><SelectValue placeholder="Family" /></SelectTrigger>
              <SelectContent>
                {families.map((f) => <SelectItem key={f.code} value={f.code}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={categoryCode} onValueChange={setCategoryCode}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                {categories.filter((c) => c.family_code === family).map((c) => (
                  <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Pricing profile</Label>
            <Select value={profileId} onValueChange={setProfileId} disabled={profiles.length === 0}>
              <SelectTrigger><SelectValue placeholder={profiles.length ? "Profile" : "No profile configured"} /></SelectTrigger>
              <SelectContent>
                {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.label} · {p.geography}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Version</Label>
            <Select value={versionId} onValueChange={setVersionId} disabled={versions.length === 0}>
              <SelectTrigger><SelectValue placeholder={versions.length ? "Version" : "No version yet"} /></SelectTrigger>
              <SelectContent>
                {versions.map((v) => <SelectItem key={v.id} value={v.id}>v{v.version} · {v.status}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-4 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{engine ? engine.label : "No engine"}</Badge>
            {category?.reference_low != null && (
              <span className="text-muted-foreground">
                Market reference {category.reference_low.toLocaleString()}–{category.reference_high?.toLocaleString()} {category.reference_unit}
              </span>
            )}
            {profiles.length === 0 && (
              <span className="text-warning-foreground">
                No pricing profile exists for this category yet, so nothing can be priced — that is reported, not defaulted.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {version && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Publication workflow</CardTitle>
                <CardDescription>State confirmed by the pricing authority after every action.</CardDescription>
              </div>
              <Badge className={STATUS_TONE[version.status] ?? "bg-muted"}>{version.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="flex flex-wrap items-center gap-2 text-xs">
              {LIFECYCLE.map((s, i) => (
                <li key={s.key} className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-3 py-1 ${
                      i <= stageIndex && stageIndex >= 0
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {s.label}
                  </span>
                  {i < LIFECYCLE.length - 1 && <span className="text-muted-foreground">→</span>}
                </li>
              ))}
            </ol>

            <div className="space-y-1">
              <Label htmlFor="ap360-reason">Reason (required and recorded)</Label>
              <Textarea
                id="ap360-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                placeholder="Why is this pricing changing?"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <AppButton action="submit" analytics="ap360_validate_version" variant="outline" onClick={() => void runValidation()} disabled={busy || !caps.can_view}>
                Validate this version
              </AppButton>
              <AppButton
                action="submit"
                analytics="ap360_submit_version"
                onClick={() => void move("submit")}
                disabled={busy || !caps.can_submit || !isDraftState}
              >
                Submit for approval
              </AppButton>
              <AppButton action="submit" analytics="ap360_approve_version" variant="outline" onClick={() => void move("approve")} disabled={busy || !caps.can_approve || version.status !== "submitted"}>
                Approve
              </AppButton>
              <AppButton action="submit" analytics="ap360_reject_version" variant="outline" onClick={() => void move("reject")} disabled={busy || !caps.can_reject || version.status !== "submitted"}>
                Reject
              </AppButton>
              <AppButton action="submit" analytics="ap360_publish_version" onClick={() => void move("publish")} disabled={busy || !caps.can_publish || version.status !== "approved"}>
                Publish
              </AppButton>
              <AppButton action="submit" analytics="ap360_open_draft" variant="ghost" onClick={() => void openDraft()} disabled={busy || !caps.can_edit_draft}>
                Open new draft from this version
              </AppButton>
            </div>

            {validation && (
              <div
                role={validation.valid ? "status" : "alert"}
                aria-label={validation.valid ? "Validation passed" : "Validation failed — publication is blocked"}
                className={`rounded-lg border p-3 text-sm ${
                  validation.valid ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"
                }`}
              >
                <p className="flex items-center gap-2 font-medium">
                  {validation.valid
                    ? <><CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> Validation passed</>
                    : <><AlertTriangle className="h-4 w-4 text-destructive" aria-hidden /> Validation failed — publication is blocked</>}
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  {(validation.errors ?? []).map((e) => <li key={e} className="text-destructive">• {e}</li>)}
                  {(validation.warnings ?? []).map((w) => <li key={w} className="text-warning-foreground">• {w}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {version && engine && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {!editable && <Lock className="h-4 w-4 text-muted-foreground" aria-hidden />}
              {engine.label} parameters
            </CardTitle>
            <CardDescription>
              {editable
                ? "Required parameters are marked. Anything this engine does not accept is not offered."
                : "This version is beyond draft, so its parameters are immutable. Open a new draft to change pricing."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {engine.parameter_keys.map((k) => {
                const required = engine.required_keys.includes(k);
                const invalid = required && !String(draft[k] ?? "").trim();
                return (
                  <div key={k} className="space-y-1">
                    <Label htmlFor={`p-${k}`} className="text-xs">
                      {humanise(k)}
                      {required && <span className="ml-1 text-destructive">*</span>}
                    </Label>
                    <Input
                      id={`p-${k}`}
                      value={draft[k] ?? ""}
                      disabled={!editable}
                      aria-invalid={invalid}
                      className={invalid ? "border-destructive" : undefined}
                      onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                    />
                    {invalid && <p className="text-xs text-destructive">Required by this engine</p>}
                  </div>
                );
              })}
            </div>
            <Separator />
            <div className="grid gap-3 text-sm md:grid-cols-4">
              <Fact label="Commission" value={`${version.commission_pct}%`} />
              <Fact label="Max discount" value={`${version.max_discount_pct}%`} />
              <Fact label="Demand ceiling" value={`×${version.demand_ceiling}`} />
              <Fact label="Target margin" value={`${version.target_margin_pct}%`} />
              <Fact label="Fuel policy" value={version.fuel_policy} />
              <Fact label="Tax rule" value={version.tax_rule_code ?? "None"} />
              <Fact label="Cost inputs" value={costs.length ? `${costs.length} recorded` : "None — floor unproven"} />
              <Fact label="Effective from" value={new Date(version.effective_from).toLocaleDateString()} />
            </div>
            {editable && (
              <AppButton action="submit" analytics="ap360_save_draft" onClick={() => void persistDraft()} disabled={busy || !editable}>Save draft parameters</AppButton>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PlayCircle className="h-4 w-4" aria-hidden /> Price this mission
          </CardTitle>
          <CardDescription>
            Calculated by the authority (`ap360_quote`) using the published version — the console never prices in the browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            {(ENGINE_TEST_FIELDS[engine?.code ?? ""] ?? []).map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`t-${f.key}`} className="text-xs">{f.label}</Label>
                <Input
                  id={`t-${f.key}`} type="number" value={test[f.key] ?? 0}
                  onChange={(e) => setTest((t) => ({ ...t, [f.key]: Number(e.target.value) }))}
                />
              </div>
            ))}
            {(ENGINE_TEST_FIELDS[engine?.code ?? ""] ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground md:col-span-4">
                This engine produces a negotiated quote, so there are no mission inputs to price.
              </p>
            )}
          </div>
          <AppButton action="submit" analytics="ap360_run_quote" onClick={() => void runQuote()} disabled={quoting || !categoryCode || !caps.can_view}>Run governed quote</AppButton>
          <PricingExplained quote={quote} loading={quoting} showGovernance title="Pricing explained (governance view)" />
        </CardContent>
      </Card>

      <Ap360ShadowCompare
        categoryCode={categoryCode}
        categoryLabel={category?.label}
        inputs={test}
        fields={ENGINE_TEST_FIELDS[engine?.code ?? ""] ?? []}
        permitted={caps.can_compare}
      />

      <Ap360AuditTimeline
        versionId={version?.id}
        subject={version ? `${category?.label ?? categoryCode} v${version.version}` : undefined}
        permitted={caps.can_view}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

export default AssetPricing360Console;
