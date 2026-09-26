/**
 * Operator-submitted mission cost components ("rate cards").
 *
 * SmartFare v2.0 must price from what operators actually submitted rather than
 * from platform estimates whenever that data exists. This module is the single
 * source of truth for those submissions: which operator, which asset, which
 * route, which cost components, and whether availability was confirmed.
 *
 * Pure data + a versioned local store (same pattern as the SmartFare config),
 * so the marketplace, booking workflow and admin console resolve identically.
 */

export interface OperatorMissionInputs {
  id: string;
  operatorId: string;
  operatorName: string;
  /** SmartFare fleet key this rate card applies to. */
  aircraftKey: string;
  submittedAt: string;
  /** Optional route scoping — route-specific cards win over fleet-wide cards. */
  fromCode?: string | null;
  toCode?: string | null;
  validFrom?: string | null;
  validTo?: string | null;

  /* Submitted mission cost components (KES). Omitted = not submitted. */
  hourlyRateKes?: number | null;
  positioningRateKes?: number | null;
  missionBaseFeeKes?: number | null;
  airportChargesKes?: number | null;
  handlingKes?: number | null;
  navigationKes?: number | null;
  crewKes?: number | null;

  /** Operator confirmed the aircraft is available for the mission window. */
  availabilityConfirmed?: boolean;
  /** Operator declared a repositioning leg that matches this mission. */
  emptyLegAvailable?: boolean;
  reference?: string | null;
}

/** Cost components a rate card can supply, in provenance display order. */
export const RATE_CARD_COMPONENTS: { key: keyof OperatorMissionInputs; label: string }[] = [
  { key: "hourlyRateKes", label: "Flight time rate" },
  { key: "positioningRateKes", label: "Positioning rate" },
  { key: "missionBaseFeeKes", label: "Mission base fee" },
  { key: "airportChargesKes", label: "Airport charges" },
  { key: "handlingKes", label: "Ground handling" },
  { key: "navigationKes", label: "Navigation charges" },
  { key: "crewKes", label: "Crew costs" },
];

const STORE_KEY = "yalla.smartfare.rateCards.v1";

function readStore(): OperatorMissionInputs[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as OperatorMissionInputs[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const listOperatorRateCards = (): OperatorMissionInputs[] => readStore();

export function saveOperatorRateCard(card: Omit<OperatorMissionInputs, "id" | "submittedAt"> & {
  id?: string;
  submittedAt?: string;
}): OperatorMissionInputs {
  const entry: OperatorMissionInputs = {
    ...card,
    id: card.id ?? `rc_${Date.now().toString(36)}`,
    submittedAt: card.submittedAt ?? new Date().toISOString(),
  };
  const next = [...readStore().filter((c) => c.id !== entry.id), entry].slice(-200);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — pricing falls back to platform estimates */
  }
  return entry;
}

export function removeOperatorRateCard(id: string) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(readStore().filter((c) => c.id !== id)));
  } catch {
    /* noop */
  }
}

export interface RateCardQuery {
  aircraftKey: string;
  fromCode?: string;
  toCode?: string;
  /** Reference date used to evaluate validity windows. */
  now?: Date;
  /** Evaluate against an explicit set instead of the store (tests inject this). */
  cards?: OperatorMissionInputs[];
}

const inWindow = (c: OperatorMissionInputs, at: number) => {
  const from = c.validFrom ? new Date(c.validFrom).getTime() : -Infinity;
  const to = c.validTo ? new Date(c.validTo).getTime() : Infinity;
  return at >= from && at <= to;
};

/**
 * Resolve the best applicable rate card. Route-scoped cards beat fleet-wide
 * cards; among equals the most recently submitted card wins. Deterministic.
 */
export function resolveOperatorInputs(q: RateCardQuery): OperatorMissionInputs | null {
  const at = (q.now ?? new Date()).getTime();
  const pool = (q.cards ?? readStore()).filter(
    (c) => c.aircraftKey === q.aircraftKey && inWindow(c, at),
  );
  const scored = pool
    .map((c) => {
      const routeScoped = Boolean(c.fromCode && c.toCode);
      const routeMatch = routeScoped && c.fromCode === q.fromCode && c.toCode === q.toCode;
      if (routeScoped && !routeMatch) return null;
      return { card: c, score: routeMatch ? 2 : 1 };
    })
    .filter(Boolean) as { card: OperatorMissionInputs; score: number }[];

  scored.sort((a, b) =>
    b.score - a.score ||
    new Date(b.card.submittedAt).getTime() - new Date(a.card.submittedAt).getTime());
  return scored[0]?.card ?? null;
}

/** Which components this card actually supplies. */
export function suppliedComponents(card: OperatorMissionInputs | null): string[] {
  if (!card) return [];
  return RATE_CARD_COMPONENTS
    .filter((c) => {
      const v = card[c.key];
      return typeof v === "number" && v > 0;
    })
    .map((c) => String(c.key));
}
