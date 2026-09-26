/**
 * Forensic assurance packet — one downloadable, tamper-evident JSON bundle
 * that reconstructs a transaction's entire commercial chain:
 *
 *   transaction → documents (+ sealed PDF hashes) → event stream →
 *   email dispatch trail → lineage stages → integrity summary → manifest hash
 *
 * The `manifest_sha256` is computed over the canonical (key-sorted) JSON of
 * everything else in the packet, so any post-export edit is detectable by
 * recomputing one digest.
 */
import { sha256Hex } from "./documentPdf";
import type { DocumentDispatchStatus } from "./documents";

export const ASSURANCE_PACKET_KIND = "yalla-commercial-forensic-audit";
export const ASSURANCE_PACKET_VERSION = 1;

/* ------------------------------------------- trace input (structural) */

export interface PacketTransaction {
  id: string;
  transaction_ref: string;
  service_line?: string | null;
  status?: string | null;
  payment_status?: string | null;
  etims_status?: string | null;
  total_cents?: number | null;
  currency?: string | null;
}

export interface PacketDocument {
  id: string;
  document_number: string;
  document_type: string;
  status: string;
  version: number;
  total_cents: number;
  document_hash?: string | null;
  hash_algorithm?: string | null;
  created_by?: string | null;
  approved_by?: string | null;
}

export interface PacketEvent {
  id: string;
  event_type: string;
  actor_id?: string | null;
  prev_status?: string | null;
  new_status?: string | null;
  created_at: string;
}

export interface PacketDispatch {
  id: string;
  document_id: string;
  message_id: string;
  recipient_email: string;
  subject: string;
  template_key: string;
  template_version: string;
  pdf_sha256?: string | null;
  status: DocumentDispatchStatus | string;
  attempt_count: number;
  error_message?: string | null;
  created_at: string;
}

export interface PacketLineage {
  id: string;
  stage_no: number;
  stage: string;
  status: string;
}

export interface CommercialTraceLike {
  found: boolean;
  transaction?: PacketTransaction | null;
  documents?: PacketDocument[] | null;
  events?: PacketEvent[] | null;
  dispatches?: PacketDispatch[] | null;
  lineage?: PacketLineage[] | null;
}

/* ------------------------------------------------------- packet model */

export interface SodFinding {
  document_number: string;
  created_by: string | null;
  approved_by: string | null;
  sod_respected: boolean;
}

export interface AssuranceIntegrity {
  documents_total: number;
  sealed_documents: number;
  unsealed_document_numbers: string[];
  dispatches_total: number;
  dispatches_by_status: Record<string, number>;
  failed_dispatches: number;
  exception_events: number;
  sod_findings: SodFinding[];
  sod_violations: number;
}

export interface AssurancePacket {
  kind: typeof ASSURANCE_PACKET_KIND;
  packet_version: number;
  generated_at: string;
  transaction_ref: string;
  transaction: PacketTransaction | null;
  documents: PacketDocument[];
  events: PacketEvent[];
  dispatches: PacketDispatch[];
  lineage: PacketLineage[];
  integrity: AssuranceIntegrity;
  manifest_sha256?: string;
}

const EXCEPTION_EVENTS = new Set([
  "ISSUANCE_BLOCKED",
  "COMMERCIAL_VARIANCE_EXCEPTION",
  "AUDIT_EXCEPTION_CREATED",
  "ETIMS_REJECTED",
  "EMAIL_BOUNCED",
  "EMAIL_FAILED",
  "DOCUMENT_VOIDED",
  "DOCUMENT_SUPERSEDED",
]);

export function buildAssurancePacket(
  trace: CommercialTraceLike,
  generatedAt = new Date().toISOString(),
): AssurancePacket {
  const documents = trace.documents ?? [];
  const events = trace.events ?? [];
  const dispatches = trace.dispatches ?? [];
  const lineage = trace.lineage ?? [];

  const dispatchesByStatus: Record<string, number> = {};
  for (const d of dispatches) {
    dispatchesByStatus[d.status] = (dispatchesByStatus[d.status] ?? 0) + 1;
  }

  const sodFindings: SodFinding[] = documents
    .filter((d) => d.approved_by)
    .map((d) => ({
      document_number: d.document_number,
      created_by: d.created_by ?? null,
      approved_by: d.approved_by ?? null,
      sod_respected: !d.created_by || d.created_by !== d.approved_by,
    }));

  return {
    kind: ASSURANCE_PACKET_KIND,
    packet_version: ASSURANCE_PACKET_VERSION,
    generated_at: generatedAt,
    transaction_ref: trace.transaction?.transaction_ref ?? "unknown",
    transaction: trace.transaction ?? null,
    documents,
    events,
    dispatches,
    lineage,
    integrity: {
      documents_total: documents.length,
      sealed_documents: documents.filter((d) => !!d.document_hash).length,
      unsealed_document_numbers: documents.filter((d) => !d.document_hash).map((d) => d.document_number),
      dispatches_total: dispatches.length,
      dispatches_by_status: dispatchesByStatus,
      failed_dispatches: dispatches.filter((d) => d.status === "failed" || d.status === "bounced").length,
      exception_events: events.filter((e) => EXCEPTION_EVENTS.has(e.event_type)).length,
      sod_findings: sodFindings,
      sod_violations: sodFindings.filter((f) => !f.sod_respected).length,
    },
  };
}

/* ------------------------------------------- canonical manifest hashing */

function sortRec(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRec);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortRec((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Stable JSON (recursively sorted keys) — the canonical form being hashed. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortRec(value));
}

/** SHA-256 over the canonical packet WITHOUT the manifest field itself. */
export async function assurancePacketHash(packet: AssurancePacket): Promise<string> {
  const { manifest_sha256: _omit, ...rest } = packet;
  return sha256Hex(new TextEncoder().encode(canonicalJson(rest)));
}

/** Attaches the tamper-evident manifest hash. */
export async function finalizeAssurancePacket(packet: AssurancePacket): Promise<AssurancePacket> {
  return { ...packet, manifest_sha256: await assurancePacketHash(packet) };
}

export function downloadAssurancePacket(packet: AssurancePacket): void {
  const day = packet.generated_at.slice(0, 10);
  const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `yalla-commercial-audit-${packet.transaction_ref}-${day}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
