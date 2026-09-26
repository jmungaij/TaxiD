/**
 * ROLE DASHBOARDS — one lens per discipline (control, finance, logistics, recruitment).
 *
 * Every figure comes from `staff_dashboard_snapshot(lens)`, a server routine that
 * checks the caller's platform role before it returns anything, and that returns
 * the caller's OWN open work only. The browser never asks for another person's
 * task list and cannot widen its own lens: an unauthorised lens is refused by the
 * database, not hidden by the interface.
 */
import { supabase } from "@/integrations/supabase/client";

// The routine is newer than the generated types snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type DashboardLens = "personal" | "admin" | "finance" | "logistics" | "recruitment";

export type TileTone = "neutral" | "positive" | "warning" | "critical";

export interface DashboardTile {
  key: string;
  label: string;
  value: number;
  unit: string;
  tone: TileTone;
}

export interface DashboardPoint {
  day: string;
  value: number;
}

export interface DashboardAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string | null;
  at: string | null;
}

export interface DashboardTask {
  id: string;
  title: string;
  kind: string | null;
  priority: string | null;
  status: string | null;
  due: string | null;
  nextAction: string | null;
  overdue: boolean;
}

export interface DashboardSnapshot {
  lens: DashboardLens;
  generatedAt: string;
  staffId: string | null;
  tiles: DashboardTile[];
  series: DashboardPoint[];
  alerts: DashboardAlert[];
  myTasks: DashboardTask[];
}

export interface LensDefinition {
  lens: DashboardLens;
  label: string;
  strapline: string;
  /** Platform roles the server accepts for this lens — mirrored for menu display only. */
  roles: string[];
  seriesLabel: string;
  /** Units the trend chart is counted in, for honest axis labelling. */
  seriesUnit: string;
}

export const LENSES: LensDefinition[] = [
  {
    // Every employee on the staff register holds this lens — it reads only
    // their OWN record, so it needs no platform role.
    lens: "personal",
    label: "My performance",
    strapline: "Your own work, your own deadlines and your own pipeline — nobody else's.",
    roles: [],
    seriesLabel: "Work assigned to me",
    seriesUnit: "items per day",
  },
  {
    lens: "admin",
    label: "Administration",
    strapline: "Platform control, workload and access integrity across the company.",
    roles: ["admin", "super_admin"],
    seriesLabel: "Work items raised",
    seriesUnit: "items per day",
  },
  {
    lens: "finance",
    label: "Finance",
    strapline: "Money owed to us, money owed by us, and every payout awaiting a decision.",
    roles: ["admin", "super_admin", "finance_admin"],
    seriesLabel: "Freight invoiced",
    seriesUnit: "KES per day",
  },
  {
    lens: "logistics",
    label: "Logistics",
    strapline: "Movements in flight, carrier acceptance and delivery evidence.",
    roles: ["admin", "super_admin", "operations_admin", "operations_manager", "fleet_manager"],
    seriesLabel: "Bookings created",
    seriesUnit: "bookings per day",
  },
  {
    lens: "recruitment",
    label: "Recruitment",
    strapline: "Live applications, recruiter actions falling due and flagged files.",
    roles: ["admin", "super_admin", "operations_admin", "general_manager", "director"],
    seriesLabel: "Applications received",
    seriesUnit: "applications per day",
  },
];

/**
 * Lenses the chrome may offer. The personal lens belongs to every employee whose
 * login is linked to a staff record; wider lenses need the platform role the
 * database itself checks.
 */
export function lensesForRoles(roles: string[], hasStaffIdentity = false): LensDefinition[] {
  return LENSES.filter((l) =>
    l.roles.length === 0 ? hasStaffIdentity : l.roles.some((r) => roles.includes(r)),
  );
}

const TONES = new Set<TileTone>(["neutral", "positive", "warning", "critical"]);

