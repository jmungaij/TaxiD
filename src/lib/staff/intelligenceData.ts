/**
 * Seeded intelligence data layer for Staff 360.
 *
 * Reads the labelled seed batch (`staff360-intelligence-v1`) from
 * `staff_intelligence_metrics` and `staff_attention_signals`. Every value is
 * surfaced as MODELLED with its batch source declared, never as actual Yalla
 * performance. When a row is absent the caller still renders
 * DATA NOT AVAILABLE — the provenance discipline is unchanged.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { modelledMetric, unavailableMetric, type StaffMetric } from "./dataState";

export const SEED_BATCH = "staff360-intelligence-v1";

export type MetricSurface =
  | "impact"
  | "department"
  | "revenue_category"
  | "customer_segment"
  | "marketplace"
  | "innovation"
  | "attention"
  | "workflow";

export interface IntelligenceMetricRow {
  surface: string;
  entity_key: string;
  metric_key: string;
  metric_label: string;
  value_text: string;
  unit: string | null;
  source: string;
  state: string;
  hint: string | null;
  updated_at: string;
}

export interface AttentionSignal {
  id: string;
  domain: string;
  severity: "info" | "watch" | "critical";
  title: string;
  why: string;
  evidence: string[];
  confidence: number;
  expected_impact: string;
  recommended_action: string;
  owner: string;
  source: string;
}

/** `surface|entity_key|metric_key` → row. */
export type MetricIndex = Map<string, IntelligenceMetricRow>;

function keyOf(surface: string, entity: string, metric: string) {
  return `${surface}|${entity}|${metric}`;
}

export function toMetric(
  row: IntelligenceMetricRow | undefined,
  fallbackLabel: string,
  fallbackHint?: string,
): StaffMetric {
  if (!row) return unavailableMetric(fallbackLabel, fallbackHint);
  const metric = modelledMetric(
    row.metric_label || fallbackLabel,
    row.unit ? `${row.value_text}` : row.value_text,
    row.hint ?? (row.unit ? `${row.unit} · seeded experiment batch` : "Seeded experiment batch"),
  );
  return { ...metric, source: row.source, updatedAt: row.updated_at };
}

export function pickMetric(
  index: MetricIndex,
  surface: MetricSurface,
  entity: string,
  metricKey: string,
  fallbackLabel: string,
  fallbackHint?: string,
): StaffMetric {
  return toMetric(index.get(keyOf(surface, entity, metricKey)), fallbackLabel, fallbackHint);
}

export interface IntelligenceDataState {
  index: MetricIndex;
  signals: AttentionSignal[];
  loading: boolean;
  /** True when the seeded batch resolved at least one row for this user's scope. */
  seeded: boolean;
}

const EMPTY: IntelligenceDataState = { index: new Map(), signals: [], loading: true, seeded: false };

/**
 * Loads the seeded metric index (and optionally the attention signals) once per
 * mount. RLS restricts both tables to staff-level roles, so unauthorised users
 * simply see the unavailable state.
 */
export function useIntelligenceData(options: { withSignals?: boolean } = {}): IntelligenceDataState {
  const { withSignals = false } = options;
  const [state, setState] = useState<IntelligenceDataState>(EMPTY);

  useEffect(() => {
    let active = true;
    (async () => {
      const metricsQuery = supabase
        .from("staff_intelligence_metrics")
        .select("surface, entity_key, metric_key, metric_label, value_text, unit, source, state, hint, updated_at")
        .eq("batch_label", SEED_BATCH);

      const [metricsRes, signalsRes] = await Promise.all([
        metricsQuery,
        withSignals
          ? supabase
              .from("staff_attention_signals")
              .select("id, domain, severity, title, why, evidence, confidence, expected_impact, recommended_action, owner, source")
              .eq("batch_label", SEED_BATCH)
              .order("severity", { ascending: true })
          : Promise.resolve({ data: [], error: null } as const),
      ]);

      if (!active) return;
      const rows = (metricsRes.data ?? []) as IntelligenceMetricRow[];
      const index: MetricIndex = new Map();
      for (const r of rows) index.set(keyOf(r.surface, r.entity_key, r.metric_key), r);
      setState({
        index,
        signals: ((signalsRes.data ?? []) as AttentionSignal[]),
        loading: false,
        seeded: rows.length > 0,
      });
    })().catch(() => {
      if (active) setState({ index: new Map(), signals: [], loading: false, seeded: false });
    });
    return () => {
      active = false;
    };
  }, [withSignals]);

  return state;
}

export const SEVERITY_ORDER: Record<AttentionSignal["severity"], number> = {
  critical: 0,
  watch: 1,
  info: 2,
};

export function signalsByDomain(signals: AttentionSignal[]): Record<string, AttentionSignal[]> {
  const out: Record<string, AttentionSignal[]> = {};
  for (const s of signals) {
    (out[s.domain] ??= []).push(s);
  }
  for (const list of Object.values(out)) {
    list.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }
  return out;
}
