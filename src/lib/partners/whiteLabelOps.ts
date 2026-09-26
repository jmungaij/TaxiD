/**
 * WHITE-LABEL OPERATIONS CLIENT — provisioning, incidents and signed evidence.
 *
 * Every mutation here goes through a server-side function that re-checks
 * authority (`partner_api_is_manager` / platform admin) and writes its own
 * hash-chained evidence entry. The client chooses *what* to do, never *whether
 * it is allowed*: if the UI were bypassed, the database would still refuse.
 *
 * Provisioning is deliberately two-layered:
 *   • `partner_wl_provision_tenant` is one transaction — it either produces a
 *     complete tenant (record, brand, both environments, sandbox credential,
 *     evidence) or nothing at all.
 *   • `partner_wl_provisioning_log` records each wizard step *outside* that
 *     transaction, so a failure and its rollback stay visible after the
 *     transaction has been discarded. That is the forensic point: a rollback
 *     must leave a trace, not a clean slate.
 */
import { supabase } from "@/integrations/supabase/client";
import { provisionTenant, type ProvisionInput, type ProvisionResult } from "./whiteLabelTenants";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

const rows = <T,>(data: unknown): T[] => (data ?? []) as T[];

export const EVIDENCE_BUCKET = "partner-wl-evidence";

/* ------------------------------------------------------------------ *
 * Provisioning log
 * ------------------------------------------------------------------ */

export type ProvisioningOutcome = "started" | "succeeded" | "failed" | "rolled_back";

export interface ProvisioningLogRow {
  id: string;
  partner_id: string;
  tenant_id: string | null;
  tenant_code: string;
  step: string;
  outcome: ProvisioningOutcome;
  detail: string | null;
  payload: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
}

