/**
 * Control-tower audit trail — an append-only, browser-persisted ledger for every
 * operator action taken from the delivery control tower (AI dispatch actions,
 * procurement approvals, compliance decisions).
 *
 * Entries are hash-chained the same way the platform's server-side forensic
 * ledgers are, so an exported trail can be verified for tampering. Nothing here
 * replaces the backend audit tables — it is the client-side evidence of intent
 * captured at the moment the operator confirmed the action.
 */
import type { DeliveryModule } from "@/components/delivery/ModuleShell";

export const AUDIT_TRAIL_VERSION = "1.0.0";
const STORAGE_KEY = "yalla.controlTower.audit.v1";
const MAX_ENTRIES = 200;

export type AuditDomain = "dispatch" | "procurement" | "compliance";

export interface AuditImpact {
  label: string;
  value: string;
}

export interface AuditEntry {
  id: string;
  domain: AuditDomain;
  module: DeliveryModule;
  action: string;
  subject: string;
  actor: string;
  reason?: string;
  impact: AuditImpact[];
  status: "applied" | "reverted";
  at: string;
  /** Hash of this entry chained onto the previous entry's hash. */
  hash: string;
  prevHash: string;
}

export interface AuditRecordInput {
  domain: AuditDomain;
  module: DeliveryModule;
  action: string;
  subject: string;
  actor: string;
  reason?: string;
  impact?: AuditImpact[];
}

/* ----------------------------------------------------------------- hashing */

/** Stable 64-bit-ish FNV hash rendered as hex — deterministic, no crypto async. */
function hashOf(input: string): string {
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = ((h2 << 5) + h2 + c) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

function chainHash(entry: Omit<AuditEntry, "hash">): string {
  return hashOf(
    [entry.prevHash, entry.id, entry.domain, entry.module, entry.action, entry.subject, entry.actor, entry.status, entry.at]
      .join("|"),
  );
}

/* ---------------------------------------------------------------- storage */

let memory: AuditEntry[] | null = null;
const listeners = new Set<() => void>();

function read(): AuditEntry[] {
  if (memory) return memory;
  if (typeof window === "undefined") {
    memory = [];
    return memory;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    memory = raw ? (JSON.parse(raw) as AuditEntry[]) : [];
  } catch {
    memory = [];
  }
  return memory;
}

function write(next: AuditEntry[]) {
  memory = next.slice(0, MAX_ENTRIES);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
    } catch {
      /* quota or private mode — the in-memory ledger still works this session */
    }
  }
  listeners.forEach((fn) => fn());
}

/* ------------------------------------------------------------------- api */

export function recordAudit(input: AuditRecordInput): AuditEntry {
  const entries = read();
  const prevHash = entries[0]?.hash ?? "genesis";
  const base: Omit<AuditEntry, "hash"> = {
    id: `${input.domain}-${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`,
    domain: input.domain,
    module: input.module,
    action: input.action,
    subject: input.subject,
    actor: input.actor,
    reason: input.reason,
    impact: input.impact ?? [],
    status: "applied",
    at: new Date().toISOString(),
    prevHash,
  };
  const entry: AuditEntry = { ...base, hash: chainHash(base) };
  write([entry, ...entries]);
  return entry;
}

/** Appends a compensating "reverted" record — the original entry is never mutated. */
export function revertAudit(id: string, actor: string, reason?: string): AuditEntry | null {
  const entries = read();
  const original = entries.find((e) => e.id === id);
  if (!original) return null;
  const prevHash = entries[0]?.hash ?? "genesis";
  const base: Omit<AuditEntry, "hash"> = {
    ...original,
    id: `${original.id}-revert`,
    actor,
    reason: reason ?? `Reverted ${original.action}`,
    status: "reverted",
    at: new Date().toISOString(),
    prevHash,
  };
  const entry: AuditEntry = { ...base, hash: chainHash(base) };
  write([entry, ...entries]);
  return entry;
}

export function listAudit(filter?: { domain?: AuditDomain; module?: DeliveryModule; limit?: number }): AuditEntry[] {
  const entries = read().filter(
    (e) => (!filter?.domain || e.domain === filter.domain) && (!filter?.module || e.module === filter.module),
  );
  return filter?.limit ? entries.slice(0, filter.limit) : entries;
}

/** True when every entry's hash still matches its chained inputs. */
export function verifyAuditChain(entries: AuditEntry[] = read()): boolean {
  return entries.every((e) => {
    const { hash, ...rest } = e;
    return chainHash(rest) === hash;
  });
}

export function subscribeAudit(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function auditTrailCsv(entries: AuditEntry[]): string {
  const head = ["timestamp", "domain", "module", "action", "subject", "actor", "status", "reason", "impact", "hash", "prev_hash"];
  const rows = entries.map((e) => [
    e.at,
    e.domain,
    e.module,
    e.action,
    e.subject,
    e.actor,
    e.status,
    e.reason ?? "",
    e.impact.map((i) => `${i.label}: ${i.value}`).join("; "),
    e.hash,
    e.prevHash,
  ]);
  return [head, ...rows]
    .map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(","))
    .join("\n");
}
