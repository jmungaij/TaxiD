/**
 * DI-00 INFRASTRUCTURE CONTROL PLANE — client contract.
 *
 * Every state shown in the UI is a server verdict: environments, health checks,
 * backups, restores, fixtures, external actions and certifications all come
 * from `di00_overview`, and every operation terminates in a guarded RPC or in
 * the `di00-orchestrator` edge function (the only component that connects to
 * the isolated databases).
 *
 * Laws honoured here:
 *   - UNKNOWN / NOT_CONFIGURED are never rendered as PASS.
 *   - No credential ever reaches this module; only the NAME of a server secret.
 *   - Nothing in the client can set a control to PASS.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import type { CredentialStatusRow, IndependenceAssertion, Invariant } from "@/lib/infrastructure/independence";

const db = untypedDb;

export type CheckResult = "PASS" | "FAIL" | "BLOCKED" | "UNKNOWN" | "NOT_CONFIGURED";
export type JobState = "REQUESTED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "CANCELLED";

export type Di00State =
  | "DESIGN" | "CONFIGURATION_REQUIRED" | "CONFIGURED" | "PROVISIONING" | "PROVISIONED" | "CONNECTED"
  | "IDENTITY_VERIFIED" | "SCHEMA_READY" | "SECURITY_READY" | "BACKUP_READY" | "RESTORE_READY"
  | "CERTIFICATION_READY" | "CERTIFICATION_IN_PROGRESS" | "CERTIFIED" | "CLEARED"
  | "CONFIGURATION_FAILED" | "PROVISIONING_FAILED" | "CONNECTION_FAILED" | "IDENTITY_FAILED"
  | "SCHEMA_FAILED" | "SECURITY_FAILED" | "BACKUP_FAILED" | "RESTORE_FAILED" | "CERTIFICATION_FAILED";

/** The lifecycle in order — used to render progress without inventing state. */
export const DI00_LIFECYCLE: Di00State[] = [
  "DESIGN", "CONFIGURATION_REQUIRED", "CONFIGURED", "PROVISIONING", "PROVISIONED", "CONNECTED",
  "IDENTITY_VERIFIED", "SCHEMA_READY", "SECURITY_READY", "BACKUP_READY", "RESTORE_READY",
  "CERTIFICATION_READY", "CERTIFICATION_IN_PROGRESS", "CERTIFIED", "CLEARED",
];

export const CHECK_TONE: Record<CheckResult, "ok" | "warn" | "danger" | "info"> = {
  PASS: "ok",
  FAIL: "danger",
  BLOCKED: "warn",
  UNKNOWN: "info",
  NOT_CONFIGURED: "warn",
};

export const CHECK_LABEL: Record<string, string> = {
  DATABASE_REACHABLE: "Database reachable",
  AUTHENTICATION_VALID: "Authentication valid",
  SSL_VALID: "TLS valid",
  DATABASE_VERSION: "Database version",
  SCHEMA_VERSION: "Schema version",
  MIGRATION_VERSION: "Migration version",
  REQUIRED_EXTENSIONS: "Required extensions",
  REQUIRED_FUNCTIONS: "Required functions",
  REQUIRED_TRIGGERS: "Required triggers",
  REQUIRED_INDEXES: "Required indexes",
  RLS_STATUS: "Row level security",
  SECURITY_DEFINER_STATUS: "SECURITY DEFINER controls",
  AUDIT_STATUS: "Audit trail",
  EVENT_STATUS: "Canonical event stream",
  BACKUP_STATUS: "Backup readiness",
  RESTORE_CAPABILITY: "Restore capability",
  ENVIRONMENT_IDENTITY: "Environment identity",
  PRODUCTION_ISOLATION: "Production isolation",
  SYNTHETIC_DATA_STATUS: "Synthetic data isolation",
  SCHEMA_OBJECTS: "Schema objects",
};