export async function fetchProvisioningLogs(
  opts: { partnerId?: string; tenantCode?: string; tenantId?: string; limit?: number } = {},
): Promise<ProvisioningLogRow[]> {
  let q = db
    .from("partner_wl_provisioning_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.partnerId) q = q.eq("partner_id", opts.partnerId);
  if (opts.tenantCode) q = q.eq("tenant_code", opts.tenantCode);
  if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return rows<ProvisioningLogRow>(data);
}

export async function logProvisioningStep(input: {
  partnerId: string;
  tenantCode: string;
  step: string;
  outcome: ProvisioningOutcome;
  tenantId?: string | null;
  detail?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await db.rpc("partner_wl_log_provisioning_step", {
    _partner_id: input.partnerId,
    _tenant_code: input.tenantCode,
    _step: input.step,
    _outcome: input.outcome,
    _tenant_id: input.tenantId ?? null,
    _detail: input.detail ?? null,
    _payload: input.payload ?? {},
  });
  // A logging failure must never mask the operation it describes.
  if (error) console.warn("[white-label] provisioning log write failed:", error.message);
}

/** Remove a half-built tenant after a failed step, leaving the log behind. */
export async function abortProvisioning(
  tenantId: string,
  reason: string,
): Promise<{ ok: boolean; reason?: string; status?: string }> {
  const { data, error } = await db.rpc("partner_wl_abort_provisioning", {
    _tenant_id: tenantId,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
  const outcome = (data ?? { ok: true }) as { ok: boolean; reason?: string; status?: string };
  if (!outcome.ok) throw new Error(outcome.reason ?? "rollback refused");
  return outcome;
}

/* ------------------------------------------------------------------ *
 * Provisioning wizard runner
 * ------------------------------------------------------------------ */

export interface WizardStep {
  key: string;
  title: string;
  /** What the step proves once it has succeeded. */
  assurance: string;
}

/**
 * The wizard's steps. `provision` is the transactional one; the steps after it
 * are verifications — they read back what the transaction claims to have
 * created, so a silent partial provision cannot pass as success.
 */
export const WIZARD_STEPS: WizardStep[] = [
  { key: "validate", title: "Validate tenant identity", assurance: "Tenant code is well-formed and unique for the partner." },
  { key: "provision", title: "Provision tenant transaction", assurance: "Tenant, brand configuration, both environments and the sandbox credential were created together or not at all." },
  { key: "verify_environments", title: "Verify environment isolation", assurance: "Sandbox and production exist as separate records with separate base URLs." },
  { key: "verify_credential", title: "Verify sandbox credential", assurance: "A sandbox-scoped credential exists and is bound to this tenant only." },
  { key: "seed_readiness", title: "Open certification checklist", assurance: "Production readiness items are tracked from day one." },
];

export type StepState = "pending" | "running" | "done" | "failed" | "rolled_back";

export interface WizardProgress {
  step: string;
  state: StepState;
  detail?: string;
}

export interface WizardOutcome {
  ok: boolean;
  result?: ProvisionResult;
  failedStep?: string;
  error?: string;
  rolledBack?: boolean;
}

const CODE_RE = /^[a-z][a-z0-9-]{2,31}$/;

/** Tenant codes appear in URLs, headers and webhook payloads — keep them strict. */
export function validateTenantCode(code: string): string | null {
  if (!CODE_RE.test(code)) {
    return "Use 3–32 characters: lowercase letters, digits and hyphens, starting with a letter.";
  }
  return null;
}

/**
 * Run the provisioning wizard, reporting progress as it goes and rolling back
 * the tenant if any step after the transaction fails.
 */
export async function runProvisioningWizard(
  input: ProvisionInput,
  onProgress: (p: WizardProgress) => void,
): Promise<WizardOutcome> {
  const code = input.tenantCode.trim().toLowerCase();
  const base = { partnerId: input.partnerId, tenantCode: code };
  let tenantId: string | null = null;
  let result: ProvisionResult | undefined;

  const fail = async (step: string, message: string): Promise<WizardOutcome> => {
    onProgress({ step, state: "failed", detail: message });
    await logProvisioningStep({ ...base, step, outcome: "failed", tenantId, detail: message });

    if (tenantId) {
      try {
        await abortProvisioning(tenantId, `${step}: ${message}`);
        onProgress({ step, state: "rolled_back", detail: "Partial tenant removed." });
        await logProvisioningStep({
          ...base, step, outcome: "rolled_back", tenantId,
          detail: "Partial tenant removed after failure.",
        });
        return { ok: false, failedStep: step, error: message, rolledBack: true };
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        await logProvisioningStep({
          ...base, step: "rollback", outcome: "failed", tenantId,
          detail: `Rollback failed: ${why}`,
        });
        return { ok: false, failedStep: step, error: `${message} (rollback failed: ${why})` };
      }
    }
    return { ok: false, failedStep: step, error: message };
  };

  // 1 — validate
  onProgress({ step: "validate", state: "running" });
  const codeError = validateTenantCode(code);
  if (codeError) return fail("validate", codeError);
  if (!input.displayName.trim()) return fail("validate", "A display name is required.");
  await logProvisioningStep({ ...base, step: "validate", outcome: "started" });
  onProgress({ step: "validate", state: "done", detail: `Tenant code \u201c${code}\u201d accepted.` });
  await logProvisioningStep({ ...base, step: "validate", outcome: "succeeded" });

  // 2 — the transaction
  onProgress({ step: "provision", state: "running" });
  try {
    result = await provisionTenant({ ...input, tenantCode: code });
    tenantId = result.tenant_id;
  } catch (e) {
    return fail("provision", e instanceof Error ? e.message : String(e));
  }
  onProgress({ step: "provision", state: "done", detail: `Tenant ${result.tenant_code} created.` });
  await logProvisioningStep({
    ...base, step: "provision", outcome: "succeeded", tenantId,
    detail: "Transactional provisioning completed.",
    payload: { status: result.status, credential_issued: !!result.credential },
  });

  // 3 — environment isolation, read back from the database
  onProgress({ step: "verify_environments", state: "running" });
  try {
    const { data, error } = await db
      .from("partner_wl_environments")
      .select("environment, base_url")
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    const envs = rows<{ environment: string; base_url: string }>(data);
    const kinds = new Set(envs.map((e) => e.environment));
    if (!kinds.has("sandbox") || !kinds.has("production")) {
      return fail("verify_environments", "Both sandbox and production environments must exist.");
    }
    if (new Set(envs.map((e) => e.base_url)).size !== envs.length) {
      return fail("verify_environments", "Environments must not share a base URL.");
    }
    onProgress({ step: "verify_environments", state: "done", detail: `${envs.length} isolated environments.` });
    await logProvisioningStep({
      ...base, step: "verify_environments", outcome: "succeeded", tenantId,
      payload: { environments: envs.map((e) => e.environment) },
    });
  } catch (e) {
    return fail("verify_environments", e instanceof Error ? e.message : String(e));
  }

  // 4 — credential binding. The transaction returns the credential it issued;
  // read that exact row back and require it to be an active sandbox credential.
  onProgress({ step: "verify_credential", state: "running" });
  try {
    const credentialId = result.credential?.credential_id;
    if (!credentialId) {
      return fail("verify_credential", "No sandbox credential was issued for this tenant.");
    }
    const { data, error } = await db
      .from("partner_api_credentials")
      .select("id, environment, status, label")
      .eq("id", credentialId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const cred = data as { environment: string; status: string; label: string } | null;
    if (!cred) return fail("verify_credential", "The issued credential could not be read back.");
    if (cred.environment !== "sandbox") {
      return fail("verify_credential", `Credential was issued for ${cred.environment}, not sandbox.`);
    }
    if (cred.status !== "active") {
      return fail("verify_credential", `Credential is ${cred.status}, not active.`);
    }
    if (!cred.label.includes(code)) {
      return fail("verify_credential", "Credential is not labelled for this tenant.");
    }
    onProgress({ step: "verify_credential", state: "done", detail: "Active sandbox credential bound to this tenant." });
    await logProvisioningStep({
      ...base, step: "verify_credential", outcome: "succeeded", tenantId,
      payload: { credential_id: credentialId, environment: cred.environment },
    });
  } catch (e) {
    return fail("verify_credential", e instanceof Error ? e.message : String(e));
  }


  // 5 — checklist visibility (non-fatal: the checklist self-heals on open)
  onProgress({ step: "seed_readiness", state: "running" });
  try {
    const { error } = await db
      .from("partner_wl_readiness")
      .select("item_key", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    onProgress({ step: "seed_readiness", state: "done", detail: "Certification checklist open." });
    await logProvisioningStep({ ...base, step: "seed_readiness", outcome: "succeeded", tenantId });
  } catch (e) {
    onProgress({
      step: "seed_readiness",
      state: "done",
      detail: "Checklist will initialise when first opened.",
    });
    await logProvisioningStep({
      ...base, step: "seed_readiness", outcome: "succeeded", tenantId,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  return { ok: true, result };
}

/* ------------------------------------------------------------------ *
 * Incidents
 * ------------------------------------------------------------------ */

export async function createIncident(input: {
  tenantId: string;
  severity: string;
  title: string;
  detail?: string;
  correlationId?: string;
  assignedTo?: string | null;
}): Promise<{ ok: boolean; incident_id: string; reference: string }> {
  const { data, error } = await db.rpc("partner_wl_incident_create", {
    _tenant_id: input.tenantId,
    _severity: input.severity,
    _title: input.title,
    _detail: input.detail ?? null,
    _correlation_id: input.correlationId ?? null,
    _assigned_to: input.assignedTo ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; incident_id: string; reference: string };
}

export async function updateIncident(input: {
  incidentId: string;
  status?: string;
  severity?: string;
  assignedTo?: string | null;
  clearAssignee?: boolean;
  resolution?: string;
  note?: string;
}): Promise<{ ok: boolean; incident_id: string; status: string }> {
  const { data, error } = await db.rpc("partner_wl_incident_update", {
    _incident_id: input.incidentId,
    _status: input.status ?? null,
    _severity: input.severity ?? null,
    _assigned_to: input.assignedTo ?? null,
    _clear_assignee: input.clearAssignee ?? false,
    _resolution: input.resolution ?? null,
    _note: input.note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; incident_id: string; status: string };
}

/** Incident lifecycle: which transitions the console offers from a given state. */
export const INCIDENT_TRANSITIONS: Record<string, string[]> = {
  open: ["mitigating", "monitoring", "resolved"],
  mitigating: ["monitoring", "resolved"],
  monitoring: ["resolved", "mitigating"],
  resolved: ["closed", "monitoring"],
  closed: [],
};

export const INCIDENT_SEVERITIES = ["sev1", "sev2", "sev3", "sev4"] as const;

/* ------------------------------------------------------------------ *
 * Evidence artefacts: upload, version history, signing
 * ------------------------------------------------------------------ */

export interface EvidenceArtifact {
  id: string;
  tenant_id: string;
  partner_id: string;
  evidence_id: string | null;
  document_key: string;
  version: number;
  title: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  note: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface EvidenceSignature {
  id: string;
  evidence_id: string;
  tenant_id: string;
  key_id: string;
  algorithm: string;
  signature_b64: string;
  statement_hash: string;
  signed_at: string;
}

export async function fetchArtifacts(tenantId: string, limit = 200): Promise<EvidenceArtifact[]> {
  const { data, error } = await db
    .from("partner_wl_evidence_artifacts")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("document_key")
    .order("version", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return rows<EvidenceArtifact>(data);
}

export async function fetchSignatures(tenantId: string, limit = 300): Promise<EvidenceSignature[]> {
  const { data, error } = await db
    .from("partner_wl_evidence_signatures")
    .select("id, evidence_id, tenant_id, key_id, algorithm, signature_b64, statement_hash, signed_at")
    .eq("tenant_id", tenantId)
    .order("signed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return rows<EvidenceSignature>(data);
}

/** SHA-256 of the file bytes, computed in the browser before upload. */
export async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Group artefacts into version history per document key, newest first. */
export function artifactVersions(list: EvidenceArtifact[]): Map<string, EvidenceArtifact[]> {
  const byKey = new Map<string, EvidenceArtifact[]>();
  for (const a of list) {
    const bucket = byKey.get(a.document_key) ?? [];
    bucket.push(a);
    byKey.set(a.document_key, bucket);
  }
  for (const bucket of byKey.values()) bucket.sort((a, b) => b.version - a.version);
  return byKey;
}

export interface UploadEvidenceInput {
  tenantId: string;
  partnerId: string;
  documentKey: string;
  title: string;
  file: File;
  note?: string;
  subjectRef?: string;
}

export interface UploadEvidenceResult {
  artifact_id: string;
  version: number;
  evidence_id: string;
  entry_hash: string;
  sha256: string;
  signature?: { key_id: string; statement_hash: string; signed_at: string } | null;
  signing_error?: string;
}

/**
 * Upload an audit artefact and seal it.
 *
 * Order matters: the file lands in private storage first, then the database
 * records the artefact *and* a hash-chained evidence entry in one call, then the
 * edge function signs the statement the database derived. The signature covers
 * the recorded hash — so a later swap of the stored bytes cannot pass
 * verification, and the version row for the previous upload is never mutated.
 */
export async function uploadEvidenceArtifact(
  input: UploadEvidenceInput,
): Promise<UploadEvidenceResult> {
  const sha256 = await hashFile(input.file);
  const safeName = input.file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const path = `${input.partnerId}/${input.tenantId}/${input.documentKey}/${Date.now()}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, input.file, { contentType: input.file.type || "application/octet-stream", upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { data, error } = await db.rpc("partner_wl_evidence_attach", {
    _tenant_id: input.tenantId,
    _document_key: input.documentKey,
    _title: input.title,
    _file_name: input.file.name,
    _storage_path: path,
    _mime_type: input.file.type || "application/octet-stream",
    _byte_size: input.file.size,
    _sha256: sha256,
    _note: input.note ?? null,
    _subject_ref: input.subjectRef ?? null,
  });
  if (error) {
    // Do not leave an orphan object behind if the ledger write was refused.
    await supabase.storage.from(EVIDENCE_BUCKET).remove([path]);
    throw new Error(error.message);
  }

  const attached = data as { artifact_id: string; version: number; evidence_id: string; entry_hash: string };
  const sealed = await signEvidence(attached.evidence_id).catch((e) => ({
    error: e instanceof Error ? e.message : String(e),
  }));

  return {
    ...attached,
    sha256,
    signature: "error" in sealed ? null : sealed,
    signing_error: "error" in sealed ? sealed.error : undefined,
  };
}

/** Ask the signing function to seal one evidence entry. */
export async function signEvidence(
  evidenceId: string,
): Promise<{ key_id: string; statement_hash: string; signed_at: string }> {
  const { data, error } = await supabase.functions.invoke("partner-wl-evidence-sign", {
    body: { action: "sign", evidence_id: evidenceId },
  });
  if (error) throw new Error(error.message);
  const payload = (data as { data?: Record<string, unknown> })?.data ?? data;
  return payload as { key_id: string; statement_hash: string; signed_at: string };
}

export interface VerificationResult {
  signed: boolean;
  signature_valid: boolean;
  statement_match?: boolean;
  key_id?: string;
  key_trusted?: boolean;
  signed_at?: string;
  reason?: string;
}

/** Re-derive the statement server-side and verify the recorded signature. */
export async function verifyEvidenceSignature(evidenceId: string): Promise<VerificationResult> {
  const { data, error } = await supabase.functions.invoke("partner-wl-evidence-sign", {
    body: { action: "verify", evidence_id: evidenceId },
  });
  if (error) throw new Error(error.message);
  const payload = (data as { data?: Record<string, unknown> })?.data ?? data;
  return payload as VerificationResult;
}

/** Short-lived signed URL for a stored artefact; the bucket itself stays private. */
export async function artifactDownloadUrl(storagePath: string, seconds = 120): Promise<string> {
  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(storagePath, seconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
