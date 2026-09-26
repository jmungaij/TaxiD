/**
 * Verified mobility status + trust proof metrics.
 *
 * Rules (data integrity, non-negotiable):
 *  • Simulated data is NEVER presented as live. Every reading carries an
 *    explicit `status` and `source` so the UI can label it honestly.
 *  • Numeric proof points come from real platform rows only. If a query
 *    fails or returns nothing, the metric renders as a capability
 *    ("LIVE", "SECURE") rather than an invented number.
 *  • Freshness is always exposed so visitors can judge the reading.
 */
import { supabase } from "@/integrations/supabase/client";

export type MobilityStatusKind = "live" | "simulated" | "unavailable";

export interface MobilityReading {
  /** e.g. "NAIROBI" */
  region: string;
  /** e.g. "EXECUTIVE" */
  category: string;
  label: string;
  available: boolean;
}

export interface MobilityStatus {
  status: MobilityStatusKind;
  source: string;
  fetchedAt: number;
  readings: MobilityReading[];
  /** verified supply counts, only present when status === "live" */
  verifiedAssets?: number;
  verifiedOperators?: number;
}

const CATEGORY_LABEL: Record<string, string> = {
  "aircraft-charter": "AIR CHARTER",
  "helicopter-charter": "HELICOPTER",
  "bus-charter": "BUS CHARTER",
  "marine-charter": "MARINE",
  "heavy-machinery-leasing": "EQUIPMENT",
  "vehicle-rental": "RENTAL",
};

function region(homeBase: string | null): string {
  if (!homeBase) return "EAST AFRICA";
  return homeBase.replace(/\s*\(.*\)\s*/, "").trim().toUpperCase() || "EAST AFRICA";
}

/** Reads verified supply from the public charter/rental inventory. */
export async function fetchMobilityStatus(): Promise<MobilityStatus> {
  const fetchedAt = Date.now();
  try {
    const { data, error } = await supabase
      .from("charter_inventory")
      .select("category_slug,status,home_base,operator_name,name")
      .eq("active", true)
      .limit(200);

    if (error || !data || data.length === 0) {
      return { status: "unavailable", source: "platform_inventory", fetchedAt, readings: [] };
    }

    const rows = data as {
      category_slug: string | null;
      status: string | null;
      home_base: string | null;
      operator_name: string | null;
      name: string | null;
    }[];

    const operators = new Set(rows.map((r) => r.operator_name).filter(Boolean) as string[]);
    const seen = new Set<string>();
    const readings: MobilityReading[] = [];

    for (const r of rows) {
      const cat = CATEGORY_LABEL[r.category_slug ?? ""] ?? (r.category_slug ?? "MOBILITY").toUpperCase();
      const reg = region(r.home_base);
      const key = `${reg}|${cat}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const available = (r.status ?? "").toLowerCase() === "available";
      readings.push({
        region: reg,
        category: cat,
        available,
        label: `${reg} · ${cat} · ${available ? "AVAILABLE NOW" : "ON REQUEST"}`,
      });
      if (readings.length >= 6) break;
    }

    return {
      status: "live",
      source: "platform_inventory",
      fetchedAt,
      readings,
      verifiedAssets: rows.length,
      verifiedOperators: operators.size,
    };
  } catch {
    return { status: "unavailable", source: "platform_inventory", fetchedAt, readings: [] };
  }
}

export function freshnessLabel(fetchedAt: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (s < 60) return `Updated ${s} sec ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `Updated ${m} min ago`;
  return `Updated ${Math.round(m / 60)} h ago`;
}

export function statusChip(status: MobilityStatusKind): { text: string; tone: "live" | "demo" | "off" } {
  if (status === "live") return { text: "LIVE", tone: "live" };
  if (status === "simulated") return { text: "SIMULATED AVAILABILITY", tone: "demo" };
  return { text: "Availability temporarily unavailable", tone: "off" };
}
