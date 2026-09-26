/** Presentation helpers for the Phase 9 expansion surface. */
import { formatMeasure, type Measure } from "../phase8/provenance";

export * from "./index";

/** Formats a measure, never inventing a figure for an unavailable one. */
export function formatMeasureSafe(m: Measure | null | undefined): string {
  if (!m) return "DATA NOT AVAILABLE";
  return formatMeasure(m);
}
