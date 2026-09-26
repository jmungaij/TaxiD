/**
 * Immutable SmartFare pricing audit log.
 *
 * Every computed mission price that is shown to a customer or exported for an
 * RFQ is recorded with the exact inputs it was produced from: the operator rate
 * card (and its submission timestamp, which is its version), the components
 * that were missing, the admin SmartFare configuration version in force, and
 * the resulting settlement figures.
 *
 * Records are append-only and hash-chained: each entry commits to the previous
 * entry's hash, so any retro-edit of a stored record is detectable. Writes never
 * mutate an existing entry.
 */
import type { MissionFare, ReplayInput } from "./smartFare";
import type { OperatorMissionInputs } from "./operatorRateCards";
import { loadSmartFareVersions } from "./smartFare";
import { buildMissionProvenance } from "./pricingProvenance";
import { validateFare } from "./rateCardValidation";
import { missionSegmentAlerts } from "./segmentAlerts";

export interface PricingAuditRecord {
  id: string;
  /** Monotonic sequence within the chain. */
  seq: number;
  at: string;
  actor: string | null;
  reason: "quote_view" | "csv_export" | "pdf_export" | "booking_request";
  missionRef: string;
  route: string;
  aircraftKey: string;
  aircraftLabel: string;
  segment: string;
  sectors: number;
  distanceNm: number;
  blockHours: number;
  carbonKg: number;
  priceBasis: MissionFare["priceBasis"];
  operatorId: string | null;
  operatorName: string | null;
  /** Rate card identity + version (its submission timestamp). */
  rateCardId: string | null;
  rateCardVersion: string | null;
  availabilityConfirmed: boolean;
  missingFields: string[];
  operatorCoveragePct: number;
  configVersion: number;
  configSavedAt: string | null;
  configActor: string | null;
  grossMissionCost: number;
  totalSavings: number;
  platformFeePct: number;
  platformFee: number;
  vat: number;
  total: number;
  canFinalise: boolean;
  validationSummary: string;
  segmentAlerts: { segment: string; severity: string; kind: string; label: string }[];
  /** Exact mission inputs, so the computation can be replayed. */
  replayInput: ReplayInput | null;
  /** Snapshot of the operator rate card in force at quote time. */
  operatorCard: OperatorMissionInputs | null;
  prevHash: string;
  hash: string;
}

const STORE_KEY = "yalla.smartfare.priceAudit.v1";
const MAX = 500;
const GENESIS = "0".repeat(16);

/** Deterministic, dependency-free 64-bit-ish digest (FNV-1a x2, hex). */
export function digest(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"));
}

function read(): PricingAuditRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PricingAuditRecord[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const listPricingAudit = (): PricingAuditRecord[] => read();

/** Payload used for the hash — everything except the hash itself. */
export function canonicalPayload(r: Omit<PricingAuditRecord, "hash">): string {
  return JSON.stringify(r, Object.keys(r).sort());
}

const canonical = canonicalPayload;

/** Re-derive the hash of a single record (used by replay + verification). */
export function hashRecord(record: PricingAuditRecord): string {
  const { hash: _ignored, ...rest } = record;
  return digest(canonical(rest));
}

export interface RecordArgs {
  reason?: PricingAuditRecord["reason"];
  actor?: string | null;
  at?: string;
}

/** Append an immutable record for a computed mission fare. */
export function recordPricingAudit(fare: MissionFare, args: RecordArgs = {}): PricingAuditRecord {
  const p = buildMissionProvenance(fare);
  const v = validateFare(fare);
  const versions = loadSmartFareVersions();
  const latest = versions[versions.length - 1];
  const chain = read();
  const prev = chain[chain.length - 1];

  const base: Omit<PricingAuditRecord, "hash"> = {
    id: `pa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    seq: (prev?.seq ?? 0) + 1,
    at: args.at ?? new Date().toISOString(),
    actor: args.actor ?? null,
    reason: args.reason ?? "quote_view",
    missionRef: `SF-${fare.from?.code ?? "XXX"}${fare.to?.code ?? "XXX"}-${fare.aircraft.key.toUpperCase().slice(0, 6)}`,
    route: `${fare.from?.code ?? "—"} → ${fare.to?.code ?? "—"}`,
    aircraftKey: fare.aircraft.key,
    aircraftLabel: fare.aircraft.label,
    segment: fare.segment,
    sectors: fare.sectors,
    distanceNm: fare.distanceNm,
    blockHours: fare.blockHours,
    carbonKg: fare.carbonKg,
    priceBasis: fare.priceBasis,
    operatorId: fare.operator?.operatorId ?? null,
    operatorName: fare.operator?.operatorName ?? null,
    rateCardId: fare.operator?.id ?? null,
    rateCardVersion: fare.operator?.submittedAt ?? null,
    availabilityConfirmed: Boolean(fare.operator?.availabilityConfirmed),
    missingFields: p.missing.map((m) => m.key),
    operatorCoveragePct: p.operatorCoveragePct,
    configVersion: latest?.version ?? 0,
    configSavedAt: latest?.savedAt ?? null,
    configActor: latest?.actor ?? null,
    grossMissionCost: fare.grossMissionCost,
    totalSavings: fare.totalSavings,
    platformFeePct: fare.platformFeePct,
    platformFee: fare.platformFee,
    vat: fare.vat,
    total: fare.total,
    canFinalise: v.canFinalise,
    validationSummary: v.summary,
    segmentAlerts: missionSegmentAlerts(fare).flatMap((g) =>
      g.alerts.map((a) => ({ segment: g.segment, severity: a.severity, kind: a.kind, label: a.label }))),
    replayInput: fare.replayInput ?? null,
    operatorCard: fare.operator ? { ...fare.operator } : null,
    prevHash: prev?.hash ?? GENESIS,
  };

  const entry: PricingAuditRecord = { ...base, hash: digest(canonical(base)) };

  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...chain, entry].slice(-MAX)));
  } catch {
    /* storage unavailable — pricing must never fail because auditing cannot persist */
  }
  return entry;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAt: number | null;
  message: string;
}

/** Re-derive every hash and confirm the chain has not been tampered with. */
export function verifyPricingAuditChain(records: PricingAuditRecord[] = read()): ChainVerification {
  let prevHash = records[0]?.prevHash ?? GENESIS;
  for (const r of records) {
    const { hash, ...rest } = r;
    if (rest.prevHash !== prevHash || digest(canonical(rest)) !== hash) {
      return { ok: false, checked: records.length, brokenAt: r.seq, message: `Chain broken at record #${r.seq}.` };
    }
    prevHash = hash;
  }
  return {
    ok: true,
    checked: records.length,
    brokenAt: null,
    message: records.length ? `${records.length} pricing records verified.` : "No pricing records yet.",
  };
}

/** CSV of the audit chain for regulator / procurement disclosure. */
export function pricingAuditToCsv(records: PricingAuditRecord[] = read()): string {
  const cols: (keyof PricingAuditRecord)[] = [
    "seq", "at", "reason", "missionRef", "route", "aircraftLabel", "segment", "priceBasis",
    "operatorName", "rateCardId", "rateCardVersion", "availabilityConfirmed", "operatorCoveragePct",
    "configVersion", "configSavedAt", "grossMissionCost", "totalSavings", "platformFeePct",
    "platformFee", "vat", "total", "canFinalise", "validationSummary", "prevHash", "hash",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.map(esc).join(",")];
  for (const r of records) {
    lines.push(cols.map((c) => esc(r[c])).join(","));
    }
  return lines.join("\n");
}
