/**
 * Actionable resolutions for ground-transport conflicts.
 *
 * `validateGroundPackage` says *what* is wrong; this module says *what to do
 * about it* and returns a patch the booking flow can apply in one click so the
 * quote preview updates instantly.
 */
import {
  GROUND_SERVICES, emptyGroundDetail, groundServiceByKey,
  type GroundDetail, type GroundIssue, type ItineraryContext,
} from "@/lib/charter/groundTransport";

export interface GroundState {
  keys: string[];
  details: Record<string, GroundDetail>;
}

export interface GroundResolution {
  id: string;
  /** Short button label, e.g. "Match 3 passengers". */
  label: string;
  /** One-line explanation of the trade-off. */
  hint: string;
  kind: "time" | "location" | "passengers" | "package";
  apply: (state: GroundState) => GroundState;
}

const clone = (s: GroundState): GroundState => ({
  keys: [...s.keys],
  details: Object.fromEntries(Object.entries(s.details).map(([k, v]) => [k, { ...v }])),
});

const patch = (key: string, next: Partial<GroundDetail>) => (s: GroundState): GroundState => {
  const out = clone(s);
  out.details[key] = { ...(out.details[key] ?? emptyGroundDetail()), ...next };
  return out;
};

const shiftTime = (time: string, minutes: number): string => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const base = m ? Number(m[1]) * 60 + Number(m[2]) : 8 * 60;
  const v = ((base + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
};

/** Resolutions offered for a single conflict, in the order operations prefers. */
export function groundResolutions(
  issue: GroundIssue,
  state: GroundState,
  ctx: ItineraryContext,
): GroundResolution[] {
  const svc = groundServiceByKey(issue.key) ?? GROUND_SERVICES.find((g) => g.key === issue.key);
  const detail = state.details[issue.key] ?? emptyGroundDetail();
  const cap = Math.max(1, ctx.cabinSeats ?? ctx.manifestPassengers ?? 1);
  const out: GroundResolution[] = [];

  if (issue.field === "passengers") {
    const target = Math.max(1, Math.min(cap, ctx.manifestPassengers || cap));
    out.push({
      id: `${issue.key}-pax-match`,
      label: `Match ${target} passenger${target === 1 ? "" : "s"}`,
      hint: "Aligns this leg with the named manifest and the cabin capacity.",
      kind: "passengers",
      apply: patch(issue.key, { passengers: target }),
    });
  }

  if (issue.field === "time") {
    const suggested = detail.time ? shiftTime(detail.time, -60) : "07:00";
    out.push({
      id: `${issue.key}-time-shift`,
      label: detail.time ? `Move pickup to ${suggested}` : "Set pickup 07:00",
      hint: "Puts the departure-side pickup ahead of every other timed leg.",
      kind: "time",
      apply: patch(issue.key, { time: suggested }),
    });
    if (detail.time) {
      out.push({
        id: `${issue.key}-time-late`,
        label: `Move to ${shiftTime(detail.time, 90)}`,
        hint: "Keeps the leg but reschedules it after the chauffeur pickup.",
        kind: "time",
        apply: patch(issue.key, { time: shiftTime(detail.time, 90) }),
      });
    }
  }

  if (issue.field === "location") {
    const arrivalSide = issue.key === "destination" || issue.key === "hotel";
    const suggestion = (arrivalSide ? ctx.destination : ctx.origin) || "";
    if (suggestion) {
      out.push({
        id: `${issue.key}-loc`,
        label: `Reselect pickup: ${suggestion}`,
        hint: arrivalSide
          ? "Arrival transfers are dispatched at the destination airfield."
          : "Departure legs are dispatched at the origin terminal / FBO.",
        kind: "location",
        apply: patch(issue.key, { location: suggestion }),
      });
    }
  }

  out.push({
    id: `${issue.key}-remove`,
    label: `Remove ${svc?.label ?? issue.key}`,
    hint: "Drops the leg from the package and re-prices the quote instantly.",
    kind: "package",
    apply: (s) => {
      const next = clone(s);
      next.keys = next.keys.filter((k) => k !== issue.key);
      delete next.details[issue.key];
      return next;
    },
  });

  return out;
}