export interface InfraEnvironment {
  id: string;
  environment_key: string;
  environment_name: string;
  environment_type: "DEVELOPMENT" | "TEST" | "STAGING" | "RESTORE" | "PRODUCTION";
  database_engine: string;
  database_version: string | null;
  provider: string | null;
  provider_project_ref: string | null;
  host_ref: string | null;
  region: string | null;
  deployment_reference: string | null;
  database_reference: string | null;
  credential_secret_name: string | null;
  schema_version: string | null;
  migration_version: string | null;
  environment_fingerprint: string | null;
  production_flag: boolean;
  synthetic_data_flag: boolean;
  status: string;
  di00_state: Di00State;
  di00_state_reason: string | null;
  verification_status: CheckResult;
  last_verified_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface HealthCheck {
  check_key: string;
  result: CheckResult;
  observed: string | null;
  expected: string | null;
  detail: Record<string, unknown>;
}

export interface HealthRun {
  id: string;
  environment_id: string;
  state: JobState;
  overall_result: CheckResult;
  correlation_id: string;
  request_id: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  checks: HealthCheck[];
}

export interface BackupRow {
  id: string;
  backup_reference: string;
  source_environment_id: string;
  state: JobState;
  backup_type: string;
  schema_version: string | null;
  object_count: number | null;
  row_count: number | null;
  size_bytes: number | null;
  checksum_sha256: string | null;
  storage_path: string | null;
  integrity_result: CheckResult;
  correlation_id: string;
  request_id: string;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface RestoreRow {
  id: string;
  restore_reference: string;
  backup_id: string;
  target_environment_id: string;
  state: JobState;
  restored_object_count: number | null;
  restored_row_count: number | null;
  verification_result: CheckResult;
  verification_detail: Record<string, unknown>;
  correlation_id: string;
  request_id: string;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface FixtureSet {
  id: string;
  environment_id: string;
  fixture_set_key: string;
  scenario: string;
  synthetic: boolean;
  deterministic_seed: string;
  entity_counts: Record<string, number>;
  production_identifier_scan: CheckResult;
  loaded_at: string | null;
  state: JobState;
  error_message: string | null;
}

export interface ProviderAction {
  id: string;
  action_key: string;
  environment_key: string | null;
  category: string;
  provider: string | null;
  resource: string;
  required_action: string;
  required_permission: string | null;
  configuration: Record<string, unknown>;
  required_output: string;
  register_where: string;
  owner_role: string;
  expected_evidence: string;
  dependent_controls: string[];
  state: JobState;
  submitted_result: Record<string, unknown> | null;
  validation_result: CheckResult;
  validation_detail: string | null;
  resolved_at: string | null;
}

export interface Certification {
  id: string;
  certification_reference: string;
  control_id: string;
  outcome: CheckResult;
  di00_state: Di00State;
  criteria: { criterion: string; result: CheckResult; detail: string }[];
  blockers: { blocker_id: string; category: string; why: string; result: CheckResult }[];
  correlation_id: string;
  request_id: string;
  executed_at: string;
}

export interface OperationLog {
  id: string;
  operation: string;
  environment_key: string | null;
  correlation_id: string;
  request_id: string;
  status: string;
  error_code: string | null;
  duration_ms: number | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface Di00Overview {
  ok: true;
  measured_at: string;
  can_configure: boolean;
  can_provision: boolean;
  can_backup: boolean;
  can_restore: boolean;
  can_certify: boolean;
  environments: InfraEnvironment[];
  health: HealthRun[];
  backups: BackupRow[];
  restores: RestoreRow[];
  fixtures: FixtureSet[];
  actions: ProviderAction[];
  certifications: Certification[];
  operations: OperationLog[];
  readiness_targets: { target_role: string; isolation_verified: boolean; synthetic_fixtures_loaded: boolean }[];
}

export type Result<T> =
  | { ok: true; data: T; denied?: false; code?: string; message?: string; detail?: unknown }
  | { ok: false; data?: undefined; denied: boolean; code: string; message: string; detail?: unknown };

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await db.rpc(fn, args);
  if (error) return { ok: false, denied: false, code: "TRANSPORT_ERROR", message: error.message };
  const env = (data ?? {}) as { ok?: boolean; code?: string; message?: string };
  if (env.ok === false) {
    return {
      ok: false,
      denied: env.code === "AUTHORIZATION_DENIED",
      code: env.code ?? "UNKNOWN",
      message: env.message ?? "This operation could not be completed.",
      detail: data,
    };
  }
  return { ok: true, data: data as T };
}

async function orchestrate<T>(body: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await supabase.functions.invoke("di00-orchestrator", { body });
  if (error) return { ok: false, denied: false, code: "ORCHESTRATOR_UNREACHABLE", message: error.message };
  const env = (data ?? {}) as { ok?: boolean; code?: string; message?: string };
  if (env.ok === false) {
    return {
      ok: false,
      denied: env.code === "AUTHORIZATION_DENIED",
      code: env.code ?? "ORCHESTRATOR_FAILED",
      message: env.message ?? "The infrastructure operation did not complete.",
      detail: data,
    };
  }
  return { ok: true, data: data as T };
}

/* ------------------------------- reads ---------------------------- */
export const overview = () => call<Di00Overview>("di00_overview");

/* --------------------------- configuration ------------------------ */
export interface EnvironmentConfigInput {
  environmentKey: string;
  environmentName: string;
  environmentType: "STAGING" | "RESTORE";
  provider?: string | null;
  providerProjectRef?: string | null;
  hostRef?: string | null;
  region?: string | null;
  deploymentReference?: string | null;
  databaseReference?: string | null;
  credentialSecretName?: string | null;
  notes?: string | null;
}

export const configureEnvironment = (i: EnvironmentConfigInput) =>
  call<{ ok: true; environment_id: string; di00_state: Di00State }>("di00_environment_upsert", {
    _environment_key: i.environmentKey,
    _environment_name: i.environmentName,
    _environment_type: i.environmentType,
    _provider: i.provider ?? null,
    _provider_project_ref: i.providerProjectRef ?? null,
    _host_ref: i.hostRef ?? null,
    _region: i.region ?? null,
    _deployment_reference: i.deploymentReference ?? null,
    _database_reference: i.databaseReference ?? null,
    _credential_secret_name: i.credentialSecretName ?? null,
    _notes: i.notes ?? null,
  });

export const resolveExternalAction = (actionKey: string, result: Record<string, unknown>) =>
  call<{ ok: true; action: ProviderAction }>("di00_action_resolve", { _action_key: actionKey, _result: result });

/* ---------------------------- operations -------------------------- */
export const runHealth = (environmentKey: string) =>
  orchestrate<{ ok: true; checks: HealthCheck[] }>({ action: "health", environment_key: environmentKey });

export const deploySchema = (environmentKey: string) =>
  orchestrate<{ ok: true; schema_version: string }>({ action: "deploy_schema", environment_key: environmentKey });

export const loadFixtures = (environmentKey: string, scenario = "di00-baseline", seed = "di00seed1") =>
  orchestrate<{ ok: true; counts: Record<string, number>; production_identifier_offenders: number }>({
    action: "load_fixtures", environment_key: environmentKey, scenario, seed,
  });

export const runBackup = (idempotencyKey: string) =>
  orchestrate<{ ok: boolean; integrity: CheckResult; rows: number; checksum: string }>({
    action: "backup", idempotency_key: idempotencyKey,
  });

export const runRestore = (backupReference: string, idempotencyKey: string) =>
  orchestrate<{ ok: boolean; restored_rows: number; verification: Record<string, unknown> }>({
    action: "restore", backup_reference: backupReference, idempotency_key: idempotencyKey,
  });

export const validateExternalAction = (actionKey: string) =>
  orchestrate<{ ok: boolean; verdict: CheckResult; detail: string }>({
    action: "validate_action", action_key: actionKey,
  });

/* ------------------- independence invariants + credentials ------------------ */
export const checkIndependence = () =>
  orchestrate<{ ok: boolean; result: string; invariants: Invariant[]; failed_invariants: string[] }>({
    action: "independence",
  });

/**
 * Owner-only. Validates each supplied connection string against the live
 * endpoint, seals it, then resumes the DI-00 chain from the blocked step.
 * Either value may be omitted — the other is saved on its own.
 */
export const configureCredentials = (stagingUrl: string, restoreUrl: string) =>
  orchestrate<OrchestrationResponse>({
    action: "configure_credentials",
    staging_url: stagingUrl || undefined,
    restore_url: restoreUrl || undefined,
  });

/** Owner-only preflight: authenticates a candidate DSN and reports the reason. */
export const validateDsn = (environmentKey: string, dsn?: string) =>
  orchestrate<DsnValidationResponse>({ action: "validate_dsn", environment_key: environmentKey, dsn });

/** Owner-only. Runs or resumes the whole chain idempotently. */
export const runOrchestration = (opts: { trigger?: "MANUAL" | "RESUME" | "AUTO_RETRY"; force?: boolean; idempotencyKey?: string } = {}) =>
  orchestrate<OrchestrationResponse>({
    action: "orchestrate",
    trigger: opts.trigger ?? "MANUAL",
    force: opts.force === true,
    idempotency_key: opts.idempotencyKey,
  });

export interface OrchestrationStepSummary {
  step: string;
  ok: boolean;
  state?: string;
  code?: string | null;
  attempt?: number;
  reused_evidence?: boolean;
  rollback_result?: string | null;
}

export interface OrchestrationResponse {
  ok: boolean;
  run_id: string | null;
  run_reference: string | null;
  state: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "BLOCKED" | "CANCELLED" | null;
  blocked_step: string | null;
  blocked_reason: string | null;
  steps: OrchestrationStepSummary[];
  idempotent_replay?: boolean;
}

export interface DsnValidationResponse {
  ok: boolean;
  stage: "STRUCTURE" | "CONNECT" | "AUTHENTICATE" | "ISOLATION" | "COMPLETE";
  code: string;
  message: string;
  detail: Record<string, unknown>;
}

/* ------------------- orchestration audit log + alerts ------------------ */
export interface OrchestrationStepRow {
  id: string;
  step_key: string;
  environment_key: string | null;
  sequence_no: number;
  attempt: number;
  state: "STARTED" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "ROLLED_BACK" | "BLOCKED" | "RETRYING";
  reused_evidence: boolean;
  error_code: string | null;
  error_message: string | null;
  rollback_action: string | null;
  rollback_result: string | null;
  duration_ms: number | null;
  recorded_at: string;
}

export interface OrchestrationRunRow {
  id: string;
  run_reference: string;
  trigger_source: string;
  environment_scope: string[];
  state: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "BLOCKED" | "CANCELLED";
  blocked_step: string | null;
  blocked_reason: string | null;
  summary: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  steps: OrchestrationStepRow[];
}

export interface OrchestrationAlertRow {
  id: string;
  run_id: string | null;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  environment_key: string | null;
  step_key: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

export const orchestrationLog = (limit = 10) =>
  call<{ ok: true; runs: OrchestrationRunRow[]; notifications: OrchestrationAlertRow[] }>(
    "di00_orchestration_log", { _limit: limit },
  );

export const acknowledgeAlert = (notificationId: string) =>
  call<{ ok: true }>("di00_orchestration_ack", { _notification_id: notificationId });

export const credentialStatus = () =>
  call<{ ok: true; credentials: CredentialStatusRow[]; independence: IndependenceAssertion | null }>(
    "di00_credential_status",
  );


export const certify = () => call<{ ok: true; certification: Certification }>("di00_certify");

/* ------------------------------ blockers -------------------------- */
export interface Blocker {
  blocker_id: string;
  category: string;
  why: string;
  missing_item: string;
  owner: string;
  required_input: string;
  action: string;
  where_to_enter: string;
  after_input: string;
  expected_evidence: string;
  dependent_controls: string[];
}

/**
 * Derives the actionable blocker set from authoritative state. Every blocker
 * names the exact missing item, who must act and what evidence clears it —
 * there is no bare "BLOCKED".
 */
export function deriveBlockers(o: Di00Overview): Blocker[] {
  const out: Blocker[] = [];
  const staging = o.environments.find((e) => e.environment_type === "STAGING");
  const restore = o.environments.find((e) => e.environment_type === "RESTORE");

  const forEnv = (env: InfraEnvironment | undefined, role: "STAGING" | "RESTORE", secret: string) => {
    if (!env) {
      out.push({
        blocker_id: role === "STAGING" ? "DATABASE_NOT_CONFIGURED" : "RESTORE_DATABASE_NOT_CONFIGURED",
        category: "CONFIGURATION",
        why: `No ${role.toLowerCase()} environment is registered.`,
        missing_item: `${role} environment registration`,
        owner: "platform_owner",
        required_input: "Provider, project, region, database reference and credential secret name",
        action: "Register the environment in the configuration panel.",
        where_to_enter: "Infrastructure → DI-00 → Configuration",
        after_input: "The orchestrator connects, fingerprints and verifies the environment.",
        expected_evidence: "A health run recording database version, fingerprint and non-production identity.",
        dependent_controls: ["DI-00"],
      });
      return;
    }
    if (!env.credential_secret_name) {
      out.push({
        blocker_id: "PROVIDER_CREDENTIAL_REQUIRED",
        category: "EXTERNAL_INFRASTRUCTURE_REQUIRED",
        why: `${env.environment_name} has no server-side credential secret registered.`,
        missing_item: `Secret ${secret}`,
        owner: "platform_owner",
        required_input: `The PostgreSQL connection string stored as the backend secret ${secret}`,
        action: `Create the database with your infrastructure provider and store its connection string as ${secret}.`,
        where_to_enter: "Backend secrets, then reference the secret name in DI-00 → Configuration",
        after_input: "The orchestrator connects over TLS, fingerprints the database and records a health run.",
        expected_evidence: "DATABASE_REACHABLE, SSL_VALID and PRODUCTION_ISOLATION all PASS.",
        dependent_controls: ["DI-00"],
      });
      return;
    }
    if (env.verification_status !== "PASS") {
      out.push({
        blocker_id: env.production_flag ? "PRODUCTION_TARGET_REFUSED" : "ENVIRONMENT_IDENTITY_UNVERIFIED",
        category: env.production_flag ? "GENUINE_FAILURE" : "VERIFICATION",
        why: env.di00_state_reason ?? "No successful health and identity verification recorded.",
        missing_item: "Successful health run",
        owner: "operations_admin",
        required_input: "None — the system executes this.",
        action: "Run the health and identity verification for this environment.",
        where_to_enter: "Infrastructure → DI-00 → Environments → Verify",
        after_input: "Health checks are recorded and the environment state advances.",
        expected_evidence: "A health run whose overall result is PASS.",
        dependent_controls: ["DI-00"],
      });
      return;
    }
    if (env.schema_version === null) {
      out.push({
        blocker_id: "SCHEMA_OUTDATED",
        category: "BUILDABLE",
        why: "The certification schema is not deployed in this environment.",
        missing_item: "Certification schema",
        owner: "operations_admin",
        required_input: "None — the system executes this.",
        action: "Run schema deployment.",
        where_to_enter: "Infrastructure → DI-00 → Environments → Deploy schema",
        after_input: "Tables, indexes, RLS, SECURITY DEFINER functions, audit and events are created and verified.",
        expected_evidence: "SCHEMA_VERSION and MIGRATION_VERSION PASS.",
        dependent_controls: ["DI-00"],
      });
    }
  };

  forEnv(staging, "STAGING", "LOGISTICS_STAGING_DATABASE_URL");
  forEnv(restore, "RESTORE", "LOGISTICS_RESTORE_DATABASE_URL");

  if (staging && restore && staging.environment_fingerprint && restore.environment_fingerprint
      && staging.environment_fingerprint === restore.environment_fingerprint) {
    out.push({
      blocker_id: "RESTORE_TARGET_NOT_INDEPENDENT",
      category: "GENUINE_FAILURE",
      why: "Staging and restore resolve to the same database identity.",
      missing_item: "An independent restore database",
      owner: "platform_owner",
      required_input: "A connection string for a second, separate database",
      action: "Provision a distinct database and update LOGISTICS_RESTORE_DATABASE_URL.",
      where_to_enter: "Backend secrets, then DI-00 → Configuration",
      after_input: "Identity verification re-runs and the fingerprints are compared again.",
      expected_evidence: "Two distinct environment fingerprints.",
      dependent_controls: ["DI-00"],
    });
  }

  const stagingFixtures = o.fixtures.some(
    (f) => f.environment_id === staging?.id && f.state === "SUCCEEDED" && f.production_identifier_scan === "PASS",
  );
  if (staging?.verification_status === "PASS" && !stagingFixtures) {
    out.push({
      blocker_id: "SYNTHETIC_DATA_REQUIRED",
      category: "BUILDABLE",
      why: "No synthetic fixture set has been loaded and scanned in staging.",
      missing_item: "Synthetic fixture set",
      owner: "operations_admin",
      required_input: "None — the system executes this.",
      action: "Load the deterministic synthetic fixture set.",
      where_to_enter: "Infrastructure → DI-00 → Environments → Load fixtures",
      after_input: "Fixtures are inserted and scanned for production identifiers.",
      expected_evidence: "SYNTHETIC_DATA_STATUS PASS with zero non-synthetic identifiers.",
      dependent_controls: ["DI-00"],
    });
  }

  const verifiedBackup = o.backups.find((b) => b.state === "SUCCEEDED" && b.integrity_result === "PASS");
  if (stagingFixtures && !verifiedBackup) {
    out.push({
      blocker_id: "BACKUP_REQUIRED",
      category: "BUILDABLE",
      why: "No integrity-verified backup of the staging certification schema exists.",
      missing_item: "Verified backup artefact",
      owner: "operations_admin",
      required_input: "None — the system executes this.",
      action: "Execute a staging backup.",
      where_to_enter: "Infrastructure → DI-00 → Backup & restore",
      after_input: "The artefact is written, read back and re-hashed to prove integrity.",
      expected_evidence: "A backup record with a matching SHA-256 checksum.",
      dependent_controls: ["DI-00"],
    });
  }
  if (verifiedBackup && !o.restores.some((r) => r.state === "SUCCEEDED" && r.verification_result === "PASS")) {
    out.push({
      blocker_id: "RESTORE_REQUIRED",
      category: "BUILDABLE",
      why: "No verified restore into the independent restore target exists.",
      missing_item: "Verified restore execution",
      owner: "operations_admin",
      required_input: "None — the system executes this.",
      action: "Restore the verified backup into the restore target.",
      where_to_enter: "Infrastructure → DI-00 → Backup & restore",
      after_input: "The artefact is verified, replayed and row counts are compared per table.",
      expected_evidence: "A restore record with verification PASS.",
      dependent_controls: ["DI-00"],
    });
  }

  return out;
}

/** The overall DI-00 state — the least advanced of the two environments. */
export function overallState(o: Di00Overview): Di00State {
  const latest = o.certifications[0];
  if (latest?.outcome === "PASS") return "CLEARED";
  const states = o.environments.map((e) => DI00_LIFECYCLE.indexOf(e.di00_state));
  const failed = o.environments.find((e) => e.di00_state.endsWith("_FAILED"));
  if (failed) return failed.di00_state;
  if (states.length === 0 || states.some((s) => s < 0)) return "CONFIGURATION_REQUIRED";
  return DI00_LIFECYCLE[Math.min(...states)];
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
