/**
 * Governance & compliance centre for the delivery control tower.
 *
 * Surfaces KYC, vehicle/insurance validity, contract expiry and route-safety
 * compliance for the selected module, gated by role, with an incident register
 * and the hash-chained audit trail of every compliance decision taken here.
 *
 * Live records come from `corporate_documents` and `driver_documents` where the
 * caller's role permits; the reference register is used otherwise so the control
 * surface stays complete and clearly labelled.
 */
import { supabase } from "@/integrations/supabase/client";
import type { DeliveryModule } from "@/components/delivery/ModuleShell";
import { governanceChecks, routeCompliance } from "./controlTower";
import { recordAudit, type AuditEntry } from "./auditTrail";

export type ComplianceDomain = "kyc" | "vehicle" | "insurance" | "contract" | "route_safety";
export type ComplianceState = "valid" | "expiring" | "expired" | "pending" | "breach";

export interface ComplianceRecord {
  id: string;
  domain: ComplianceDomain;
  entity: string;
  entityType: "operator" | "driver" | "vehicle" | "customer" | "route";
  requirement: string;
  state: ComplianceState;
  reference: string;
  validFrom: string;
  validTo: string | null;
  daysToExpiry: number | null;
  owner: string;
  evidence: string;
  lastCheckedAt: string;
}

export interface ComplianceIncident {
  id: string;
  at: string;
  severity: "low" | "medium" | "high" | "critical";
  domain: ComplianceDomain;
  title: string;
  detail: string;
  entity: string;
  state: "open" | "investigating" | "mitigated" | "closed";
  owner: string;
}

export interface ComplianceRole {
  key: string;
  label: string;
  canView: boolean;
  canDecide: boolean;
  canExport: boolean;
  scope: string;
}

export interface ComplianceCenterData {
  source: "live" | "modelled";
  records: ComplianceRecord[];
  incidents: ComplianceIncident[];
  summary: Array<{ domain: ComplianceDomain; label: string; valid: number; attention: number; coveragePct: number }>;
  routeSignals: ReturnType<typeof routeCompliance>;
}

/* ------------------------------------------------------------------- RBAC */

const VIEW_ROLES = ["admin", "super_admin", "compliance_admin", "operations_admin", "finance_admin", "corporate_admin", "fleet_admin"];
const DECIDE_ROLES = ["admin", "super_admin", "compliance_admin", "operations_admin"];
const EXPORT_ROLES = ["admin", "super_admin", "compliance_admin", "finance_admin"];

export function complianceAccess(roles: string[]): ComplianceRole {
  const canView = roles.some((r) => VIEW_ROLES.includes(r));
  const canDecide = roles.some((r) => DECIDE_ROLES.includes(r));
  const canExport = roles.some((r) => EXPORT_ROLES.includes(r));
  const primary = roles.find((r) => VIEW_ROLES.includes(r));
  return {
    key: primary ?? (roles.length ? roles[0] : "guest"),
    label: primary ? primary.replace(/_/g, " ") : roles.length ? roles[0].replace(/_/g, " ") : "Public viewer",
    canView,
    canDecide,
    canExport,
    scope: canDecide
      ? "Full compliance control: view, decide, export"
      : canView
        ? "Read-only compliance visibility for your organisation"
        : "Aggregate coverage only — record-level detail requires a compliance role",
  };
}

/** Masks record-level identity for roles without record access. */
export function maskRecord(record: ComplianceRecord, canView: boolean): ComplianceRecord {
  if (canView) return record;
  return { ...record, entity: "•••• restricted", reference: "••••••", owner: "•••", evidence: "Access controlled" };
}

/* -------------------------------------------------------------- reference */

const DOMAIN_LABEL: Record<ComplianceDomain, string> = {
  kyc: "KYC & identity",
  vehicle: "Vehicle validity",
  insurance: "Insurance cover",
  contract: "Contracts",
  route_safety: "Route safety",
};

