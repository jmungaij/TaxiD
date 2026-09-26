/**
 * Publication readiness model (ten domains).
 *
 * Root cause of the "cannot publish" wall: vacancy creation never provisioned
 * the two authoritative dependent artefacts (application blueprint and the
 * vacancy-scoped document requirement contract), and no mechanism ever
 * registered the deployed careers build. The four messages HR saw were two ROOT
 * blockers (blueprint + requirement contract), one ROOT blocker of a different
 * owner (careers build registration) and one DERIVED blocker (the end-to-end
 * run, which cannot execute before the other three exist).
 *
 * This module is the read model plus the three remediation calls. Every verdict
 * is computed in the database; nothing here can mark a domain as passed.
 */
import { supabase } from "@/integrations/supabase/client";
import { buildManifest } from "@/lib/runtime/buildManifest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type DomainState = "PASS" | "FAIL" | "PENDING" | "NOT_APPLICABLE";

export interface ReadinessDomain {
  key: string;
  label: string;
  state: DomainState;
  reason: string;
  dependency: string | null;
  owner: string;
  action: string;
}

export interface PublicationReadiness {
  vacancy_id: string;
  vacancy_no: string;
  title: string;
  employment_type: string;
  content_version: number | null;
  publication_status: string;
  checked_at: string;
  domains: ReadinessDomain[];
  verdict: "READY" | "BLOCKED" | "UNKNOWN";
}

export const STATE_TONE: Record<DomainState, string> = {
  PASS: "text-primary",
  FAIL: "text-destructive",
  PENDING: "text-warning",
  NOT_APPLICABLE: "text-muted-foreground",
};

export const STATE_LABEL: Record<DomainState, string> = {
  PASS: "PASS",
  FAIL: "BLOCKER",
  PENDING: "PENDING",
  NOT_APPLICABLE: "NOT APPLICABLE",
};

export async function fetchPublicationReadiness(vacancyId: string): Promise<PublicationReadiness> {
  const { data, error } = await db.rpc("rec_publication_readiness", { p_vacancy: vacancyId });
  if (error) throw new Error(error.message);
  return data as PublicationReadiness;
}

/** Creates the blueprint and requirement contract from the approved templates. */
export async function provisionPrerequisites(vacancyId: string): Promise<unknown> {
  const { data, error } = await db.rpc("rec_vacancy_provision_prerequisites", { p_vacancy: vacancyId });
  if (error) throw new Error(error.message);
  return data;
}

/** Registers the build actually executing in this browser as authoritative. */
export async function registerCurrentCareersBuild(): Promise<{ build_id: string }> {
  const manifest = buildManifest();
  const { data, error } = await db.rpc("rec_careers_build_register", {
    p_build_id: manifest.build_id,
    p_notes: `Registered from the readiness console (commit ${manifest.commit_sha}, ${manifest.environment}).`,
  });
  if (error) throw new Error(error.message);
  return data as { build_id: string };
}

export interface CertificationCase {
  case: string;
  name: string;
  passed: boolean;
  detail: string;
}

export interface CertificationResult {
  ok: boolean;
  outcome: "PASS" | "FAIL";
  cases_total: number;
  cases_passed: number;
  cases: CertificationCase[];
}

/**
 * Executes the synthetic application run against the live engines and records
 * append-only evidence bound to the vacancy, requirement and build versions.
 */
export async function certifyApplication(vacancyId: string): Promise<CertificationResult> {
  const { data, error } = await db.rpc("rec_vacancy_certify_application", { p_vacancy: vacancyId });
  if (error) throw new Error(error.message);
  return data as CertificationResult;
}

export interface PrepareAction {
  key: string;
  label: string;
  owner: string;
  route?: string;
  set_id?: string | null;
}

export interface PrepareResult {
  ok: boolean;
  vacancy_id: string;
  steps: { step: string; result: Record<string, unknown> }[];
  actions_required: PrepareAction[];
  readiness_percent: number;
  readiness: PublicationReadiness;
  verdict: "READY" | "BLOCKED" | "UNKNOWN";
}

/**
 * ONE deterministic preparation. HR does not have to know that a requirement
 * contract, a blueprint, an assessment contract, a build handshake and a
 * synthetic run exist: the orchestrator resolves and provisions everything that
 * is legitimately derivable, executes certification when the prerequisites
 * genuinely hold, and returns the exact human actions that remain.
 *
 * The build id can only come from the bundle actually executing in this
 * browser, so it is registered first — then the database does the rest in one
 * transaction under an advisory lock.
 */
export async function preparePublicationContract(vacancyId: string): Promise<PrepareResult> {
  try {
    await registerCurrentCareersBuild();
  } catch {
    // Registration is a separate authority; the orchestrator will report it as a blocker.
  }
  const { data, error } = await db.rpc("rec_vacancy_prepare_publication", { p_vacancy: vacancyId });
  if (error) throw new Error(error.message);
  return data as PrepareResult;
}


/** A domain is actionable when it blocks and its dependency is already satisfied. */
export function actionableDomains(readiness: PublicationReadiness | undefined): ReadinessDomain[] {
  if (!readiness) return [];
  const byKey = new Map(readiness.domains.map((d) => [d.key, d]));
  return readiness.domains.filter((d) => {
    if (d.state !== "FAIL" && d.state !== "PENDING") return false;
    if (!d.dependency) return true;
    const dep = byKey.get(d.dependency);
    return !dep || dep.state === "PASS" || dep.state === "NOT_APPLICABLE";
  });
}

export function readinessReady(readiness: PublicationReadiness | undefined): boolean {
  return readiness?.verdict === "READY";
}
