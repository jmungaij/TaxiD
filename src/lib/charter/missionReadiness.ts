/**
 * Mission readiness + proactive concierge intelligence for the executive
 * charter workspace.
 *
 * Enterprise buyers (protocol offices, procurement, NGO logistics) judge a
 * booking surface by whether it tells them what is still missing and what a
 * better configuration would look like. This module derives both, purely from
 * the mission state, so the guidance is deterministic and auditable.
 */

export interface MissionState {
  origin: string;
  destination: string;
  date: string;
  time: string;
  durationDays: number;
  units: number;
  assetName: string;
  assetSeats: number;
  partySize: number;
  luggagePieces: number;
  wheelchairCount: number;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  procurementReady: boolean;
  paymentAuthorized: boolean;
}

export interface ReadinessCheck {
  id: string;
  label: string;
  done: boolean;
  /** Weight in the readiness score. */
  weight: number;
  hint: string;
}

export interface MissionReadiness {
  /** 0–100 readiness score. */
  score: number;
  checks: ReadinessCheck[];
  /** The next action the buyer should take. */
  nextAction: string | null;
  band: "draft" | "shaping" | "ready" | "authorized";
}

/** Deterministic readiness score with contextual guidance. */
export function missionReadiness(state: MissionState): MissionReadiness {
  const checks: ReadinessCheck[] = [
    {
      id: "pickup",
      label: "Pickup confirmed",
      done: Boolean(state.origin.trim()),
      weight: 12,
      hint: "Set the pickup point for the delegation.",
    },
    {
      id: "destination",
      label: "Destination confirmed",
      done: Boolean(state.destination.trim()),
      weight: 12,
      hint: "Set the mission destination.",
    },
    {
      id: "schedule",
      label: "Schedule confirmed",
      done: Boolean(state.date) && Boolean(state.time),
      weight: 14,
      hint: "Choose a departure date and time so fleet availability can be held.",
    },
    {
      id: "vehicle",
      label: "Vehicle selected",
      done: Boolean(state.assetName) && state.units >= 1,
      weight: 12,
      hint: "Select a vehicle class that matches the delegation size.",
    },
    {
      id: "delegates",
      label: "Delegate profile captured",
      done: state.partySize > 0,
      weight: 14,
      hint: "Declare how many executives, VIPs, staff and security travel.",
    },
    {
      id: "contact",
      label: "Booking contact captured",
      done: Boolean(state.contactName.trim()) && /@/.test(state.contactEmail) && Boolean(state.contactPhone.trim()),
      weight: 14,
      hint: "Add the name, email and phone of the responsible coordinator.",
    },
    {
      id: "procurement",
      label: "Procurement details captured",
      done: state.procurementReady,
      weight: 12,
      hint: "Add the organisation, approving officer, title and cost centre.",
    },
    {
      id: "authorization",
      label: "Payment authorization",
      done: state.paymentAuthorized,
      weight: 10,
      hint: "The approving authority must authorise the mission cost.",
    },
  ];

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.filter((c) => c.done).reduce((sum, c) => sum + c.weight, 0);
  const score = Math.round((earned / total) * 100);
  const pending = checks.find((c) => !c.done) ?? null;
  const band: MissionReadiness["band"] = score >= 100
    ? "authorized"
    : score >= 80 ? "ready" : score >= 45 ? "shaping" : "draft";

  return { score, checks, nextAction: pending ? pending.hint : null, band };
}

export interface ConciergeAdvisory {
  id: string;
  tone: "recommendation" | "timing" | "risk" | "comfort";
  message: string;
}

const CBD_CONGESTION_WINDOW = [7, 9] as const;

/**
 * Proactive advisories — issued continuously from the mission state rather
 * than waiting for the user to ask a question.
 */
export function conciergeAdvisories(state: MissionState): ConciergeAdvisory[] {
  const out: ConciergeAdvisory[] = [];
  const seats = state.assetSeats || 0;
  const party = state.partySize;

  if (party > 0 && seats > 0) {
    const capacity = seats * Math.max(1, state.units);
    if (party > capacity) {
      const needed = Math.ceil(party / seats);
      out.push({
        id: "capacity",
        tone: "recommendation",
        message: `${party} delegates exceed the ${capacity} seats configured — ${needed} × ${state.assetName} covers the delegation.`,
      });
    } else if (capacity - party >= seats) {
      out.push({
        id: "overcapacity",
        tone: "recommendation",
        message: `${capacity} seats for ${party} delegates is over-configured — reducing units lowers the mission cost.`,
      });
    } else {
      out.push({
        id: "optimal",
        tone: "recommendation",
        message: `Based on ${party} delegates, ${state.units} × ${state.assetName} is the optimal configuration.`,
      });
    }
  }

  const hour = state.time ? Number(state.time.slice(0, 2)) : NaN;
  if (!Number.isNaN(hour) && hour >= CBD_CONGESTION_WINDOW[0] && hour <= CBD_CONGESTION_WINDOW[1]) {
    out.push({
      id: "congestion",
      tone: "timing",
      message: "Departing two hours earlier avoids Nairobi CBD congestion and protects the arrival window.",
    });
  }

  if (state.date) {
    const day = new Date(`${state.date}T00:00:00`).getDay();
    if (day === 0 || (!Number.isNaN(hour) && (hour >= 22 || hour < 5))) {
      out.push({
        id: "surcharge",
        tone: "risk",
        message: "Sunday and night departures carry the ×1.25 surcharge — a Saturday or daytime slot reduces the mission cost.",
      });
    }
    const lead = Math.round((new Date(`${state.date}T00:00:00`).getTime() - Date.now()) / 86_400_000);
    if (lead >= 0 && lead < 2) {
      out.push({
        id: "lead-time",
        tone: "risk",
        message: `Under 48 hours notice (${lead} day lead) — fleet availability is limited and short-notice loading applies.`,
      });
    }
  }

  if (state.luggagePieces > 0 && seats > 0 && state.luggagePieces > seats * 2) {
    out.push({
      id: "luggage",
      tone: "comfort",
      message: `${state.luggagePieces} luggage pieces exceed the hold profile — add a support vehicle or a trailer-equipped coach.`,
    });
  }
  if (state.wheelchairCount > 0) {
    out.push({
      id: "accessibility",
      tone: "comfort",
      message: `${state.wheelchairCount} wheelchair space(s) requested — a ramp-equipped vehicle with securing points is dispatched.`,
    });
  }
  if (state.durationDays >= 2) {
    out.push({
      id: "multiday",
      tone: "comfort",
      message: `${state.durationDays}-day mission — driver rest rotation and overnight crew accommodation are included in the quote.`,
    });
  }
  if (!state.procurementReady) {
    out.push({
      id: "procurement",
      tone: "risk",
      message: "Procurement details are pending — approving officer, title and cost centre are required before authorization.",
    });
  }
  out.push({
    id: "parking",
    tone: "timing",
    message: "Parking at high-security destinations requires prior authorization — operations files the request on confirmation.",
  });

  return out;
}
