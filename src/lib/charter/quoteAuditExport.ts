/**
 * Per-quote pricing audit export.
 *
 * Support, procurement and regulators all ask the same question about a single
 * quote: *what exactly produced this number?* This module extracts the audit
 * records belonging to one mission reference and renders them as a JSON bundle
 * (full fidelity, including the hash chain and replay inputs) or a CSV (one row
 * per audit event) — with chain verification attached to both.
 */
import type { MissionFare } from "./smartFare";
import {
  listPricingAudit, verifyPricingAuditChain, hashRecord,
  type PricingAuditRecord, type ChainVerification,
} from "./pricingAuditLog";
import { missionRef } from "./smartFareExport";
import { assessQuoteReadiness } from "./quoteReadiness";

export interface QuoteAuditBundle {
  missionRef: string;
  generatedAt: string;
  /** Verification of the whole platform chain the records live in. */
  chain: ChainVerification;
  /** Per-record hash re-derivation for just this quote. */
  recordIntegrity: { seq: number; hash: string; recomputed: string; ok: boolean }[];
  records: PricingAuditRecord[];
  latest: PricingAuditRecord | null;
  readiness: {
    blocked: boolean;
    blockReason: string;
    blockDetail: string[];
    missingComponents: string[];
    failedRouteChecks: string[];
  } | null;
}

/** Collect every audit record for one mission reference. */
export function buildQuoteAuditBundle(
  ref: string,
  opts: { fare?: MissionFare; records?: PricingAuditRecord[] } = {},
): QuoteAuditBundle {
  const all = opts.records ?? listPricingAudit();
  const records = all.filter((r) => r.missionRef === ref);
  const readinessSource = opts.fare ? assessQuoteReadiness(opts.fare) : null;

  return {
    missionRef: ref,
    generatedAt: new Date().toISOString(),
    chain: verifyPricingAuditChain(all),
    recordIntegrity: records.map((r) => {
      const recomputed = hashRecord(r);
      return { seq: r.seq, hash: r.hash, recomputed, ok: recomputed === r.hash };
    }),
    records,
    latest: records[records.length - 1] ?? null,
    readiness: readinessSource
      ? {
        blocked: readinessSource.blocked,
        blockReason: readinessSource.blockReason,
        blockDetail: readinessSource.blockDetail,
        missingComponents: readinessSource.missingComponents.map((m) => m.label),
        failedRouteChecks: readinessSource.failedRouteChecks.map((c) => c.label),
      }
      : null,
  };
}

export const buildFareAuditBundle = (fare: MissionFare): QuoteAuditBundle =>
  buildQuoteAuditBundle(missionRef(fare), { fare });

export const quoteAuditToJson = (bundle: QuoteAuditBundle): string =>
  JSON.stringify(bundle, null, 2);

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const row = (cells: unknown[]) => cells.map(esc).join(",");

/** CSV: quote header, block reason, then one row per audit event. */
export function quoteAuditToCsv(bundle: QuoteAuditBundle): string {
  const lines: string[] = [];
  lines.push(row(["SAFARID SmartFare quote pricing audit log"]));
  lines.push(row(["Mission reference", bundle.missionRef]));
  lines.push(row(["Generated", bundle.generatedAt]));
  lines.push(row(["Chain verified", bundle.chain.ok ? "Yes" : "No"]));
  lines.push(row(["Chain message", bundle.chain.message]));
  lines.push(row(["Audit events", bundle.records.length]));
  if (bundle.readiness) {
    lines.push(row(["Quote status", bundle.readiness.blocked ? "Locked" : "Binding quote eligible"]));
    lines.push(row(["Block reason", bundle.readiness.blockReason]));
    for (const d of bundle.readiness.blockDetail) lines.push(row(["Block detail", d]));
  }
  lines.push("");

  const cols: (keyof PricingAuditRecord)[] = [
    "seq", "at", "reason", "actor", "route", "aircraftLabel", "segment", "priceBasis",
    "operatorName", "rateCardId", "rateCardVersion", "availabilityConfirmed",
    "operatorCoveragePct", "configVersion", "configSavedAt", "configActor",
    "grossMissionCost", "totalSavings", "platformFeePct", "platformFee", "vat", "total",
    "canFinalise", "validationSummary",
  ];
  lines.push(row([...cols, "missingFields", "prevHash", "hash", "hashRecomputed", "hashValid"]));
  for (const r of bundle.records) {
    const integrity = bundle.recordIntegrity.find((i) => i.seq === r.seq);
    lines.push(row([
      ...cols.map((c) => r[c]),
      r.missingFields.join(" | ") || "none",
      r.prevHash, r.hash, integrity?.recomputed ?? "", integrity?.ok ? "Yes" : "No",
    ]));
  }
  return lines.join("\n");
}

function download(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download the audit log for a single quote. */
export function downloadQuoteAudit(fare: MissionFare, format: "json" | "csv") {
  const bundle = buildFareAuditBundle(fare);
  if (format === "json") {
    download(quoteAuditToJson(bundle), `${bundle.missionRef}-pricing-audit.json`, "application/json");
  } else {
    download(quoteAuditToCsv(bundle), `${bundle.missionRef}-pricing-audit.csv`, "text/csv;charset=utf-8");
  }
  return bundle;
}
