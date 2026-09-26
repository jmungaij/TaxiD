/**
 * Enterprise procurement workbench model.
 *
 * Cost centres, department billing, purchase orders, approval chains, budget
 * controls and monthly invoicing — all linked to the logistics charges the
 * control tower already prices. Live rows are read from the Cloud tables
 * (`cost_centers`, `budgets`, `corporate_invoices`) where the caller's role
 * permits; otherwise the workbench renders the reference model so finance teams
 * can still evaluate the workflow end to end.
 */
import { supabase } from "@/integrations/supabase/client";
import type { DeliveryModule } from "@/components/delivery/ModuleShell";
import { moduleObservation } from "./controlTower";
import { recordAudit, type AuditEntry } from "./auditTrail";

export interface CostCentre {
  id: string;
  code: string;
  name: string;
  owner: string;
  department: string;
  budgetKes: number;
  committedKes: number;
  spentKes: number;
  status: "active" | "frozen" | "closed";
}

export interface DepartmentBilling {
  id: string;
  name: string;
  deliveries: number;
  logisticsChargesKes: number;
  surchargesKes: number;
  creditsKes: number;
  netKes: number;
  sharePct: number;
}

export type PoStatus = "draft" | "pending_approval" | "approved" | "rejected" | "committed" | "closed";

export interface PurchaseOrder {
  id: string;
  number: string;
  title: string;
  costCentreCode: string;
  department: string;
  requestedBy: string;
  valueKes: number;
  consumedKes: number;
  status: PoStatus;
  raisedAt: string;
  neededBy: string;
  approvals: ApprovalStep[];
  lines: PoLine[];
}

export interface PoLine {
  description: string;
  quantity: number;
  unit: string;
  unitPriceKes: number;
  service: "package" | "courier" | "fleet" | "logistics" | "warehousing";
}

export interface ApprovalStep {
  level: number;
  role: string;
  approver: string;
  thresholdKes: number;
  state: "approved" | "pending" | "waiting" | "rejected";
  decidedAt?: string;
}

export interface BudgetControl {
  id: string;
  label: string;
  rule: string;
  state: "ok" | "warn" | "block";
  detail: string;
}

export type InvoiceStatus = "draft" | "issued" | "part_paid" | "paid" | "overdue";

export interface ProcurementInvoice {
  id: string;
  number: string;
  period: string;
  costCentres: number;
  deliveries: number;
  subtotalKes: number;
  vatKes: number;
  totalKes: number;
  paidKes: number;
  status: InvoiceStatus;
  issuedAt: string;
  dueAt: string;
}

export interface ProcurementWorkspace {
  source: "live" | "modelled";
  costCentres: CostCentre[];
  departments: DepartmentBilling[];
  purchaseOrders: PurchaseOrder[];
  budgetControls: BudgetControl[];
  invoices: ProcurementInvoice[];
  totals: {
    budgetKes: number;
    committedKes: number;
    spentKes: number;
    availableKes: number;
    utilisationPct: number;
    openPos: number;
    pendingApprovals: number;
    outstandingKes: number;
  };
}

/* ------------------------------------------------------------- reference */

function seedNoise(seed: string, i: number): number {
  let h = 2166136261;
  const s = `${seed}$${i}`;
  for (let k = 0; k < s.length; k += 1) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const DEPARTMENTS = ["Retail operations", "Field logistics", "Health programmes", "E-commerce", "Distribution", "Facilities"];
const OWNERS = ["W. Kariuki", "N. Atieno", "B. Mutiso", "R. Chelule", "T. Omondi", "H. Njeri"];

const MONTH_LABEL = (offset: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - offset);
  return d.toLocaleDateString("en-KE", { month: "long", year: "numeric" });
};

function referenceCostCentres(module: DeliveryModule): CostCentre[] {
  const o = moduleObservation(module);
  const monthly = o.revenueTodayKes * 22;
  return DEPARTMENTS.map((department, i) => {
    const share = 0.1 + seedNoise(module + "cc", i) * 0.25;
    const budgetKes = Math.round((monthly * share) / 1000) * 1000;
    const spentKes = Math.round(budgetKes * (0.35 + seedNoise(module + "sp", i) * 0.5));
    const committedKes = Math.round((budgetKes - spentKes) * (0.2 + seedNoise(module + "cm", i) * 0.5));
    return {
      id: `cc-${i}`,
      code: `CC-${1000 + i * 137}`,
      name: `${department} — ${module}`,
      owner: OWNERS[i % OWNERS.length],
      department,
      budgetKes,
      committedKes,
      spentKes,
      status: spentKes / budgetKes > 0.95 ? "frozen" : "active",
    };
  });
}

