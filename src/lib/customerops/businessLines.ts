/**
 * Customer Operations — TaxiD business line registry.
 *
 * One canonical list of every commercial line the Customer Operations Center
 * must support. Deterministic and dependency-free: the registry drives tab
 * grouping, routing, SLA tiering and coverage certification, so adding a line
 * here automatically surfaces it in the cockpit and in the coverage report.
 */
import type { BusinessDomain } from "./taxonomy";

export type LineGroup =
  | "passenger"
  | "charter"
  | "corporate"
  | "freight"
  | "assets"
  | "concierge";

export type SlaTier = "standard" | "priority" | "vip";

export interface BusinessLine {
  id: string;
  label: string;
  group: LineGroup;
  /** Owning domain — reused for auto-escalation routing. */
  domain: BusinessDomain;
  /** Desk that owns the line inside the Operations Center. */
  desk: DeskId;
  /** Deep link into the existing operational surface for this line. */
  route: string;
  slaTier: SlaTier;
  /** Lowercase signals used to resolve a case to this line. */
  keywords: string[];
}

export type DeskId =
  | "rider"
  | "driver"
  | "operator"
  | "corporate"
  | "charter"
  | "delivery"
  | "rentals"
  | "concierge";

export const LINE_GROUP_LABEL: Record<LineGroup, string> = {
  passenger: "Passenger mobility",
  charter: "Charter & group travel",
  corporate: "Corporate & employee mobility",
  freight: "Delivery, courier & logistics",
  assets: "Rentals, leasing & equipment",
  concierge: "Concierge & premium services",
};

export const DESK_LABEL: Record<DeskId, string> = {
  rider: "Rider support",
  driver: "Driver support",
  operator: "Fleet operator support",
  corporate: "Corporate support",
  charter: "Charter support",
  delivery: "Delivery support",
  rentals: "Rentals support",
  concierge: "Concierge desk",
};