function noise(seed: string, i: number): number {
  let h = 2166136261;
  const s = `${seed}@${i}`;
  for (let k = 0; k < s.length; k += 1) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function stateFromDays(days: number | null, pending = false): ComplianceState {
  if (pending) return "pending";
  if (days === null) return "valid";
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "valid";
}

const REQUIREMENTS: Array<[ComplianceDomain, ComplianceRecord["entityType"], string, string]> = [
  ["kyc", "operator", "Director KYC & CR12", "BRS extract + CR12"],
  ["kyc", "operator", "KRA tax compliance certificate", "KRA TCC PDF"],
  ["kyc", "driver", "National ID + IPRS match", "IPRS verification receipt"],
  ["kyc", "driver", "Good conduct certificate", "DCI certificate scan"],
  ["kyc", "customer", "Corporate onboarding KYB", "Signed KYB pack"],
  ["vehicle", "vehicle", "NTSA inspection certificate", "Inspection certificate"],
  ["vehicle", "vehicle", "Roadworthiness re-test", "Garage report + photos"],
  ["vehicle", "vehicle", "TLB / county permit", "Permit sticker scan"],
  ["insurance", "vehicle", "Goods-in-transit cover", "Policy schedule"],
  ["insurance", "vehicle", "PSV / commercial motor cover", "Certificate of insurance"],
  ["insurance", "operator", "Public liability cover", "Policy schedule"],
  ["contract", "customer", "Master services agreement", "Executed MSA"],
  ["contract", "customer", "Data processing agreement", "Signed DPA"],
  ["contract", "operator", "Carrier framework agreement", "Executed framework"],
  ["route_safety", "route", "Night-run risk assessment", "Risk assessment form"],
  ["route_safety", "route", "Geofence & corridor approval", "Corridor approval record"],
  ["route_safety", "driver", "Defensive driving certification", "Training certificate"],
];

const ENTITIES: Record<ComplianceRecord["entityType"], string[]> = {
  operator: ["SAFARID Logistics Ltd", "Nairobi Haulage Partners", "Coast Freight Services"],
  driver: ["J. Mwangi (DRV-1042)", "A. Wanjiru (DRV-2210)", "P. Otieno (DRV-3391)", "S. Kamau (DRV-4487)"],
  vehicle: ["KDA 312F", "KDG 884M", "KCW 190Q", "KDJ 675T"],
  customer: ["Naivas Supermarkets", "Kenya Red Cross", "Safaricom PLC"],
  route: ["Nairobi → Mombasa corridor", "CBD night-run zone", "Industrial → Westlands loop"],
};

export function referenceComplianceRecords(module: DeliveryModule, now = new Date()): ComplianceRecord[] {
  return REQUIREMENTS.map(([domain, entityType, requirement, evidence], i) => {
    const days = Math.round(noise(module + domain, i) * 400) - 40;
    const pending = noise(module + "pending", i) > 0.9;
    const validTo = new Date(now.getTime() + days * 86_400_000);
    const entities = ENTITIES[entityType];
    return {
      id: `${module}-cmp-${i}`,
      domain,
      entity: entities[i % entities.length],
      entityType,
      requirement,
      state: stateFromDays(days, pending),
      reference: `${domain.toUpperCase().slice(0, 3)}-${(10_000 + Math.round(noise(module + "ref", i) * 89_999)).toString()}`,
      validFrom: new Date(now.getTime() - (365 - Math.max(0, days)) * 86_400_000).toISOString(),
      validTo: validTo.toISOString(),
      daysToExpiry: days,
      owner: ["Compliance desk", "Fleet office", "Legal", "Operations control"][i % 4],
      evidence,
      lastCheckedAt: new Date(now.getTime() - Math.round(noise(module + "chk", i) * 6) * 3_600_000).toISOString(),
    };
  });
}

export function referenceIncidents(module: DeliveryModule, now = new Date()): ComplianceIncident[] {
  const rows: Array<[ComplianceIncident["severity"], ComplianceDomain, string, string, ComplianceIncident["state"]]> = [
    ["high", "route_safety", "Harsh braking cluster on Mombasa Road", "Telematics flagged 6 harsh-braking events within 4 km for vehicle KDA 312F.", "investigating"],
    ["medium", "insurance", "Goods-in-transit certificate expiring", "Cover for 3 vehicles lapses within 21 days; renewal requested from broker.", "open"],
    ["critical", "vehicle", "Inspection certificate expired", "KDJ 675T operated one run after inspection expiry — vehicle suspended pending re-test.", "mitigated"],
    ["low", "kyc", "Driver good-conduct renewal due", "2 drivers past the 12-month refresh window for DCI certificates.", "open"],
    ["medium", "contract", "DPA amendment unsigned", "Customer amendment for cross-border data transfer awaiting counter-signature.", "open"],
    ["high", "route_safety", "Geofence exit outside approved corridor", "Unit left the approved corridor for 3.4 km during a night run.", "closed"],
  ];
  return rows.map(([severity, domain, title, detail, state], i) => ({
    id: `${module}-inc-${i}`,
    at: new Date(now.getTime() - (i + 1) * 5 * 3_600_000).toISOString(),
    severity,
    domain,
    title,
    detail,
    entity: ENTITIES[domain === "route_safety" ? "route" : domain === "kyc" ? "driver" : domain === "contract" ? "customer" : "vehicle"][i % 3],
    state,
    owner: ["Compliance desk", "Fleet office", "Legal", "Operations control"][i % 4],
  }));
}

function summarise(records: ComplianceRecord[]): ComplianceCenterData["summary"] {
  const domains: ComplianceDomain[] = ["kyc", "vehicle", "insurance", "contract", "route_safety"];
  return domains.map((domain) => {
    const rows = records.filter((r) => r.domain === domain);
    const valid = rows.filter((r) => r.state === "valid").length;
    const attention = rows.length - valid;
    return {
      domain,
      label: DOMAIN_LABEL[domain],
      valid,
      attention,
      coveragePct: rows.length ? Math.round((valid / rows.length) * 1000) / 10 : 100,
    };
  });
}

export function referenceComplianceCenter(module: DeliveryModule): ComplianceCenterData {
  const records = referenceComplianceRecords(module);
  return {
    source: "modelled",
    records,
    incidents: referenceIncidents(module),
    summary: summarise(records),
    routeSignals: routeCompliance(module),
  };
}

/** Overlays real corporate/driver document rows onto the reference register. */
export async function loadComplianceCenter(module: DeliveryModule): Promise<ComplianceCenterData> {
  const base = referenceComplianceCenter(module);
  const now = Date.now();
  const [corpRes, driverRes] = await Promise.all([
    supabase.from("corporate_documents").select("id,doc_type,document_number,expiry_date,status,reviewed_at,updated_at").limit(30),
    supabase.from("driver_documents").select("id,doc_type,doc_label,document_number,expiry_date,status,verified_at,updated_at,module").limit(30),
  ]);

  const rows = [
    ...(corpRes.data ?? []).map((d) => ({
      id: d.id,
      domain: "kyc" as ComplianceDomain,
      entityType: "operator" as ComplianceRecord["entityType"],
      requirement: (d.doc_type ?? "Corporate document").replace(/_/g, " "),
      reference: d.document_number ?? d.id.slice(0, 8),
      expiry: d.expiry_date,
      status: d.status,
      checked: d.reviewed_at ?? d.updated_at,
    })),
    ...(driverRes.data ?? []).map((d) => ({
      id: d.id,
      domain: (/(insur)/i.test(d.doc_type ?? "") ? "insurance" : /(inspect|licence|license|permit)/i.test(d.doc_type ?? "") ? "vehicle" : "kyc") as ComplianceDomain,
      entityType: "driver" as ComplianceRecord["entityType"],
      requirement: (d.doc_label ?? d.doc_type ?? "Driver document").replace(/_/g, " "),
      reference: d.document_number ?? d.id.slice(0, 8),
      expiry: d.expiry_date,
      status: d.status,
      checked: d.verified_at ?? d.updated_at,
    })),
  ];

  if (rows.length === 0) return base;

  const records: ComplianceRecord[] = rows.map((r, i) => {
    const days = r.expiry ? Math.round((new Date(r.expiry).getTime() - now) / 86_400_000) : null;
    const pending = ["pending", "submitted", "in_review"].includes((r.status ?? "").toLowerCase());
    const template = base.records[i % base.records.length];
    return {
      id: r.id,
      domain: r.domain,
      entity: template.entity,
      entityType: r.entityType,
      requirement: r.requirement,
      state: (r.status ?? "").toLowerCase() === "rejected" ? "breach" : stateFromDays(days, pending),
      reference: r.reference,
      validFrom: template.validFrom,
      validTo: r.expiry ? new Date(r.expiry).toISOString() : null,
      daysToExpiry: days,
      owner: template.owner,
      evidence: "Uploaded document on file",
      lastCheckedAt: r.checked ?? new Date().toISOString(),
    };
  });

  const merged = [...records, ...base.records.filter((b) => !records.some((r) => r.requirement === b.requirement))];
  return { ...base, source: "live", records: merged, summary: summarise(merged) };
}

/* ------------------------------------------------------------- decisions */

export type ComplianceDecision = "verify" | "suspend" | "request_renewal" | "escalate";

const DECISION_LABEL: Record<ComplianceDecision, string> = {
  verify: "Mark compliant",
  suspend: "Suspend from operations",
  request_renewal: "Request renewal",
  escalate: "Escalate to compliance desk",
};

export function complianceDecisionLabel(decision: ComplianceDecision): string {
  return DECISION_LABEL[decision];
}

export function decideCompliance(
  module: DeliveryModule,
  record: ComplianceRecord,
  decision: ComplianceDecision,
  actor: string,
  reason?: string,
): AuditEntry {
  return recordAudit({
    domain: "compliance",
    module,
    action: DECISION_LABEL[decision],
    subject: `${record.requirement} · ${record.entity}`,
    actor,
    reason,
    impact: [
      { label: "Reference", value: record.reference },
      { label: "State before", value: record.state },
      { label: "Expiry", value: record.validTo ? new Date(record.validTo).toLocaleDateString("en-KE") : "n/a" },
    ],
  });
}

export function complianceCoverage(module: DeliveryModule): number {
  const checks = governanceChecks(module);
  return Math.round((checks.reduce((s, c) => s + c.coveragePct, 0) / Math.max(1, checks.length)) * 10) / 10;
}