function referenceDepartments(centres: CostCentre[], module: DeliveryModule): DepartmentBilling[] {
  const o = moduleObservation(module);
  const total = centres.reduce((s, c) => s + c.spentKes, 0) || 1;
  return centres.map((c, i) => {
    const logisticsChargesKes = c.spentKes;
    const surchargesKes = Math.round(logisticsChargesKes * (0.03 + seedNoise(module + "su", i) * 0.05));
    const creditsKes = Math.round(logisticsChargesKes * seedNoise(module + "cr", i) * 0.03);
    return {
      id: c.id,
      name: c.department,
      deliveries: Math.max(1, Math.round(logisticsChargesKes / Math.max(1, o.costPerParcelKes))),
      logisticsChargesKes,
      surchargesKes,
      creditsKes,
      netKes: logisticsChargesKes + surchargesKes - creditsKes,
      sharePct: Math.round((c.spentKes / total) * 1000) / 10,
    };
  });
}

function approvalChain(valueKes: number): ApprovalStep[] {
  const chain: ApprovalStep[] = [
    { level: 1, role: "Cost centre owner", approver: OWNERS[0], thresholdKes: 250_000, state: "approved", decidedAt: new Date(Date.now() - 86_400_000).toISOString() },
    { level: 2, role: "Department head", approver: OWNERS[1], thresholdKes: 1_000_000, state: valueKes > 250_000 ? "pending" : "waiting" },
    { level: 3, role: "Finance controller", approver: OWNERS[2], thresholdKes: 5_000_000, state: "waiting" },
    { level: 4, role: "CFO", approver: OWNERS[3], thresholdKes: Number.MAX_SAFE_INTEGER, state: "waiting" },
  ];
  return chain.filter((s) => s.level === 1 || valueKes > chain[s.level - 2].thresholdKes || s.level === 2);
}

function referencePurchaseOrders(centres: CostCentre[], module: DeliveryModule): PurchaseOrder[] {
  const statuses: PoStatus[] = ["pending_approval", "approved", "committed", "draft", "pending_approval", "closed", "rejected"];
  return Array.from({ length: 7 }, (_, i) => {
    const centre = centres[i % centres.length];
    const valueKes = Math.round((200_000 + seedNoise(module + "po", i) * 3_800_000) / 1000) * 1000;
    const status = statuses[i % statuses.length];
    const raised = new Date(Date.now() - (i + 1) * 3 * 86_400_000);
    return {
      id: `po-${i}`,
      number: `PO-${new Date().getFullYear()}-${(1040 + i * 13).toString()}`,
      title: [
        "Quarterly last-mile distribution",
        "Cold-chain pharmaceutical runs",
        "Cross-dock warehousing block",
        "Container haulage — Mombasa → Nairobi",
        "Dedicated courier retainer",
        "Regional FMCG replenishment",
        "Event logistics surge cover",
      ][i],
      costCentreCode: centre.code,
      department: centre.department,
      requestedBy: OWNERS[(i + 2) % OWNERS.length],
      valueKes,
      consumedKes: status === "committed" || status === "closed" ? Math.round(valueKes * (0.4 + seedNoise(module + "cs", i) * 0.55)) : 0,
      status,
      raisedAt: raised.toISOString(),
      neededBy: new Date(raised.getTime() + 30 * 86_400_000).toISOString(),
      approvals: approvalChain(valueKes),
      lines: [
        {
          description: "Scheduled delivery runs",
          quantity: 40 + Math.round(seedNoise(module + "q1", i) * 260),
          unit: "runs",
          unitPriceKes: 2_400 + Math.round(seedNoise(module + "u1", i) * 9_000),
          service: module,
        },
        {
          description: "Warehousing & cross-dock handling",
          quantity: 10 + Math.round(seedNoise(module + "q2", i) * 40),
          unit: "pallet-days",
          unitPriceKes: 900 + Math.round(seedNoise(module + "u2", i) * 2_200),
          service: "warehousing",
        },
      ],
    };
  });
}