export const BUSINESS_LINES: BusinessLine[] = [
  { id: "riders", label: "Riders", group: "passenger", domain: "rider_ops", desk: "rider", route: "/dashboard/rider", slaTier: "standard", keywords: ["ride", "rider", "trip", "fare", "pickup", "dropoff"] },
  { id: "drivers", label: "Drivers", group: "passenger", domain: "driver_ops", desk: "driver", route: "/dashboard/driver", slaTier: "standard", keywords: ["driver", "settlement", "payout", "rating", "suspension", "appeal"] },
  { id: "fleet_operators", label: "Fleet operators", group: "passenger", domain: "fleet", desk: "operator", route: "/dashboard/admin/fleet", slaTier: "priority", keywords: ["fleet", "operator", "partner vehicle", "maintenance", "utilisation"] },
  { id: "chauffeur", label: "Chauffeur services", group: "passenger", domain: "rider_ops", desk: "concierge", route: "/charter/chauffeur", slaTier: "priority", keywords: ["chauffeur", "driver-guide", "hourly hire"] },
  { id: "airport_meet_greet", label: "Airport meet & greet", group: "passenger", domain: "rider_ops", desk: "concierge", route: "/charter/airport", slaTier: "vip", keywords: ["airport", "meet and greet", "meet & greet", "arrival", "terminal", "flight pickup"] },

  { id: "bus_charter", label: "Bus charter", group: "charter", domain: "marketplace", desk: "charter", route: "/charter/bus", slaTier: "priority", keywords: ["bus", "coach hire", "staff bus"] },
  { id: "van_charter", label: "Van charter", group: "charter", domain: "marketplace", desk: "charter", route: "/charter/van", slaTier: "priority", keywords: ["van", "minibus", "shuttle van"] },
  { id: "coach_charter", label: "Coach charter", group: "charter", domain: "marketplace", desk: "charter", route: "/charter/coach", slaTier: "priority", keywords: ["coach", "long distance", "intercity"] },
  { id: "school_transport", label: "School transport", group: "charter", domain: "marketplace", desk: "charter", route: "/charter/school", slaTier: "priority", keywords: ["school", "pupil", "student transport", "academy"] },
  { id: "event_group_travel", label: "Event & group travel", group: "charter", domain: "marketplace", desk: "charter", route: "/charter/events", slaTier: "priority", keywords: ["event", "group travel", "conference transport", "wedding", "delegation"] },
  { id: "air_mobility", label: "Air mobility", group: "charter", domain: "marketplace", desk: "charter", route: "/charter/air", slaTier: "vip", keywords: ["flight", "aircraft", "private jet", "air charter", "aviation"] },
  { id: "helicopter", label: "Helicopter charter", group: "charter", domain: "marketplace", desk: "concierge", route: "/charter/helicopter", slaTier: "vip", keywords: ["helicopter", "heli", "rotor"] },
  { id: "marine", label: "Marine mobility", group: "charter", domain: "marketplace", desk: "concierge", route: "/charter/marine", slaTier: "vip", keywords: ["marine", "boat", "yacht", "ferry", "vessel"] },

  { id: "corporate_accounts", label: "Corporate customers", group: "corporate", domain: "corporate", desk: "corporate", route: "/dashboard/admin/corporates", slaTier: "priority", keywords: ["corporate", "company account", "contract", "purchase order", "cost centre", "cost center", "etims"] },
  { id: "employee_mobility", label: "Employee mobility", group: "corporate", domain: "corporate", desk: "corporate", route: "/employee-mobility", slaTier: "priority", keywords: ["employee", "staff transport", "commute", "department budget", "travel policy"] },
  { id: "executive_travel", label: "Executive travel", group: "corporate", domain: "corporate", desk: "concierge", route: "/dashboard/charter/portal", slaTier: "vip", keywords: ["executive", "c-suite", "board", "vip travel"] },

  { id: "delivery", label: "Delivery", group: "freight", domain: "logistics", desk: "delivery", route: "/dashboard/admin/delivery", slaTier: "standard", keywords: ["delivery", "parcel", "dropoff failed", "proof of delivery"] },
  { id: "courier", label: "Courier", group: "freight", domain: "logistics", desk: "delivery", route: "/dashboard/admin/delivery", slaTier: "standard", keywords: ["courier", "same day", "rider dispatch", "package"] },
  { id: "logistics", label: "Logistics", group: "freight", domain: "logistics", desk: "delivery", route: "/dashboard/admin/logistics", slaTier: "priority", keywords: ["logistics", "warehouse", "cold chain", "freight", "consignment"] },

  { id: "car_rentals", label: "Car rentals", group: "assets", domain: "marketplace", desk: "rentals", route: "/dashboard/admin/rentals", slaTier: "standard", keywords: ["rental", "hire car", "self drive", "late return", "mileage"] },
  { id: "vehicle_leasing", label: "Vehicle leasing", group: "assets", domain: "marketplace", desk: "rentals", route: "/dashboard/admin/rentals", slaTier: "priority", keywords: ["lease", "leasing", "long term hire", "contract extension"] },
  { id: "heavy_equipment", label: "Heavy equipment", group: "assets", domain: "marketplace", desk: "rentals", route: "/dashboard/admin/rentals", slaTier: "priority", keywords: ["equipment", "excavator", "crane", "plant hire", "truck hire"] },

  { id: "concierge", label: "Concierge services", group: "concierge", domain: "support", desk: "concierge", route: "/dashboard/admin/customer-operations", slaTier: "vip", keywords: ["concierge", "personal assistant", "itinerary", "hotel", "protocol"] },
];

export const LINE_BY_ID = new Map(BUSINESS_LINES.map((l) => [l.id, l]));
export const LINES_BY_DESK = (desk: DeskId) => BUSINESS_LINES.filter((l) => l.desk === desk);
export const LINES_BY_GROUP = (group: LineGroup) => BUSINESS_LINES.filter((l) => l.group === group);

