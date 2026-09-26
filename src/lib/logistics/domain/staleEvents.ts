/**
 * PHASE 8 — STALE EVENT PROTECTION.
 *
 * An old event must never regress newer authoritative state:
 *   IN_TRANSIT → DELIVERED, then a late COURIER_ARRIVED arrives → recorded as
 *   out-of-order, NOT applied.
 *
 * Controls: optimistic version guard (expected_version), monotonic occurred_at
 * per aggregate, terminal-state lock, duplicate idempotency-key replay.
 */
export type StaleVerdict =
  | "APPLIED"
  | "REJECTED_STALE_VERSION"
  | "REJECTED_OUT_OF_ORDER"
  | "REJECTED_TERMINAL"
  | "REPLAYED_IDEMPOTENT"
  | "REJECTED_VERSION_GAP";

export interface AggregateState {
  aggregate_id: string;
  state: string;
  version: number;
  last_event_at: string;
  terminal: boolean;
  appliedKeys: Set<string>;
}

export interface IncomingEvent {
  aggregate_id: string;
  event_type: string;
  to_state?: string;
  /** Version the producer believed was current. */
  expected_version: number;
  occurred_at: string;
  idempotency_key: string;
}

export interface StaleDecision {
  verdict: StaleVerdict;
  applied: boolean;
  state: AggregateState;
  note: string;
}

export function applyEventWithGuards(state: AggregateState, e: IncomingEvent): StaleDecision {
  if (state.appliedKeys.has(e.idempotency_key)) {
    return { verdict: "REPLAYED_IDEMPOTENT", applied: false, state, note: "duplicate command replayed; original effect returned" };
  }
  if (state.terminal) {
    return { verdict: "REJECTED_TERMINAL", applied: false, state, note: `${state.state} is terminal; late ${e.event_type} recorded as out-of-order only` };
  }
  if (e.expected_version < state.version) {
    return { verdict: "REJECTED_STALE_VERSION", applied: false, state, note: `event based on v${e.expected_version}, current v${state.version}` };
  }
  if (e.expected_version > state.version) {
    return { verdict: "REJECTED_VERSION_GAP", applied: false, state, note: `producer claims v${e.expected_version} ahead of authoritative v${state.version}; reconciliation required` };
  }
  if (Date.parse(e.occurred_at) < Date.parse(state.last_event_at)) {
    return { verdict: "REJECTED_OUT_OF_ORDER", applied: false, state, note: "occurred_at precedes the last applied event" };
  }
  const next: AggregateState = {
    ...state,
    state: e.to_state ?? state.state,
    version: state.version + 1,
    last_event_at: e.occurred_at,
    terminal: e.to_state === "DELIVERED" || e.to_state === "CANCELLED" || e.to_state === "RETURNED",
    appliedKeys: new Set([...state.appliedKeys, e.idempotency_key]),
  };
  return { verdict: "APPLIED", applied: true, state: next, note: "applied under optimistic version guard" };
}

export interface StaleProbeResult {
  id: string;
  scenario: string;
  expected: StaleVerdict;
  actual: StaleVerdict;
  passed: boolean;
}

export function runStaleEventProbes(): StaleProbeResult[] {
  const fresh = (over: Partial<AggregateState> = {}): AggregateState => ({
    aggregate_id: "shp-1",
    state: "IN_TRANSIT",
    version: 18,
    last_event_at: "2026-08-26T12:00:00.000Z",
    terminal: false,
    appliedKeys: new Set<string>(),
    ...over,
  });
  const ev = (over: Partial<IncomingEvent> = {}): IncomingEvent => ({
    aggregate_id: "shp-1",
    event_type: "DELIVERY_COMPLETED",
    to_state: "DELIVERED",
    expected_version: 18,
    occurred_at: "2026-08-26T13:00:00.000Z",
    idempotency_key: "k1",
    ...over,
  });

  const probe = (id: string, scenario: string, expected: StaleVerdict, run: () => StaleVerdict): StaleProbeResult => {
    const actual = run();
    return { id, scenario, expected, actual, passed: actual === expected };
  };

  return [
    probe("SE-01", "in-order event at current version", "APPLIED", () => applyEventWithGuards(fresh(), ev()).verdict),
    probe("SE-02", "event built on version 12 while authoritative is 18", "REJECTED_STALE_VERSION", () =>
      applyEventWithGuards(fresh(), ev({ expected_version: 12 })).verdict),
    probe("SE-03", "producer claims version 25 ahead of authoritative 18", "REJECTED_VERSION_GAP", () =>
      applyEventWithGuards(fresh(), ev({ expected_version: 25 })).verdict),
    probe("SE-04", "late COURIER_ARRIVED after DELIVERED", "REJECTED_TERMINAL", () =>
      applyEventWithGuards(fresh({ state: "DELIVERED", terminal: true }), ev({ event_type: "COURIER_ARRIVED", to_state: "IN_TRANSIT" })).verdict),
    probe("SE-05", "out-of-order timestamp at correct version", "REJECTED_OUT_OF_ORDER", () =>
      applyEventWithGuards(fresh(), ev({ occurred_at: "2026-08-26T09:00:00.000Z" })).verdict),
    probe("SE-06", "duplicate idempotency key replay", "REPLAYED_IDEMPOTENT", () =>
      applyEventWithGuards(fresh({ appliedKeys: new Set(["k1"]) }), ev()).verdict),
    probe("SE-07", "two concurrent transitions from the same version", "REJECTED_STALE_VERSION", () => {
      const s0 = fresh();
      const first = applyEventWithGuards(s0, ev({ idempotency_key: "a", event_type: "IN_TRANSIT", to_state: "IN_TRANSIT" }));
      const second = applyEventWithGuards(first.state, ev({ idempotency_key: "b", to_state: "FAILED" }));
      return second.verdict;
    }),
  ];
}

export function staleEventSummary() {
  const results = runStaleEventProbes();
  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed),
    status: results.every((r) => r.passed) ? ("PASS" as const) : ("FAIL" as const),
  };
}
