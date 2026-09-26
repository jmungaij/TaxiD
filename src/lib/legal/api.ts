/**
 * Legal control plane — data access.
 *
 * Every read is RLS-scoped to `staff.legal.read`; every write to
 * `staff.legal.manage`. Nothing here fabricates a legal conclusion: rows are
 * returned exactly as recorded, and mapping only normalises shapes.
 */
import { supabase } from "@/integrations/supabase/client";
import type { GoodsRule } from "./goods";
import type { ProtectionPolicy } from "./protection";
import { summariseLegalReadiness, type LegalDomainInput, type LegalReadinessSummary } from "./readiness";
import type {
  LegalExpiryBand,
  LegalGateStage,
  LegalInstrumentState,
  LegalRequirement,
  LegalReviewOutcome,
  LegalStatus,
} from "./types";

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** Requirement register (§3). */
export async function fetchLegalRequirements(): Promise<LegalRequirement[]> {
  const { data, error } = await supabase
    .from("legal_requirements")
    .select(
      "code,title,description,requirement_type,applies_to,service_families,partner_types,asset_types,goods_classes,geographies,mandatory,verification_method,evidence_type,failure_action,blocking_stages,owner_role,status,effective_from,effective_until,legal_jurisdictions(code),legal_regulators(code)",
    )
    .order("code");
  if (error) throw error;
  return (data ?? []).map((r: Row) => ({
    code: String(r.code),
    title: String(r.title),
    jurisdiction: (r.legal_jurisdictions as Row | null)?.code as string ?? "KE",
    regulator: ((r.legal_regulators as Row | null)?.code as string) ?? null,
    requirementType: String(r.requirement_type),
    appliesTo: String(r.applies_to),
    serviceFamilies: arr(r.service_families),
    partnerTypes: arr(r.partner_types),
    assetTypes: arr(r.asset_types),
    goodsClasses: arr(r.goods_classes) as LegalRequirement["goodsClasses"],
    geographies: arr(r.geographies),
    mandatory: Boolean(r.mandatory),
    verificationMethod: str(r.verification_method),
    evidenceType: str(r.evidence_type),
    failureAction: String(r.failure_action) as LegalRequirement["failureAction"],
    blockingStages: arr(r.blocking_stages) as LegalGateStage[],
    ownerRole: str(r.owner_role),
    status: String(r.status) as LegalStatus,
    effectiveFrom: str(r.effective_from),
    effectiveUntil: str(r.effective_until),
  }));
}

export interface LegalInstrumentRow extends LegalInstrumentState {
  id: string;
  label: string;
  holderName: string | null;
  documentPath: string | null;
  notes?: string | null;
}