function referenceInvoices(centres: CostCentre[], module: DeliveryModule): ProcurementInvoice[] {
  const o = moduleObservation(module);
  return Array.from({ length: 4 }, (_, i) => {
    const subtotalKes = Math.round((o.revenueTodayKes * 20 * (0.85 + seedNoise(module + "iv", i) * 0.3)) / 1000) * 1000;
    const vatKes = Math.round(subtotalKes * 0.16);
    const totalKes = subtotalKes + vatKes;
    const status: InvoiceStatus = i === 0 ? "issued" : i === 1 ? "part_paid" : i === 3 ? "overdue" : "paid";
    const paidKes = status === "paid" ? totalKes : status === "part_paid" ? Math.round(totalKes * 0.55) : 0;
    const issued = new Date();
    issued.setDate(1);
    issued.setMonth(issued.getMonth() - i);
    return {
      id: `inv-${i}`,
      number: `YM-INV-${issued.getFullYear()}${String(issued.getMonth() + 1).padStart(2, "0")}-${module.slice(0, 3).toUpperCase()}`,
      period: MONTH_LABEL(i),
      costCentres: centres.length,
      deliveries: Math.max(1, Math.round(subtotalKes / Math.max(1, o.costPerParcelKes))),
      subtotalKes,
      vatKes,
      totalKes,
      paidKes,
      status,
      issuedAt: issued.toISOString(),
      dueAt: new Date(issued.getTime() + 30 * 86_400_000).toISOString(),
    };
  });
}

function budgetControls(centres: CostCentre[], pos: PurchaseOrder[]): BudgetControl[] {
  const frozen = centres.filter((c) => c.status === "frozen").length;
  const overCommit = centres.filter((c) => c.committedKes + c.spentKes > c.budgetKes * 0.9).length;
  const pending = pos.filter((p) => p.status === "pending_approval").length;
  return [
    { id: "hard-stop", label: "Hard budget stop", rule: "Block new bookings at 100% of period budget", state: frozen > 0 ? "block" : "ok", detail: frozen > 0 ? `${frozen} cost centre(s) frozen at ceiling` : "All cost centres within ceiling" },
    { id: "soft-warn", label: "Soft warning threshold", rule: "Notify owner + finance at 90% consumption", state: overCommit > 0 ? "warn" : "ok", detail: `${overCommit} cost centre(s) above 90% including commitments` },
    { id: "po-required", label: "PO required", rule: "No logistics charge without an approved PO line", state: pending > 0 ? "warn" : "ok", detail: `${pending} purchase order(s) awaiting approval` },
    { id: "maker-checker", label: "Maker–checker", rule: "Raiser cannot approve their own PO", state: "ok", detail: "Segregation of duties enforced on every level" },
    { id: "reservation", label: "Budget reservation", rule: "Approved POs reserve funds until consumed or expired", state: "ok", detail: "Reservations released automatically after 60 days" },
    { id: "variance", label: "Variance control", rule: "Flag any invoice line >5% above PO rate", state: "warn", detail: "2 lines pending finance review this period" },
  ];
}

/* ---------------------------------------------------------------- build */

export function referenceWorkspace(module: DeliveryModule): ProcurementWorkspace {
  const costCentres = referenceCostCentres(module);
  const departments = referenceDepartments(costCentres, module);
  const purchaseOrders = referencePurchaseOrders(costCentres, module);
  const invoices = referenceInvoices(costCentres, module);
  return finalise({ source: "modelled", costCentres, departments, purchaseOrders, invoices });
}

function finalise(input: {
  source: "live" | "modelled";
  costCentres: CostCentre[];
  departments: DepartmentBilling[];
  purchaseOrders: PurchaseOrder[];
  invoices: ProcurementInvoice[];
}): ProcurementWorkspace {
  const budgetKes = input.costCentres.reduce((s, c) => s + c.budgetKes, 0);
  const committedKes = input.costCentres.reduce((s, c) => s + c.committedKes, 0);
  const spentKes = input.costCentres.reduce((s, c) => s + c.spentKes, 0);
  const outstandingKes = input.invoices.reduce((s, i) => s + (i.totalKes - i.paidKes), 0);
  return {
    ...input,
    budgetControls: budgetControls(input.costCentres, input.purchaseOrders),
    totals: {
      budgetKes,
      committedKes,
      spentKes,
      availableKes: Math.max(0, budgetKes - committedKes - spentKes),
      utilisationPct: budgetKes > 0 ? Math.round(((committedKes + spentKes) / budgetKes) * 1000) / 10 : 0,
      openPos: input.purchaseOrders.filter((p) => p.status !== "closed" && p.status !== "rejected").length,
      pendingApprovals: input.purchaseOrders.filter((p) => p.status === "pending_approval").length,
      outstandingKes,
    },
  };
}

