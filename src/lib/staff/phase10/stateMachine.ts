/**
 * Phase 10 §10.3 — the Universal Mission State Framework.
 *
 * One canonical lifecycle. Each product derives its own machine as an ordered
 * subset, so nine services share one spine instead of nine booking engines.
 * Transitions are validated: a mission cannot skip a state its product declares,
 * and it cannot leave a terminal state.
 */
import type { Mission, MissionType } from "./mission";
import { appendMissionEvent } from "./mission";

export const MISSION_STATES = [
  "intent",
  "search",
  "quote",
  "match",
  "offer",
  "accept",
  "capacity_committed",
  "booked",
  "scheduled",
  "dispatched",
  "in_progress",
  "completed",
  "financial_closure",
  "settled",
  "rated",
  "retained",
] as const;
export type MissionState = (typeof MISSION_STATES)[number];

export const TERMINAL_FAILURES = ["cancelled", "failed"] as const;
export type MissionFailureState = (typeof TERMINAL_FAILURES)[number];

export const STATE_LABEL: Record<MissionState, string> = {
  intent: "Intent",
  search: "Search",
  quote: "Quote",
  match: "Match",
  offer: "Offer",
  accept: "Accept",
  capacity_committed: "Capacity committed",
  booked: "Booked",
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  in_progress: "In progress",
  completed: "Completed",
  financial_closure: "Financial closure",
  settled: "Settled",
  rated: "Rated",
  retained: "Retained",
};

/** States that are never optional: without them there is no governed transaction. */
const MANDATORY: MissionState[] = ["intent", "match", "booked", "completed", "financial_closure", "settled"];

const EXCLUDE: Record<MissionType, MissionState[]> = {
  ride: ["quote", "scheduled", "capacity_committed"],
  corporate_ground: [],
  airport: ["capacity_committed"],
  charter: [],
  air: [],
  delivery: ["quote", "scheduled"],
  logistics: [],
  rental: ["dispatched"],
  leasing: ["dispatched", "in_progress"],
};

/** The ordered lifecycle this product actually executes. */
export function machineFor(type: MissionType): MissionState[] {
  const excluded = new Set(EXCLUDE[type]);
  return MISSION_STATES.filter((s) => MANDATORY.includes(s) || !excluded.has(s));
}

export function isApplicable(type: MissionType, state: MissionState): boolean {
  return machineFor(type).includes(state);
}

export function nextState(type: MissionType, current: string): MissionState | null {
  const machine = machineFor(type);
  const idx = machine.indexOf(current as MissionState);
  if (idx === -1 || idx === machine.length - 1) return null;
  return machine[idx + 1];
}

export interface TransitionResult {
  ok: boolean;
  reason?: string;
  mission: Mission;
}

/**
 * Governed transition. Forward movement must follow the product machine exactly;
 * failure states are reachable from any live state; nothing leaves a terminal.
 */
export function transition(
  mission: Mission,
  to: MissionState | MissionFailureState,
  actor: string,
  note?: string,
  at = new Date().toISOString(),
): TransitionResult {
  const failed = (reason: string): TransitionResult => ({ ok: false, reason, mission });

  if ((TERMINAL_FAILURES as readonly string[]).includes(mission.state)) {
    return failed(`Mission is ${mission.state} — a terminal state cannot be left`);
  }
  if (mission.state === "retained") return failed("Mission is fully closed at retained");

  if ((TERMINAL_FAILURES as readonly string[]).includes(to)) {
    return { ok: true, mission: appendMissionEvent(mission, { at, state: to, actor, note }) };
  }

  const expected = nextState(mission.type, mission.state);
  if (expected === null) return failed(`No forward state is defined after ${mission.state} for ${mission.type}`);
  if (expected !== to) {
    return failed(`${mission.type} must move ${mission.state} → ${expected}, not → ${to}`);
  }
  return { ok: true, mission: appendMissionEvent(mission, { at, state: to, actor, note }) };
}

/** Runs a mission through its whole machine — used by the certification demo. */
export function runChain(
  mission: Mission,
  actor = "orchestrator",
): { mission: Mission; states: string[]; rejected: string[] } {
  let current = mission;
  const rejected: string[] = [];
  for (;;) {
    const to = nextState(current.type, current.state);
    if (to === null) break;
    const result = transition(current, to, actor);
    if (!result.ok) {
      rejected.push(result.reason ?? "unknown");
      break;
    }
    current = result.mission;
  }
  return { mission: current, states: current.events.map((e) => e.state), rejected };
}

export function progressPercent(mission: Mission): number {
  const machine = machineFor(mission.type);
  const idx = machine.indexOf(mission.state as MissionState);
  if (idx === -1) return 0;
  return Math.round(((idx + 1) / machine.length) * 100);
}

/** Live missions are those executing but not yet economically closed. */
export function isLive(mission: Mission): boolean {
  const live: string[] = ["match", "offer", "accept", "capacity_committed", "booked", "scheduled", "dispatched", "in_progress"];
  return live.includes(mission.state);
}

export function isEconomicallyClosed(mission: Mission): boolean {
  return ["settled", "rated", "retained"].includes(mission.state);
}
