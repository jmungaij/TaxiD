/**
 * Phase 10 §10.27–10.28 — Staff 360 rebuilt around products and missions.
 *
 * The portal reflects how TaxiD creates value, not how HR files people. It is
 * explicitly not surveillance software: the model exposes clarity, ownership and
 * decision quality, and deliberately excludes activity monitoring, keystroke or
 * location tracking, and per-person productivity ranking.
 */
import type { ProductLine } from "./mission";

export const STAFF_SECTIONS = [
  "my_workspace", "organisation", "customers", "products", "missions", "marketplace",
  "sales", "operations", "finance", "revenue", "ai", "risk", "knowledge", "executive_command",
] as const;
export type StaffSection = (typeof STAFF_SECTIONS)[number];

export const STAFF_SECTION_LABEL: Record<StaffSection, string> = {
  my_workspace: "My Workspace",
  organisation: "Organisation",
  customers: "Customers",
  products: "Products",
  missions: "Missions",
  marketplace: "Marketplace",
  sales: "Sales",
  operations: "Operations",
  finance: "Finance",
  revenue: "Revenue",
  ai: "AI",
  risk: "Risk",
  knowledge: "Knowledge",
  executive_command: "Executive Command",
};

/** Things Staff 360 must never collect. Enforced by review, stated in code. */
export const PROHIBITED_STAFF_SIGNALS = [
  "keystroke_or_screen_monitoring",
  "continuous_location_tracking",
  "individual_productivity_ranking",
  "private_communication_content",
] as const;

export interface StaffWorkspaceModel {
  role: string;
  department: string;
  /** Products this employee is accountable for. */
  products: ProductLine[];
  customers: number | null;
  missions: number | null;
  opportunities: number | null;
  tasks: number | null;
  decisionsPending: number | null;
  kpis: { label: string; value: string; feeds: string }[];
  aiRecommendations: string[];
  exceptions: number | null;
  learning: string[];
  /** Contribution the employee's products generated; never a personal target. */
  revenueContributionCents: number | null;
  /** Fields the portal cannot fill, shown as gaps rather than zeros. */
  gaps: string[];
}

export interface StaffWorkspaceInput {
  role: string;
  department: string;
  products: ProductLine[];
  customers?: number | null;
  missions?: number | null;
  opportunities?: number | null;
  tasks?: number | null;
  decisionsPending?: number | null;
  exceptions?: number | null;
  revenueContributionCents?: number | null;
  kpis?: { label: string; value: string; feeds: string }[];
  aiRecommendations?: string[];
  learning?: string[];
}

export function buildStaffWorkspace(input: StaffWorkspaceInput): StaffWorkspaceModel {
  const gaps: string[] = [];
  const pick = (value: number | null | undefined, label: string): number | null => {
    if (value === null || value === undefined) {
      gaps.push(`${label} is not attributed to this role yet`);
      return null;
    }
    return value;
  };

  return {
    role: input.role,
    department: input.department,
    products: input.products,
    customers: pick(input.customers, "Customer ownership"),
    missions: pick(input.missions, "Mission ownership"),
    opportunities: pick(input.opportunities, "Pipeline"),
    tasks: pick(input.tasks, "Task queue"),
    decisionsPending: pick(input.decisionsPending, "Decision queue"),
    exceptions: pick(input.exceptions, "Exception queue"),
    kpis: input.kpis ?? [],
    aiRecommendations: input.aiRecommendations ?? [],
    learning: input.learning ?? [],
    revenueContributionCents: pick(input.revenueContributionCents, "Product contribution"),
    gaps,
  };
}