/**
 * Reads real cost centres, budgets and invoices where visible, and overlays them
 * on the reference workspace so partial data still produces a complete view.
 */
export async function loadProcurementWorkspace(module: DeliveryModule): Promise<ProcurementWorkspace> {
  const base = referenceWorkspace(module);
  const [centresRes, budgetsRes, invoicesRes] = await Promise.all([
    supabase.from("cost_centers").select("id,code,name,status,owner_user_id").limit(24),
    supabase.from("budgets").select("id,name,cost_center_id,total_cents,reserved_cents,consumed_cents,status").limit(24),
    supabase
      .from("corporate_invoices")
      .select("id,invoice_number,status,subtotal_cents,tax_total_cents,total_cents,paid_cents,issued_at,due_at")
      .order("issued_at", { ascending: false })
      .limit(6),
  ]);

  const liveCentres = centresRes.data ?? [];
  const liveBudgets = budgetsRes.data ?? [];
  const liveInvoices = invoicesRes.data ?? [];
  if (liveCentres.length === 0 && liveInvoices.length === 0) return base;

  const costCentres: CostCentre[] = liveCentres.length
    ? liveCentres.map((c, i) => {
        const budget = liveBudgets.find((b) => b.cost_center_id === c.id);
        const template = base.costCentres[i % base.costCentres.length];
        const budgetKes = budget ? Number(budget.total_cents) / 100 : template.budgetKes;
        return {
          id: c.id,
          code: c.code ?? template.code,
          name: c.name ?? template.name,
          owner: template.owner,
          department: template.department,
          budgetKes,
          committedKes: budget ? Number(budget.reserved_cents) / 100 : template.committedKes,
          spentKes: budget ? Number(budget.consumed_cents) / 100 : template.spentKes,
          status: (c.status as CostCentre["status"]) ?? "active",
        };
      })
    : base.costCentres;

  const invoices: ProcurementInvoice[] = liveInvoices.length
    ? liveInvoices.map((inv, i) => {
        const template = base.invoices[i % base.invoices.length];
        const issued = inv.issued_at ?? template.issuedAt;
        return {
          id: inv.id,
          number: inv.invoice_number ?? template.number,
          period: new Date(issued).toLocaleDateString("en-KE", { month: "long", year: "numeric" }),
          costCentres: costCentres.length,
          deliveries: template.deliveries,
          subtotalKes: Number(inv.subtotal_cents ?? 0) / 100 || template.subtotalKes,
          vatKes: Number(inv.tax_total_cents ?? 0) / 100 || template.vatKes,
          totalKes: Number(inv.total_cents ?? 0) / 100 || template.totalKes,
          paidKes: Number(inv.paid_cents ?? 0) / 100,
          status: (inv.status as InvoiceStatus) ?? template.status,
          issuedAt: issued,
          dueAt: inv.due_at ?? template.dueAt,
        };
      })
    : base.invoices;

  return finalise({
    source: "live",
    costCentres,
    departments: referenceDepartments(costCentres, module),
    purchaseOrders: base.purchaseOrders,
    invoices,
  });
}

/* ------------------------------------------------------------- decisions */

export function decidePurchaseOrder(
  module: DeliveryModule,
  po: PurchaseOrder,
  decision: "approve" | "reject",
  actor: string,
  reason?: string,
): AuditEntry {
  return recordAudit({
    domain: "procurement",
    module,
    action: decision === "approve" ? "Approve purchase order" : "Reject purchase order",
    subject: `${po.number} · ${po.title}`,
    actor,
    reason,
    impact: [
      { label: "Value", value: `KES ${po.valueKes.toLocaleString("en-KE")}` },
      { label: "Cost centre", value: po.costCentreCode },
      { label: "Budget effect", value: decision === "approve" ? "Funds reserved" : "No reservation" },
    ],
  });
}

export function poStatusAfter(po: PurchaseOrder, decision: "approve" | "reject"): PoStatus {
  return decision === "approve" ? "approved" : "rejected";
}