export async function fetchDashboardSnapshot(lens: DashboardLens): Promise<DashboardSnapshot> {
  const { data, error } =
    lens === "personal"
      ? await db.rpc("staff_personal_snapshot")
      : await db.rpc("staff_dashboard_snapshot", { _lens: lens });
  if (error) {
    if (/LENS_NOT_AUTHORISED/.test(error.message)) {
      throw new Error("Your role does not cover this dashboard.");
    }
    if (/STAFF_IDENTITY_REQUIRED/.test(error.message)) {
      throw new Error("Your login is not yet linked to an employee record.");
    }
    throw new Error(error.message);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (data ?? {}) as any;
  return {
    lens,
    generatedAt: raw.generated_at ?? new Date().toISOString(),
    staffId: raw.staff_id ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tiles: (raw.tiles ?? []).map((t: any) => ({
      key: String(t.key),
      label: String(t.label),
      value: Number(t.value ?? 0),
      unit: String(t.unit ?? ""),
      tone: TONES.has(t.tone) ? (t.tone as TileTone) : "neutral",
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    series: (raw.series ?? []).map((p: any) => ({ day: String(p.day), value: Number(p.value ?? 0) })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alerts: (raw.alerts ?? []).map((a: any) => ({
      id: String(a.id),
      severity: a.severity === "critical" || a.severity === "warning" ? a.severity : "info",
      title: String(a.title ?? "Alert"),
      detail: a.detail ?? null,
      at: a.at ?? null,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    myTasks: (raw.my_tasks ?? []).map((t: any) => ({
      id: String(t.id),
      title: String(t.title ?? "Untitled task"),
      kind: t.kind ?? null,
      priority: t.priority ?? null,
      status: t.status ?? null,
      due: t.due ?? null,
      nextAction: t.next_action ?? null,
      overdue: !!t.overdue,
    })),
  };
}

/**
 * Briefing lines are DERIVED, not generated: each sentence restates a figure that
 * is present in the snapshot. Nothing is inferred, predicted or invented.
 */
export function buildBriefing(snapshot: DashboardSnapshot): string[] {
  const lines: string[] = [];
  const critical = snapshot.tiles.filter((t) => t.tone === "critical" && t.value > 0);
  const warning = snapshot.tiles.filter((t) => t.tone === "warning" && t.value > 0);
  const overdueTasks = snapshot.myTasks.filter((t) => t.overdue).length;

  if (critical.length) {
    lines.push(
      `Needs attention first: ${critical.map((t) => `${t.label.toLowerCase()} (${t.value})`).join(", ")}.`,
    );
  }
  if (warning.length) {
    lines.push(`Worth reviewing: ${warning.map((t) => `${t.label.toLowerCase()} (${t.value})`).join(", ")}.`);
  }
  if (overdueTasks > 0) {
    lines.push(`${overdueTasks} of your own task${overdueTasks === 1 ? " is" : "s are"} past their due time.`);
  } else if (snapshot.myTasks.length > 0) {
    lines.push(`${snapshot.myTasks.length} open task${snapshot.myTasks.length === 1 ? "" : "s"} assigned to you, none overdue.`);
  } else {
    lines.push("No open task is assigned to you right now.");
  }

  const half = Math.floor(snapshot.series.length / 2);
  if (half >= 2) {
    const earlier = snapshot.series.slice(0, half).reduce((n, p) => n + p.value, 0);
    const later = snapshot.series.slice(half).reduce((n, p) => n + p.value, 0);
    if (earlier === 0 && later === 0) {
      lines.push("No activity recorded in the last fourteen days.");
    } else if (earlier === 0) {
      lines.push("All activity in this fortnight fell in the last seven days.");
    } else {
      const pct = Math.round(((later - earlier) / earlier) * 100);
      lines.push(
        pct === 0
          ? "The last seven days match the seven before them."
          : `The last seven days are ${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"} than the seven before them.`,
      );
    }
  }
  if (snapshot.alerts.length === 0) lines.push("No open alert on this desk.");
  return lines;
}
