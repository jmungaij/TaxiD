/**
 * Data-provenance discipline for Staff 360.
 *
 * Non-negotiable principle: never present a hypothetical figure as live SAFARID
 * performance. Every metric rendered in the staff portal must declare its
 * state, and a metric without a data source renders as DATA NOT AVAILABLE.
 */

export type DataState = "live" | "modelled" | "unavailable" | "loading";

export interface StaffMetric {
  label: string;
  /** Formatted value. Only meaningful when state === "live" | "modelled". */
  value?: string;
  state: DataState;
  /** ISO timestamp of the underlying read, shown as LAST UPDATED. */
  updatedAt?: string;
  /** Where the number came from — table, view or configured rule. */
  source?: string;
  hint?: string;
}

export const DATA_STATE_LABEL: Record<DataState, string> = {
  live: "LIVE",
  modelled: "MODELLED",
  unavailable: "DATA NOT AVAILABLE",
  loading: "LOADING",
};

/** Build a live metric from a resolved count/value. */
export function liveMetric(
  label: string,
  value: string,
  source: string,
  updatedAt = new Date().toISOString(),
): StaffMetric {
  return { label, value, state: "live", source, updatedAt };
}

/** Build an explicitly unavailable metric — the honest default. */
export function unavailableMetric(label: string, hint?: string): StaffMetric {
  return { label, state: "unavailable", hint };
}

/** Build a modelled metric. Must never be described as actual performance. */
export function modelledMetric(label: string, value: string, hint: string): StaffMetric {
  return { label, value, state: "modelled", hint };
}

/** Relative "last updated" text; empty when unknown. */
export function lastUpdatedText(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "Last updated just now";
  if (mins < 60) return `Last updated ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Last updated ${hrs} h ago`;
  return `Last updated ${Math.round(hrs / 24)} d ago`;
}
