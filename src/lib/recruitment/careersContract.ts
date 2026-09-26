/**
 * Careers application contract integrity (INC-2026-08-31-RECRUITMENT-APPLICATION).
 *
 * The 31 Aug incident mechanism was version drift: a published careers bundle
 * that predated the document requirement engine could still be executed, so a
 * visitor submitted one document against a server that authoritatively required
 * three, and received a business-validation refusal that looked like their own
 * mistake. Republishing recovers that incident; it does not prevent the next one
 * (browser cache, CDN propagation, partial deployment, rollback).
 *
 * The permanent control is a handshake. Every careers build declares its
 * contract versions; the database answers with the authoritative versions and a
 * verdict. A client that is not compatible is stopped BEFORE the candidate does
 * any work, with an honest "please refresh" instead of a misleading rejection.
 *
 * Bump `CAREERS_APPLICATION_SCHEMA_VERSION` whenever the application payload or
 * the requirement contract changes in a way an older bundle cannot satisfy, and
 * raise `minimum_supported_client_version` in `rec_application_contract` when
 * older bundles must be locked out.
 */
import { supabase } from "@/integrations/supabase/client";
import { buildManifest } from "@/lib/runtime/buildManifest";

/** Wire contract between the careers client and `rec_public_*` functions. */
export const CAREERS_API_CONTRACT_VERSION = 1;
/** Application payload + requirement contract this bundle can satisfy. */
export const CAREERS_APPLICATION_SCHEMA_VERSION = 1;

export type ContractVerdict =
  | "COMPATIBLE"
  | "BUILD_TOO_OLD"
  | "APPLICATION_CONTRACT_INCOMPATIBLE"
  | "UNVERIFIED";

export interface CareersClientIdentity {
  build_id: string;
  api_contract_version: number;
  application_schema_version: number;
  /** Per-tab reference so repeated attempts can be told apart from repeat candidates. */
  session_ref: string;
}

export interface ApplicationContract {
  verdict: ContractVerdict;
  reason: string | null;
  server_time: string | null;
  authoritative: {
    api_contract_version: number;
    application_schema_version: number;
    minimum_supported_client_version: number;
    requirement_schema_version: number;
    careers_build_id: string | null;
  } | null;
  vacancy: {
    slug: string | null;
    requirement_version: number | null;
    vacancy_content_version: number | null;
  } | null;
  client: CareersClientIdentity;
}

const SESSION_KEY = "yalla.careers.sessionRef";

function sessionRef(): string {
  if (typeof sessionStorage === "undefined") return "ssr";
  let ref = sessionStorage.getItem(SESSION_KEY);
  if (!ref) {
    ref = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(SESSION_KEY, ref);
  }
  return ref;
}

/** Identity of the bundle currently executing in the visitor's browser. */
export function careersClientIdentity(): CareersClientIdentity {
  return {
    build_id: buildManifest().build_id,
    api_contract_version: CAREERS_API_CONTRACT_VERSION,
    application_schema_version: CAREERS_APPLICATION_SCHEMA_VERSION,
    session_ref: sessionRef(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Asks the database whether this bundle may run an application for `slug`.
 *
 * A transport failure returns `UNVERIFIED` rather than a block: the handshake
 * is a safety control, not a new single point of failure for the funnel. Only an
 * explicit server verdict stops the candidate.
 */
export async function fetchApplicationContract(slug: string | null): Promise<ApplicationContract> {
  const client = careersClientIdentity();
  try {
    const { data, error } = await db.rpc("rec_public_application_contract", {
      p_slug: slug,
      p_client: {
        build_id: client.build_id,
        api_contract_version: client.api_contract_version,
        application_schema_version: client.application_schema_version,
      },
    });
    if (error) throw new Error(error.message);
    const row = (data ?? {}) as Partial<ApplicationContract>;
    return {
      verdict: (row.verdict as ContractVerdict) ?? "UNVERIFIED",
      reason: row.reason ?? null,
      server_time: row.server_time ?? null,
      authoritative: row.authoritative ?? null,
      vacancy: row.vacancy ?? null,
      client,
    };
  } catch {
    return {
      verdict: "UNVERIFIED",
      reason: "The compatibility check could not be completed.",
      server_time: null,
      authoritative: null,
      vacancy: null,
      client,
    };
  }
}

/** True only when the server explicitly refused this bundle. */
export function isContractBlocking(contract: ApplicationContract | undefined): boolean {
  if (!contract) return false;
  return contract.verdict === "BUILD_TOO_OLD" || contract.verdict === "APPLICATION_CONTRACT_INCOMPATIBLE";
}

export function contractBlockMessage(contract: ApplicationContract): {
  title: string;
  detail: string;
  action: string;
} {
  const stale = contract.verdict === "BUILD_TOO_OLD";
  return {
    title: stale ? "This application form has been updated" : "This page is ahead of our recruitment service",
    detail:
      contract.reason ??
      (stale
        ? "You are viewing an older version of the careers application."
        : "Your browser is running a newer application form than the service it is talking to."),
    action: "Reload the page to continue. Nothing you have saved will be lost.",
  };
}

/** Forces the browser to fetch the current shell and assets, not the cached one. */
export async function reloadToCurrentBuild(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if (typeof navigator !== "undefined" && navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* cache eviction is best-effort; the reload below is the guarantee */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_b", Date.now().toString(36));
  window.location.replace(url.toString());
}
