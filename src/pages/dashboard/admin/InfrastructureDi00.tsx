/**
 * ADMIN → PRODUCTION COMMAND CENTER → INFRASTRUCTURE → DI-00
 *
 * The operating surface for the two isolated non-production PostgreSQL
 * environments that the database-dependent certification controls depend on.
 * Every state is read from `di00_overview`; every button terminates in a
 * guarded RPC or in the di00-orchestrator. Nothing here can mark a control as
 * passed, and no credential is ever displayed or transported.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, ArrowLeft, CheckCircle2, Database, DatabaseZap, HardDriveDownload,
  KeyRound, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Sliders, Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useTabDeepLink } from "@/hooks/useTabDeepLink";
import { cn } from "@/lib/utils";
import * as di00 from "@/lib/infrastructure/di00";
import { Di00CredentialPanel } from "@/components/logistics/Di00CredentialPanel";

const TABS = ["overview", "environments", "configuration", "backup", "actions", "evidence", "diagnostics"] as const;

function toneClass(tone: "ok" | "warn" | "danger" | "info") {
  return tone === "ok"
    ? "border-success/40 text-success"
    : tone === "warn"
      ? "border-warning/50 text-warning"
      : tone === "danger"
        ? "border-destructive/50 text-destructive"
        : "border-info/40 text-info";
}

function ResultBadge({ result }: { result: di00.CheckResult }) {
  return (
    <Badge variant="outline" className={cn("text-[10px] tracking-wide", toneClass(di00.CHECK_TONE[result]))}>
      {result.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}

function Withheld({ message }: { message: string }) {
  return (
    <Card className="border-destructive/30">
      <CardContent className="flex items-start gap-3 p-6">
        <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" />
        <div>
          <p className="text-sm font-semibold">Surface withheld</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </CardContent>
    </Card>
  );
}

interface ConfigForm {
  environmentName: string;
  provider: string;
  providerProjectRef: string;
  region: string;
  hostRef: string;
  databaseReference: string;
  deploymentReference: string;
  credentialSecretName: string;
  notes: string;
}

const emptyForm: ConfigForm = {
  environmentName: "", provider: "", providerProjectRef: "", region: "", hostRef: "",
  databaseReference: "", deploymentReference: "", credentialSecretName: "", notes: "",
};

export default function InfrastructureDi00() {
  const { toast } = useToast();
  const { tab: activeTab, onTabChange } = useTabDeepLink(TABS, "overview");

  const [data, setData] = useState<di00.Di00Overview | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, ConfigForm>>({});
  const [actionResult, setActionResult] = useState<Record<string, string>>({});
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    const res = await di00.overview();
    if (!mounted.current) return;
    if (res.ok) {
      setData(res.data);
      setError(null);
      setDenied(null);
      setForms((prev) => {
        const next = { ...prev };
        for (const e of res.data.environments) {
          if (!next[e.environment_key]) {
            next[e.environment_key] = {
              ...emptyForm,
              environmentName: e.environment_name,
              provider: e.provider ?? "",
              providerProjectRef: e.provider_project_ref ?? "",
              region: e.region ?? "",
              hostRef: e.host_ref ?? "",
              databaseReference: e.database_reference ?? "",
              deploymentReference: e.deployment_reference ?? "",
              credentialSecretName: e.credential_secret_name ?? "",
              notes: e.notes ?? "",
            };
          }
        }
        return next;
      });
    } else if (res.denied) {
      setDenied(res.message);
    } else {
      setError(res.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(
    async (key: string, fn: () => Promise<di00.Result<unknown>>, successTitle: string) => {
      setBusy(key);
      const res = await fn();
      setBusy(null);
      if (!res.ok) {
        toast({ title: `${successTitle} not completed`, description: `${res.code} — ${res.message}`, variant: "destructive" });
      } else {
        toast({ title: successTitle, description: "Recorded with authoritative evidence." });
      }
      await load();
      return res;
    },
    [toast, load],
  );

  const staging = data?.environments.find((e) => e.environment_type === "STAGING");
  const restore = data?.environments.find((e) => e.environment_type === "RESTORE");
  const healthFor = (id?: string) => data?.health.find((h) => h.environment_id === id);
  const blockers = useMemo(() => (data ? di00.deriveBlockers(data) : []), [data]);
  const state = data ? di00.overallState(data) : "CONFIGURATION_REQUIRED";
  const verifiedBackup = data?.backups.find((b) => b.state === "SUCCEEDED" && b.integrity_result === "PASS");

  if (denied) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Helmet><title>DI-00 Infrastructure | TaxiD</title></Helmet>
        <Withheld message={denied} />
      </div>
    );
  }

  const renderEnvironment = (env: di00.InfraEnvironment | undefined, role: "STAGING" | "RESTORE") => {
    if (!env) return <p className="text-sm text-muted-foreground">No {role.toLowerCase()} environment registered.</p>;
    const health = healthFor(env.id);
    return (
      <Card key={env.id} className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <Database className="h-4 w-4" /> {env.environment_name}
            <Badge variant="outline" className="text-[10px] uppercase">{env.environment_type}</Badge>
            <ResultBadge result={env.verification_status} />
            <Badge variant="outline" className="text-[10px]">{env.di00_state.replace(/_/g, " ").toLowerCase()}</Badge>
            {env.production_flag && (
              <Badge variant="outline" className={cn("text-[10px]", toneClass("danger"))}>production signal</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Provider</dt><dd>{env.provider ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Region</dt><dd>{env.region ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Database reference</dt><dd className="font-mono">{env.database_reference ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Credential secret</dt><dd className="font-mono">{env.credential_secret_name ?? "not configured"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Engine version</dt><dd>{env.database_version ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Schema version</dt><dd className="font-mono">{env.schema_version ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Migration</dt><dd className="font-mono">{env.migration_version ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Identity fingerprint</dt><dd className="font-mono">{env.environment_fingerprint ? `${env.environment_fingerprint.slice(0, 16)}…` : "unverified"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Synthetic data</dt><dd>{env.synthetic_data_flag ? "confirmed synthetic" : "not confirmed"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Last verified</dt><dd>{env.last_verified_at ? new Date(env.last_verified_at).toLocaleString("en-KE") : "never"}</dd></div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy !== null}
              onClick={() => run(`health:${env.environment_key}`, () => di00.runHealth(env.environment_key), "Health and identity verification")}>
              {busy === `health:${env.environment_key}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Activity className="mr-1 h-3 w-3" />}
              Verify connection & identity
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null || !data?.can_provision}
              onClick={() => run(`schema:${env.environment_key}`, () => di00.deploySchema(env.environment_key), "Schema deployment")}>
              {busy === `schema:${env.environment_key}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <DatabaseZap className="mr-1 h-3 w-3" />}
              Deploy certification schema
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null || !data?.can_provision}
              onClick={() => run(`fixtures:${env.environment_key}`, () => di00.loadFixtures(env.environment_key), "Synthetic fixture load")}>
              {busy === `fixtures:${env.environment_key}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sliders className="mr-1 h-3 w-3" />}
              Load synthetic fixtures
            </Button>
          </div>

          {health ? (
            <div className="rounded-md border border-border/60">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
                <span className="font-medium">Latest health run</span>
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <ResultBadge result={health.overall_result} />
                  corr {health.correlation_id.slice(0, 8)} · req {health.request_id.slice(0, 8)} ·
                  {health.duration_ms ?? 0} ms · {new Date(health.started_at).toLocaleString("en-KE")}
                </span>
              </div>
              <div className="divide-y divide-border/40">
                {health.checks.map((c) => (
                  <div key={c.check_key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                    <span>{di00.CHECK_LABEL[c.check_key] ?? c.check_key}</span>
                    <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {c.observed ?? "—"}{c.expected ? ` (expected ${c.expected})` : ""}
                      <ResultBadge result={c.result} />
                    </span>
                  </div>
                ))}
              </div>
              {health.error_message && (
                <p className="border-t border-border/50 px-3 py-2 text-[11px] text-destructive">
                  {health.error_code}: {health.error_message}
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-[11px]">
              No health run recorded yet — state is UNKNOWN, never assumed to pass.
            </p>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderConfigForm = (env: di00.InfraEnvironment | undefined, role: "STAGING" | "RESTORE", secret: string) => {
    if (!env) return null;
    const f = forms[env.environment_key] ?? emptyForm;
    const set = (patch: Partial<ConfigForm>) =>
      setForms((prev) => ({ ...prev, [env.environment_key]: { ...(prev[env.environment_key] ?? emptyForm), ...patch } }));
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRound className="h-4 w-4" /> {role === "STAGING" ? "Staging" : "Restore"} configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-md border border-info/40 bg-info/5 p-3 text-[11px]">
            Store the connection string as the backend secret <span className="font-mono">{secret}</span> and enter only the
            secret <em>name</em> here. Connection strings and passwords are never accepted, stored or displayed by this surface.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label className="text-xs">Environment name</Label>
              <Input value={f.environmentName} onChange={(e) => set({ environmentName: e.target.value })} /></div>
            <div><Label className="text-xs">Provider</Label>
              <Input value={f.provider} placeholder="e.g. Supabase, AWS RDS, Neon" onChange={(e) => set({ provider: e.target.value })} /></div>
            <div><Label className="text-xs">Provider project reference</Label>
              <Input value={f.providerProjectRef} onChange={(e) => set({ providerProjectRef: e.target.value })} /></div>
            <div><Label className="text-xs">Region</Label>
              <Input value={f.region} onChange={(e) => set({ region: e.target.value })} /></div>
            <div><Label className="text-xs">Host reference</Label>
              <Input value={f.hostRef} onChange={(e) => set({ hostRef: e.target.value })} /></div>
            <div><Label className="text-xs">Database reference</Label>
              <Input value={f.databaseReference} onChange={(e) => set({ databaseReference: e.target.value })} /></div>
            <div><Label className="text-xs">Deployment reference</Label>
              <Input value={f.deploymentReference} onChange={(e) => set({ deploymentReference: e.target.value })} /></div>
            <div><Label className="text-xs">Credential secret name</Label>
              <Input value={f.credentialSecretName} placeholder={secret} onChange={(e) => set({ credentialSecretName: e.target.value })} /></div>
          </div>
          <div><Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
          <Button size="sm" disabled={busy !== null || !data?.can_configure}
            onClick={async () => {
              const res = await run(`config:${env.environment_key}`, () => di00.configureEnvironment({
                environmentKey: env.environment_key,
                environmentName: f.environmentName || env.environment_name,
                environmentType: role,
                provider: f.provider || null,
                providerProjectRef: f.providerProjectRef || null,
                hostRef: f.hostRef || null,
                region: f.region || null,
                deploymentReference: f.deploymentReference || null,
                databaseReference: f.databaseReference || null,
                credentialSecretName: f.credentialSecretName || null,
                notes: f.notes || null,
              }), "Configuration saved");
              if (res.ok) await di00.runHealth(env.environment_key).then(() => load());
            }}>
            {busy === `config:${env.environment_key}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Save and verify
          </Button>
          {!data?.can_configure && (
            <p className="text-[11px] text-muted-foreground">
              You do not hold staff.infrastructure.configure — configuration is read-only for you.
            </p>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <Helmet>
        <title>DI-00 Infrastructure Control Plane | TaxiD</title>
        <meta name="description" content="Register, verify, back up, restore and certify the isolated logistics staging and restore databases behind control DI-00." />
      </Helmet>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/dashboard/admin/production-command-center" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Production Command Center
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <DatabaseZap className="h-6 w-6 text-primary" /> DI-00 · Infrastructure control plane
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Two independently identifiable non-production PostgreSQL environments — logistics staging and the restore
            target — with connection health, identity verification, schema deployment, synthetic isolation, backup,
            restore and certification. Production is refused at every step.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("text-[11px]", state === "CLEARED" ? toneClass("ok") : state.endsWith("_FAILED") ? toneClass("danger") : toneClass("warn"))}>
            DI-00 · {state.replace(/_/g, " ").toLowerCase()}
          </Badge>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            <RefreshCw className={cn("mr-1 h-3 w-3", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-4 text-sm">
          <span className="font-mono text-xs text-warning">DATA_NOT_AVAILABLE</span>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </div>
      )}

      {loading && !data ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : !data ? null : (
        <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-4">
          <TabsList className="grid h-auto grid-cols-3 lg:grid-cols-7">
            <TabsTrigger value="overview" className="text-[11px]">Overview</TabsTrigger>
            <TabsTrigger value="environments" className="text-[11px]">Environments</TabsTrigger>
            <TabsTrigger value="configuration" className="text-[11px]">Configuration</TabsTrigger>
            <TabsTrigger value="backup" className="text-[11px]">Backup &amp; restore</TabsTrigger>
            <TabsTrigger value="actions" className="text-[11px]">Infrastructure actions</TabsTrigger>
            <TabsTrigger value="evidence" className="text-[11px]">Certification</TabsTrigger>
            <TabsTrigger value="diagnostics" className="text-[11px]">Diagnostics</TabsTrigger>
          </TabsList>

          {/* ------------------------------------------------ OVERVIEW */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {renderEnvironment(staging, "STAGING")}
              {renderEnvironment(restore, "RESTORE")}
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4" /> Actionable blockers ({blockers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {blockers.length === 0 && (
                  <p className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="h-4 w-4" /> No blockers outstanding — run certification to record the verdict.
                  </p>
                )}
                {blockers.map((b) => (
                  <div key={b.blocker_id} className="rounded-md border border-border/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px]">{b.blocker_id}</span>
                      <Badge variant="outline" className="text-[10px] uppercase">{b.category}</Badge>
                      <span className="text-[11px] text-muted-foreground">owner: {b.owner}</span>
                    </div>
                    <p className="mt-1">{b.why}</p>
                    <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                      <div><dt className="text-muted-foreground">Missing</dt><dd>{b.missing_item}</dd></div>
                      <div><dt className="text-muted-foreground">Required input</dt><dd>{b.required_input}</dd></div>
                      <div><dt className="text-muted-foreground">Action</dt><dd>{b.action}</dd></div>
                      <div><dt className="text-muted-foreground">Where</dt><dd>{b.where_to_enter}</dd></div>
                      <div><dt className="text-muted-foreground">Then the system will</dt><dd>{b.after_input}</dd></div>
                      <div><dt className="text-muted-foreground">Clearing evidence</dt><dd>{b.expected_evidence}</dd></div>
                    </dl>
                    <p className="mt-1 text-[11px] text-muted-foreground">Dependent controls: {b.dependent_controls.join(", ")}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* -------------------------------------------- ENVIRONMENTS */}
          <TabsContent value="environments" className="space-y-3">
            {renderEnvironment(staging, "STAGING")}
            {renderEnvironment(restore, "RESTORE")}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Synthetic fixture sets</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-xs">
                {data.fixtures.length === 0 && <p className="text-muted-foreground">No fixture set loaded.</p>}
                {data.fixtures.map((f) => (
                  <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1.5 last:border-0">
                    <span className="font-mono">{f.fixture_set_key}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {Object.entries(f.entity_counts).map(([k, v]) => `${k}:${v}`).join(" · ") || "no counts"}
                      <ResultBadge result={f.production_identifier_scan} />
                      <Badge variant="outline" className="text-[10px]">{f.state.toLowerCase()}</Badge>
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------------------- CONFIGURATION */}
          <TabsContent value="configuration" className="space-y-3">
            <Di00CredentialPanel onCompleted={() => void load()} />
            <div className="grid gap-3 lg:grid-cols-2">
              {renderConfigForm(staging, "STAGING", "LOGISTICS_STAGING_DATABASE_URL")}
              {renderConfigForm(restore, "RESTORE", "LOGISTICS_RESTORE_DATABASE_URL")}
            </div>
          </TabsContent>

          {/* ---------------------------------------- BACKUP & RESTORE */}
          <TabsContent value="backup" className="space-y-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><HardDriveDownload className="h-4 w-4" /> Backup — staging only</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p className="text-muted-foreground">
                  The backup is a logical export of the certification schema, written to private storage, read back and
                  re-hashed. Repeating a request with the same key never creates a second backup.
                </p>
                <Button size="sm" disabled={busy !== null || !data.can_backup}
                  onClick={() => run("backup", () => di00.runBackup(`di00-${new Date().toISOString().slice(0, 13)}`), "Backup executed")}>
                  {busy === "backup" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <HardDriveDownload className="mr-1 h-3 w-3" />}
                  Execute staging backup
                </Button>
                <div className="divide-y divide-border/40">
                  {data.backups.length === 0 && <p className="pt-2 text-muted-foreground">No backup recorded.</p>}
                  {data.backups.map((b) => (
                    <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span className="font-mono">{b.backup_reference}</span>
                      <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {b.row_count ?? "—"} rows · {di00.formatBytes(b.size_bytes)} ·
                        {b.checksum_sha256 ? ` sha256 ${b.checksum_sha256.slice(0, 12)}…` : " no checksum"}
                        <ResultBadge result={b.integrity_result} />
                        <Badge variant="outline" className="text-[10px]">{b.state.toLowerCase()}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Undo2 className="h-4 w-4" /> Restore — isolated restore target only</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p className="text-muted-foreground">
                  Only staging → restore is permitted. A production source or target, a target that shares staging's
                  database identity, and an artefact whose checksum does not match are all refused.
                </p>
                <Button size="sm" disabled={busy !== null || !data.can_restore || !verifiedBackup}
                  onClick={() => verifiedBackup && run("restore",
                    () => di00.runRestore(verifiedBackup.backup_reference, `di00-restore-${verifiedBackup.backup_reference}`),
                    "Restore executed")}>
                  {busy === "restore" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Undo2 className="mr-1 h-3 w-3" />}
                  Restore latest verified backup
                </Button>
                {!verifiedBackup && <p className="text-muted-foreground">No integrity-verified backup available to restore.</p>}
                <div className="divide-y divide-border/40">
                  {data.restores.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span className="font-mono">{r.restore_reference}</span>
                      <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {r.restored_row_count ?? "—"} rows · {r.duration_ms ?? "—"} ms
                        <ResultBadge result={r.verification_result} />
                        <Badge variant="outline" className="text-[10px]">{r.state.toLowerCase()}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ------------------------------- INFRASTRUCTURE ACTIONS */}
          <TabsContent value="actions" className="space-y-3">
            {data.actions.map((a) => (
              <Card key={a.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                    <ShieldAlert className="h-4 w-4" /> {a.action_key}
                    <Badge variant="outline" className="text-[10px] uppercase">{a.category}</Badge>
                    <ResultBadge result={a.validation_result} />
                    <Badge variant="outline" className="text-[10px]">{a.state.toLowerCase()}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <dl className="grid gap-1 sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">Resource</dt><dd>{a.resource}</dd></div>
                    <div><dt className="text-muted-foreground">Required permission</dt><dd>{a.required_permission ?? "—"}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-muted-foreground">Required action</dt><dd>{a.required_action}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-muted-foreground">Configuration</dt><dd className="font-mono text-[11px]">{JSON.stringify(a.configuration)}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-muted-foreground">Required output</dt><dd>{a.required_output}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-muted-foreground">Register at</dt><dd>{a.register_where}</dd></div>
                    <div className="sm:col-span-2"><dt className="text-muted-foreground">Clearing evidence</dt><dd>{a.expected_evidence}</dd></div>
                  </dl>
                  <div className="space-y-2">
                    <Label className="text-xs">Resource reference produced by the provider (JSON)</Label>
                    <Textarea rows={2} className="font-mono text-[11px]"
                      placeholder='{"provider":"neon","project":"…","database":"…","secret_name":"LOGISTICS_STAGING_DATABASE_URL"}'
                      value={actionResult[a.action_key] ?? ""}
                      onChange={(e) => setActionResult((p) => ({ ...p, [a.action_key]: e.target.value }))} />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={busy !== null || !data.can_configure}
                        onClick={async () => {
                          let parsed: Record<string, unknown>;
                          try { parsed = JSON.parse(actionResult[a.action_key] ?? "{}"); }
                          catch { toast({ title: "Invalid JSON", description: "Supply the provider's resource reference as JSON.", variant: "destructive" }); return; }
                          await run(`action:${a.action_key}`, () => di00.resolveExternalAction(a.action_key, parsed), "Result submitted");
                        }}>
                        Submit provider result
                      </Button>
                      <Button size="sm" disabled={busy !== null}
                        onClick={() => run(`validate:${a.action_key}`, () => di00.validateExternalAction(a.action_key), "Validation executed")}>
                        {busy === `validate:${a.action_key}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
                        Validate against the live database
                      </Button>
                    </div>
                    {a.validation_detail && <p className="text-[11px] text-muted-foreground">{a.validation_detail}</p>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* ------------------------------------------- CERTIFICATION */}
          <TabsContent value="evidence" className="space-y-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4" /> DI-00 certification runner</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p className="text-muted-foreground">
                  Certification reads only recorded evidence. A criterion that is UNKNOWN or NOT_CONFIGURED can never
                  become a pass, and only a genuine pass propagates into the readiness register.
                </p>
                <Button size="sm" disabled={busy !== null || !data.can_certify}
                  onClick={() => run("certify", () => di00.certify(), "Certification executed")}>
                  {busy === "certify" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
                  Execute DI-00 certification
                </Button>
              </CardContent>
            </Card>

            {data.certifications.map((c) => (
              <Card key={c.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                    {c.certification_reference} <ResultBadge result={c.outcome} />
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(c.executed_at).toLocaleString("en-KE")} · corr {c.correlation_id.slice(0, 8)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs">
                  {c.criteria.map((cr) => (
                    <div key={cr.criterion} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1 last:border-0">
                      <span className="font-mono text-[11px]">{cr.criterion}</span>
                      <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {cr.detail} <ResultBadge result={cr.result} />
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* --------------------------------------------- DIAGNOSTICS */}
          <TabsContent value="diagnostics" className="space-y-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Infrastructure operations — correlation trail</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">When</th><th className="px-3 py-2">Operation</th>
                      <th className="px-3 py-2">Environment</th><th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Correlation</th><th className="px-3 py-2">Request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.operations.map((o) => (
                      <tr key={o.id} className="border-t border-border/50">
                        <td className="px-3 py-1.5">{new Date(o.created_at).toLocaleString("en-KE")}</td>
                        <td className="px-3 py-1.5">{o.operation}</td>
                        <td className="px-3 py-1.5">{o.environment_key ?? "—"}</td>
                        <td className={cn("px-3 py-1.5", o.error_code && "text-destructive")}>{o.error_code ?? o.status}</td>
                        <td className="px-3 py-1.5 font-mono">{o.correlation_id.slice(0, 8)}</td>
                        <td className="px-3 py-1.5 font-mono">{o.request_id.slice(0, 8)}</td>
                      </tr>
                    ))}
                    {data.operations.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-4 text-muted-foreground">No infrastructure operations recorded yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