async function fetchInstrumentTable(
  table: "legal_licences" | "legal_permits" | "legal_certifications",
  labelColumn: string,
  numberColumn: string,
  kind: LegalInstrumentState["kind"],
): Promise<LegalInstrumentRow[]> {
  // The column list is composed per instrument family, so the generated
  // literal-type parser cannot resolve it statically.
  const { data, error } = await (supabase.from(table) as never as {
    select: (cols: string) => {
      order: (col: string, opts: { ascending: boolean; nullsFirst: boolean }) => Promise<{ data: Row[] | null; error: unknown }>;
    };
  })
    .select(
      `id,${labelColumn},${numberColumn},holder_type,holder_id,holder_name,issuer,issue_date,effective_from,effective_until,document_path,verification_status,status,legal_requirements(code)`,
    )
    .order("effective_until", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((r: Row) => ({

    id: String(r.id),
    kind,
    label: String(r[labelColumn] ?? kind),
    reference: str(r[numberColumn]),
    requirementCode: ((r.legal_requirements as Row | null)?.code as string) ?? "",
    holderType: str(r.holder_type),
    holderId: str(r.holder_id),
    holderName: str(r.holder_name),
    documentPath: str(r.document_path),
    verification: (str(r.verification_status) ?? "pending") as LegalReviewOutcome,
    effectiveFrom: str(r.effective_from),
    effectiveUntil: str(r.effective_until),
    status: String(r.status) as LegalStatus,
  }));
}

export const fetchLegalLicences = () => fetchInstrumentTable("legal_licences", "licence_type", "licence_number", "licence");
export const fetchLegalPermits = () => fetchInstrumentTable("legal_permits", "permit_type", "permit_number", "permit");
export const fetchLegalCertifications = () =>
  fetchInstrumentTable("legal_certifications", "certification_type", "certificate_number", "certification");

export async function fetchGoodsRules(): Promise<(GoodsRule & { id: string })[]> {
  const { data, error } = await supabase
    .from("legal_goods_rules")
    .select("id,code,goods_category,goods_class,service_families,conditions,required_evidence,max_declared_value,keywords,legal_basis,failure_action,notes,status")
    .order("goods_category");
  if (error) throw error;
  return (data ?? []).map((r: Row) => ({
    id: String(r.id),
    code: String(r.code),
    goodsCategory: String(r.goods_category),
    goodsClass: String(r.goods_class) as GoodsRule["goodsClass"],
    serviceFamilies: arr(r.service_families),
    conditions: arr(r.conditions),
    requiredEvidence: arr(r.required_evidence),
    maxDeclaredValue: num(r.max_declared_value),
    keywords: arr(r.keywords),
    legalBasis: str(r.legal_basis),
    status: String(r.status) as LegalStatus,
  }));
}

export async function fetchProtectionPolicies(): Promise<ProtectionPolicy[]> {
  const { data, error } = await supabase
    .from("legal_protection_policies")
    .select("id,policy_reference,provider,policy_number,insured_entity,coverage_type,territory,limit_amount,limit_currency,per_consignment_limit,deductible,effective_from,effective_until,covered_goods,exclusions,verification_status,status")
    .order("effective_until", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((r: Row) => ({
    id: String(r.id),
    policyReference: String(r.policy_reference),
    provider: String(r.provider),
    policyNumber: str(r.policy_number),
    insuredEntity: String(r.insured_entity),
    coverageType: String(r.coverage_type),
    territory: str(r.territory),
    limitAmount: num(r.limit_amount),
    limitCurrency: String(r.limit_currency ?? "KES"),
    perConsignmentLimit: num(r.per_consignment_limit),
    deductible: num(r.deductible),
    effectiveFrom: str(r.effective_from),
    effectiveUntil: str(r.effective_until),
    coveredGoods: arr(r.covered_goods),
    exclusions: arr(r.exclusions),
    verificationStatus: (str(r.verification_status) ?? "pending") as LegalReviewOutcome,
    status: String(r.status) as LegalStatus,
  }));
}

export interface ExpiryRow {
  instrumentKind: string;
  instrumentId: string;
  label: string;
  holder: string | null;
  effectiveUntil: string | null;
  daysRemaining: number | null;
  band: LegalExpiryBand;
  lifecycle: LegalStatus;
}

export async function fetchExpiryHorizon(): Promise<ExpiryRow[]> {
  const { data, error } = await supabase.rpc("legal_expiry_horizon");
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) => ({
    instrumentKind: String(r.instrument_kind),
    instrumentId: String(r.instrument_id),
    label: String(r.label ?? ""),
    holder: str(r.holder),
    effectiveUntil: str(r.effective_until),
    daysRemaining: num(r.days_remaining),
    band: String(r.band) as LegalExpiryBand,
    lifecycle: String(r.lifecycle) as LegalStatus,
  }));
}