/** Every line the cockpit must be able to service. Used by the coverage gate. */
export const REQUIRED_LINE_COUNT = BUSINESS_LINES.length;

export interface LineResolutionInput {
  subject?: string | null;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
}

export interface LineResolution {
  line: BusinessLine;
  score: number;
  matched: string[];
  /** True when no signal matched and the default passenger line was used. */
  fallback: boolean;
}

/**
 * Resolves a case to a business line from its text and tags.
 *
 * Tag hits weigh more than free-text hits so operators can override a bad
 * text match by tagging the case with the line id.
 */
export function resolveBusinessLine(input: LineResolutionInput): LineResolution {
  const tags = (input.tags ?? []).map((t) => t.toLowerCase().trim());
  const haystack = [input.subject, input.description, input.category]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let best: LineResolution | null = null;
  for (const line of BUSINESS_LINES) {
    const matched: string[] = [];
    let score = 0;
    if (tags.includes(line.id)) {
      score += 40;
      matched.push(`tag:${line.id}`);
    }
    for (const kw of line.keywords) {
      if (tags.includes(kw)) {
        score += 12;
        matched.push(`tag:${kw}`);
      } else if (haystack.includes(kw)) {
        // Longer keywords are more specific ("meet and greet" beats "ride").
        score += 4 + Math.min(6, kw.length / 4);
        matched.push(kw);
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { line, score: Math.round(score), matched, fallback: false };
    }
  }
  if (best) return best;
  return { line: LINE_BY_ID.get("riders")!, score: 0, matched: [], fallback: true };
}

export interface LineCoverageRow {
  line: BusinessLine;
  cases: number;
  open: number;
  breached: number;
  escalated: number;
  /** True when the desk has an active queue for the line. */
  active: boolean;
}

export interface CoverageCase {
  subject?: string | null;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
  status: string;
  sla_resolution_breached?: boolean;
  escalation_level?: number;
}

const OPEN_STATUSES = new Set([
  "new", "triaged", "assigned", "in_progress",
  "pending_customer", "pending_approval", "escalated",
]);

/**
 * Coverage report across every registered line — including lines with zero
 * volume, so the cockpit can prove it services the full commercial catalogue.
 */
export function lineCoverage(cases: CoverageCase[]): LineCoverageRow[] {
  const rows = new Map<string, LineCoverageRow>(
    BUSINESS_LINES.map((line) => [line.id, { line, cases: 0, open: 0, breached: 0, escalated: 0, active: false }]),
  );
  for (const c of cases) {
    const { line } = resolveBusinessLine(c);
    const row = rows.get(line.id)!;
    row.cases += 1;
    if (OPEN_STATUSES.has(c.status)) row.open += 1;
    if (c.sla_resolution_breached) row.breached += 1;
    if ((c.escalation_level ?? 0) > 0) row.escalated += 1;
    row.active = true;
  }
  return [...rows.values()].sort((a, b) => b.cases - a.cases || a.line.label.localeCompare(b.line.label));
}

/** Rolls coverage up per desk so each workspace tab shows its own load. */
export function deskLoad(cases: CoverageCase[]): Array<{ desk: DeskId; label: string; cases: number; open: number; breached: number }> {
  const coverage = lineCoverage(cases);
  const byDesk = new Map<DeskId, { desk: DeskId; label: string; cases: number; open: number; breached: number }>();
  for (const desk of Object.keys(DESK_LABEL) as DeskId[]) {
    byDesk.set(desk, { desk, label: DESK_LABEL[desk], cases: 0, open: 0, breached: 0 });
  }
  for (const row of coverage) {
    const entry = byDesk.get(row.line.desk)!;
    entry.cases += row.cases;
    entry.open += row.open;
    entry.breached += row.breached;
  }
  return [...byDesk.values()].sort((a, b) => b.open - a.open || a.label.localeCompare(b.label));
}