/** Raw counters from the database, converted into the readiness matrix. */
export async function fetchLegalReadiness(): Promise<{ summary: LegalReadinessSummary; raw: Row }> {
  const { data, error } = await supabase.rpc("legal_readiness_matrix");
  if (error) throw error;
  const raw = (data ?? {}) as Row;
  const g = (key: string, field: string): number => Number(((raw[key] as Row | undefined)?.[field] as number) ?? 0);

  const inputs: LegalDomainInput[] = [
    { key: "licensing", applicable: g("licensing", "total"), satisfied: g("licensing", "active"), awaitingEvidence: Math.max(0, g("licensing", "total") - g("licensing", "active")) },
    {
      key: "partner_compliance",
      applicable: g("requirements", "total"),
      satisfied: g("requirements", "active"),
      awaitingReview: g("requirements", "review_required"),
      awaitingEvidence: g("requirements", "evidence_required"),
    },
    { key: "goods", applicable: g("goods", "total"), satisfied: g("goods", "classified"), awaitingReview: Math.max(0, g("goods", "total") - g("goods", "classified")) },
    { key: "contracts", applicable: g("contracts", "total"), satisfied: g("contracts", "active"), awaitingApproval: Math.max(0, g("contracts", "total") - g("contracts", "active")) },
    { key: "data_protection", applicable: g("privacy", "total"), satisfied: g("privacy", "active"), awaitingReview: Math.max(0, g("privacy", "total") - g("privacy", "active")) },
    { key: "tax_etims", applicable: 1, satisfied: 0, awaitingEvidence: 1 },
    { key: "protection", applicable: g("protection", "total"), satisfied: g("protection", "active"), awaitingEvidence: Math.max(0, g("protection", "total") - g("protection", "active")) },
    { key: "claims", applicable: g("policies", "total"), satisfied: g("policies", "active"), awaitingApproval: Math.max(0, g("policies", "total") - g("policies", "active")) },
  ];

  return {
    summary: summariseLegalReadiness(inputs, {
      openReviews: Number(raw.open_reviews ?? 0),
      openIncidents: Number(raw.open_incidents ?? 0),
      generatedAt: String(raw.generated_at ?? new Date().toISOString()),
    }),
    raw,
  };
}

export interface LegalReviewRow {
  id: string;
  subjectType: string;
  question: string;
  outcome: LegalReviewOutcome;
  assignedRole: string | null;
  dueAt: string | null;
  determination: string | null;
  createdAt: string;
}

export async function fetchLegalReviews(): Promise<LegalReviewRow[]> {
  const { data, error } = await supabase
    .from("legal_reviews")
    .select("id,subject_type,question,outcome,assigned_role,due_at,determination,created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((r: Row) => ({
    id: String(r.id),
    subjectType: String(r.subject_type),
    question: String(r.question),
    outcome: String(r.outcome) as LegalReviewOutcome,
    assignedRole: str(r.assigned_role),
    dueAt: str(r.due_at),
    determination: str(r.determination),
    createdAt: String(r.created_at),
  }));
}

export interface LegalIncidentRow {
  id: string;
  incidentCode: string;
  category: string;
  severity: string;
  title: string;
  ownerRole: string | null;
  deadlineAt: string | null;
  status: LegalStatus;
  resolvedAt: string | null;
  createdAt: string;
}

export async function fetchLegalIncidents(): Promise<LegalIncidentRow[]> {
  const { data, error } = await supabase
    .from("legal_incidents")
    .select("id,incident_code,category,severity,title,owner_role,deadline_at,status,resolved_at,created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((r: Row) => ({
    id: String(r.id),
    incidentCode: String(r.incident_code),
    category: String(r.category),
    severity: String(r.severity),
    title: String(r.title),
    ownerRole: str(r.owner_role),
    deadlineAt: str(r.deadline_at),
    status: String(r.status) as LegalStatus,
    resolvedAt: str(r.resolved_at),
    createdAt: String(r.created_at),
  }));
}

export interface LegalEventRow {
  id: string;
  eventType: string;
  subjectType: string;
  subjectRef: string | null;
  requirementCode: string | null;
  gateStage: LegalGateStage | null;
  decision: string;
  reasonCode: string | null;
  shadowMode: boolean;
  createdAt: string;
}

export async function fetchLegalEvents(limit = 100): Promise<LegalEventRow[]> {
  const { data, error } = await supabase
    .from("legal_compliance_events")
    .select("id,event_type,subject_type,subject_ref,requirement_code,gate_stage,decision,reason_code,shadow_mode,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r: Row) => ({
    id: String(r.id),
    eventType: String(r.event_type),
    subjectType: String(r.subject_type),
    subjectRef: str(r.subject_ref),
    requirementCode: str(r.requirement_code),
    gateStage: (str(r.gate_stage) as LegalGateStage | null) ?? null,
    decision: String(r.decision),
    reasonCode: str(r.reason_code),
    shadowMode: Boolean(r.shadow_mode),
    createdAt: String(r.created_at),
  }));
}

export interface LegalProcessingRow {
  id: string;
  code: string;
  activity: string;
  dataController: string;
  processingPurpose: string;
  lawfulBasis: string;
  dataCategories: string[];
  retentionPeriodDays: number | null;
  crossBorderTransfer: boolean;
  status: LegalStatus;
}

export async function fetchProcessingRegister(): Promise<LegalProcessingRow[]> {
  const { data, error } = await supabase
    .from("legal_data_processing_records")
    .select("id,code,activity,data_controller,processing_purpose,lawful_basis,data_categories,retention_period_days,cross_border_transfer,status")
    .order("code");
  if (error) throw error;
  return (data ?? []).map((r: Row) => ({
    id: String(r.id),
    code: String(r.code),
    activity: String(r.activity),
    dataController: String(r.data_controller),
    processingPurpose: String(r.processing_purpose),
    lawfulBasis: String(r.lawful_basis),
    dataCategories: arr(r.data_categories),
    retentionPeriodDays: num(r.retention_period_days),
    crossBorderTransfer: Boolean(r.cross_border_transfer),
    status: String(r.status) as LegalStatus,
  }));
}

export interface LegalContractRow {
  id: string;
  contractCode: string;
  version: string;
  title: string;
  contractType: string;
  counterpartyType: string;
  counterpartyName: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  status: LegalStatus;
}

export async function fetchLegalContracts(): Promise<LegalContractRow[]> {
  const { data, error } = await supabase
    .from("legal_contracts")
    .select("id,contract_code,version,title,contract_type,counterparty_type,counterparty_name,effective_from,effective_until,status")
    .order("contract_code");
  if (error) throw error;
  return (data ?? []).map((r: Row) => ({
    id: String(r.id),
    contractCode: String(r.contract_code),
    version: String(r.version),
    title: String(r.title),
    contractType: String(r.contract_type),
    counterpartyType: String(r.counterparty_type),
    counterpartyName: str(r.counterparty_name),
    effectiveFrom: str(r.effective_from),
    effectiveUntil: str(r.effective_until),
    status: String(r.status) as LegalStatus,
  }));
}

/** Owner configuration writes — one entry point per instrument family. */
export async function upsertLegalRecord(
  table:
    | "legal_licences"
    | "legal_permits"
    | "legal_certifications"
    | "legal_policies"
    | "legal_contracts"
    | "legal_protection_policies"
    | "legal_goods_rules"
    | "legal_data_processing_records"
    | "legal_requirements"
    | "legal_incidents"
    | "legal_obligations",
  values: Record<string, unknown>,
  id?: string,
): Promise<string> {
  // Values are validated by the admin forms and by database constraints; the
  // union of generated row types cannot be narrowed from a dynamic table name.
  const payload = values as never;
  if (id) {
    const { error } = await supabase.from(table).update(payload).eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await supabase.from(table).insert(payload).select("id").single();
  if (error) throw error;
  return String((data as Row).id);
}


/** Raise a legal review — the only path for an unresolved legal question. */
export async function raiseLegalReview(input: {
  subjectType: string;
  subjectId?: string | null;
  requirementId?: string | null;
  question: string;
  assignedRole?: string | null;
  dueAt?: string | null;
  context?: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await supabase
    .from("legal_reviews")
    .insert({
      subject_type: input.subjectType,
      subject_id: input.subjectId ?? null,
      requirement_id: input.requirementId ?? null,
      question: input.question,
      assigned_role: input.assignedRole ?? "compliance_admin",
      due_at: input.dueAt ?? null,
      context: (input.context ?? {}) as never,
      outcome: "legal_review_required",
    })
    .select("id")
    .single();
  if (error) throw error;
  return String((data as Row).id);
}
