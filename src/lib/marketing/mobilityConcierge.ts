/**
 * Corporate Mobility Concierge — deterministic intent engine for the
 * on-page AI assistant.
 *
 * The concierge is not a generic chatbot: every answer is produced from
 * platform data that already exists (the governed pricing engine via
 * `estimateDailyRate`, the published fleet, the corporate travel-policy rules
 * surfaced on this page) and every commercial answer ends in a real
 * deep-link into the authenticated booking planner. Nothing is invented and no
 * pricing logic is duplicated here.
 */
import type { AssetClass } from "@/lib/charter/assetPricingProfiles";
import { estimateDailyRate } from "@/lib/charter/estimatedDailyRate";
import { charterPlannerPath, portalEntryHref } from "@/lib/charter/portalRoutes";
import { answerFromKnowledge } from "@/lib/knowledge/corporateKnowledgeBase";

export type ConciergeIntent =
  | "book_shuttle"
  | "generate_quote"
  | "recommend_fleet"
  | "estimate_cost"
  | "availability"
  | "repeat_booking"
  | "policy"
  | "submit_approval"
  | "handover"
  | "unknown";

export interface ConciergeVehicle {
  key: string;
  name: string;
  capacity: number;
  category: string;
  fromKes: number;
  assetClass?: AssetClass;
}

export interface ConciergeContext {
  vehicles: ConciergeVehicle[];
  authenticated: boolean;
  /** Widget state so the concierge answers with what the visitor already typed. */
  passengers?: number;
  frequency?: string;
  pickup?: string;
  destination?: string;
  date?: string;
}

export interface ConciergeReply {
  intent: ConciergeIntent;
  /** Short answer lines rendered in the assistant transcript. */
  lines: string[];
  /** Optional deep-link into an existing production surface. */
  action?: { label: string; href: string };
  /** Vehicle the answer settled on, when the intent is fleet related. */
  vehicleKey?: string;
  /** Knowledge-base article the answer was grounded in, when retrieval hit. */
  citation?: string;
  /** Knowledge-base article id, for audit and analytics. */
  knowledgeId?: string;
  /** Slots the engine resolved — used for analytics. */
  slots: { passengers?: number; days?: number; hours?: number; date?: string; frequency?: string };
}

const ASSET_CLASS_BY_CATEGORY: Record<string, AssetClass> = {
  executive: "van",
  staff_transport: "shuttle",
  events: "coach",
};

/** Suggested prompts shown before the visitor types anything. */
export const CONCIERGE_SUGGESTIONS = [
  "Book our weekly shuttle every Monday at 7:00 AM",
  "Cheapest executive vehicle for 18 people",
  "Generate a quotation for a 33-seater coach",
  "What buses are available tomorrow?",
  "Book airport transfers for 12 executives",
  "Repeat last month's booking",
  "Apply our corporate contract pricing",
  "Raise approval for next week's staff shuttle",
];

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));

/** Extracts a passenger count from natural phrasing ("for 18 people", "33-seater"). */
export function parsePassengers(text: string): number | undefined {
  const seater = text.match(/(\d{1,3})\s*[-\s]?seat/);
  if (seater) return Number(seater[1]);
  const people = text.match(/(\d{1,3})\s*(people|pax|passengers|staff|employees|executives|guests|delegates)/);
  if (people) return Number(people[1]);
  const forN = text.match(/for\s+(\d{1,3})\b/);
  if (forN) return Number(forN[1]);
  return undefined;
}

/** Extracts a rough duration in days from phrasing ("for 3 days", "a week"). */
export function parseDays(text: string): number | undefined {
  const d = text.match(/(\d{1,2})\s*day/);
  if (d) return Number(d[1]);
  if (has(text, "week")) return 5;
  if (has(text, "month")) return 22;
  return undefined;
}

export function parseFrequency(text: string): string | undefined {
  if (has(text, "every monday", "weekly", "each week")) return "weekly";
  if (has(text, "daily", "every day", "every morning", "shift")) return "daily";
  if (has(text, "monthly", "contract", "dedicated")) return "monthly";
  if (has(text, "one-off", "once", "single", "tomorrow", "today")) return "one_off";
  return undefined;
}

export function classifyIntent(text: string): ConciergeIntent {
  const t = text.toLowerCase();
  if (
    has(t, "raise approval", "submit approval", "request approval", "approval request",
      "get approval", "send for approval", "need approval", "approval for")
  ) return "submit_approval";
  if (has(t, "repeat", "same as last", "last month")) return "repeat_booking";
  if (has(t, "policy", "contract pricing", "approval", "cost centre", "cost center", "budget", "compliance")) return "policy";
  if (has(t, "available", "availability", "how many vehicles")) return "availability";
  if (has(t, "quotation", "quote", "proposal", "rfq")) return "generate_quote";
  if (has(t, "cheapest", "best", "recommend", "which vehicle", "what vehicle", "suitable", "fit")) return "recommend_fleet";
  if (has(t, "cost", "price", "how much", "budget for", "estimate", "rate")) return "estimate_cost";
  if (has(t, "book", "shuttle", "transfer", "arrange", "schedule")) return "book_shuttle";
  if (has(t, "consultant", "sales", "human", "call me", "talk to")) return "handover";
  return "unknown";
}

/** Smallest published vehicle that seats the requested headcount. */
export function recommendVehicle(
  vehicles: ConciergeVehicle[],
  passengers: number | undefined,
  preferExecutive = false,
): ConciergeVehicle | undefined {
  const pool = preferExecutive ? vehicles.filter((v) => v.category === "executive") : vehicles;
  const source = pool.length ? pool : vehicles;
  const fits = source
    .filter((v) => !passengers || v.capacity >= passengers)
    .sort((a, b) => a.capacity - b.capacity || a.fromKes - b.fromKes);
  return fits[0] ?? [...source].sort((a, b) => b.capacity - a.capacity)[0];
}

const kes = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

function plannerHref(ctx: ConciergeContext, params: Record<string, string>, campaign: string) {
  const search = new URLSearchParams(params).toString();
  return portalEntryHref(
    charterPlannerPath("bus-charter", search ? `?${search}` : ""),
    ctx.authenticated,
    campaign,
  );
}

function priceVehicle(
  v: ConciergeVehicle,
  passengers: number | undefined,
  days: number,
  date?: string,
  corporate = true,
) {
  return estimateDailyRate({
    assetClass: v.assetClass ?? ASSET_CLASS_BY_CATEGORY[v.category] ?? "van",
    assetLabel: v.name,
    seats: v.capacity,
    passengers,
    band: [v.fromKes, Math.round(v.fromKes * 1.45)],
    days,
    date,
    corporate,
  });
}

/**
 * Answers one concierge prompt. Pure: no network, no side effects — the caller
 * decides what to log and where to navigate.
 */
export function answerConcierge(prompt: string, ctx: ConciergeContext): ConciergeReply {
  const text = prompt.trim();
  const t = text.toLowerCase();
  const intent = classifyIntent(t);
  const passengers = parsePassengers(t) ?? ctx.passengers;
  const days = parseDays(t) ?? 1;
  const frequency = parseFrequency(t) ?? ctx.frequency;
  const executive = has(t, "executive", "chauffeur", "vip", "board", "director");
  const slots = { passengers, days, date: ctx.date, frequency };

  const vehicle = recommendVehicle(ctx.vehicles, passengers, executive);

  const bookParams = (extra: Record<string, string> = {}) => {
    const p: Record<string, string> = { ...extra };
    if (passengers) p.pax = String(passengers);
    if (frequency) p.frequency = frequency;
    if (ctx.pickup) p.origin = ctx.pickup;
    if (ctx.destination) p.destination = ctx.destination;
    if (ctx.date) p.date = ctx.date;
    if (vehicle) { p.fleet = vehicle.key; p.vehicle = vehicle.name; }
    return p;
  };

  switch (intent) {
    case "book_shuttle":
    case "repeat_booking": {
      const repeat = intent === "repeat_booking";
      const lines = repeat
        ? [
            "I can reload your most recent programme in the planner — your saved routes, cost centre and passenger list come across with it.",
            "Sign-in is required so the repeat pulls your own booking history rather than a blank form.",
          ]
        : [
            vehicle
              ? `For ${passengers ?? vehicle.capacity} passengers the ${vehicle.name} (${vehicle.capacity} seats) is the right class${frequency ? ` on a ${frequency.replace("_", " ")} pattern` : ""}.`
              : "I can set this movement up in the planner.",
            "I have pre-filled the planner with the route, headcount and frequency — you confirm the date and approver there.",
          ];
      return {
        intent,
        lines,
        vehicleKey: vehicle?.key,
        slots,
        action: {
          label: repeat ? "Reload last programme" : "Continue in the planner",
          href: plannerHref(ctx, bookParams(repeat ? { repeat: "last" } : {}), `concierge-${intent}`),
        },
      };
    }

    case "generate_quote": {
      const est = vehicle ? priceVehicle(vehicle, passengers, days, ctx.date) : null;
      return {
        intent,
        vehicleKey: vehicle?.key,
        slots,
        lines: [
          vehicle && est
            ? `${vehicle.name} · ${vehicle.capacity} seats — indicative ${kes(est.expectedKes)} per ${est.unit} (band ${kes(est.fromKes)}–${kes(est.toKes)}).`
            : "Tell me the headcount and I will price the class for you.",
          est ? est.basisNote : "",
          "A formal, itemised quotation with eTIMS tax lines is issued from the planner once you confirm the dates.",
        ].filter(Boolean),
        action: {
          label: "Generate the quotation",
          href: plannerHref(ctx, bookParams({ intent: "quote" }), "concierge-quote"),
        },
      };
    }

    case "recommend_fleet": {
      const ranked = [...ctx.vehicles]
        .filter((v) => !passengers || v.capacity >= passengers)
        .sort((a, b) => a.fromKes - b.fromKes)
        .slice(0, 3);
      const pool = ranked.length ? ranked : ctx.vehicles.slice(0, 3);
      return {
        intent,
        vehicleKey: pool[0]?.key,
        slots,
        lines: [
          passengers
            ? `Best value for ${passengers} passengers${executive ? " in the executive class" : ""}:`
            : "Most requested classes for corporate programmes:",
          ...pool.map((v) => `• ${v.name} — ${v.capacity} seats, from ${kes(v.fromKes)} / day`),
        ],
        action: {
          label: `Configure the ${pool[0]?.name ?? "fleet"}`,
          href: plannerHref(ctx, bookParams(), "concierge-fleet"),
        },
      };
    }

    case "estimate_cost": {
      const est = vehicle ? priceVehicle(vehicle, passengers, days, ctx.date) : null;
      const monthlyDays = frequency === "daily" ? 22 : frequency === "weekly" ? 4 : days;
      return {
        intent,
        vehicleKey: vehicle?.key,
        slots,
        lines: est && vehicle
          ? [
              `${vehicle.name}: about ${kes(est.expectedKes)} per ${est.unit}, corporate rate applied.`,
              frequency && frequency !== "one_off"
                ? `On a ${frequency.replace("_", " ")} pattern that is roughly ${kes(est.expectedKes * monthlyDays)} per month${passengers ? ` — ${kes((est.expectedKes * monthlyDays) / Math.max(1, passengers * monthlyDays))} per employee trip` : ""}.`
                : `Band for this movement: ${kes(est.fromKes)}–${kes(est.toKes)}.`,
              est.basisNote,
            ]
          : ["Give me a headcount (for example \"cost for 25 staff daily\") and I will price it from the governed rate card."],
        action: {
          label: "Price it in the planner",
          href: plannerHref(ctx, bookParams(), "concierge-cost"),
        },
      };
    }

    case "availability":
      return {
        intent,
        slots,
        lines: [
          "Availability is confirmed against live operator inventory inside the planner — it holds the vehicle while you complete approval.",
          vehicle ? `For ${passengers ?? vehicle.capacity} passengers I would check the ${vehicle.name} first.` : "",
        ].filter(Boolean),
        vehicleKey: vehicle?.key,
        action: {
          label: "Check live availability",
          href: plannerHref(ctx, bookParams(), "concierge-availability"),
        },
      };

    case "policy": {
      // Retrieval-grounded: the curated knowledge base answers policy, FAQ,
      // contract-clause, approval-rule and fleet-documentation questions.
      const kb = answerFromKnowledge(text);
      return {
        intent,
        slots,
        knowledgeId: kb?.article.id,
        citation: kb?.citation,
        lines: kb
          ? [...kb.lines, ...(kb.related.length ? [`Related: ${kb.related.map((a) => a.title).join(" · ")}`] : [])]
          : [
              "Your travel policy is enforced by the platform, not by memory: spend limits, approved vehicle classes, cost centres and approver chains are configured on your corporate account.",
              "Requests outside policy are routed to the named approver automatically, and contract pricing is applied to every quote once your account is active.",
            ],
        action: {
          label: kb?.article.sourceHref ? "Open the governing surface" : "Open the corporate portal",
          href: kb?.article.sourceHref
            ? portalEntryHref(kb.article.sourceHref, ctx.authenticated, "concierge-knowledge")
            : portalEntryHref("/dashboard/charter/portal", ctx.authenticated, "concierge-policy"),
        },
      };
    }

    case "submit_approval": {
      const est = vehicle ? priceVehicle(vehicle, passengers, days, ctx.date) : null;
      return {
        intent,
        slots,
        vehicleKey: vehicle?.key,
        lines: [
          vehicle && est
            ? `I can raise an approval request for the ${vehicle.name} (${vehicle.capacity} seats) at about ${kes(est.expectedKes)} per ${est.unit}.`
            : "I can raise an approval request for this movement and route it down your configured chain.",
          "The request carries the supporting travel-policy and contract clauses so approvers see the governing rules alongside the ask.",
          ctx.authenticated
            ? "Submit it below and it lands in the pending approvals queue immediately."
            : "Sign in to your corporate portal and I will submit it against your account.",
        ],
        action: ctx.authenticated
          ? undefined
          : {
              label: "Sign in to submit the approval",
              href: plannerHref(ctx, bookParams({ intent: "approval" }), "concierge-approval"),
            },
      };
    }

    case "handover":
      return {
        intent,
        slots,
        lines: ["A mobility consultant can take this over — share your routes and headcount and we respond within one business day."],
        action: { label: "Talk to a consultant", href: "#consultant" },
      };

    default: {
      // Fall back to the knowledge base before giving up on the question.
      const kb = answerFromKnowledge(text);
      if (kb) {
        return {
          intent: "policy",
          slots,
          knowledgeId: kb.article.id,
          citation: kb.citation,
          lines: kb.lines,
          action: kb.article.sourceHref
            ? {
                label: "Open the governing surface",
                href: portalEntryHref(kb.article.sourceHref, ctx.authenticated, "concierge-knowledge"),
              }
            : undefined,
        };
      }
      return {
        intent: "unknown",
        slots,
        lines: [
          "I can book shuttles, recommend a vehicle class, estimate cost, generate a quotation and answer policy, contract and fleet questions from the corporate knowledge base.",
          "Try: \"cost for 25 staff daily\", \"what documents activate our account\" or \"how does the approval chain escalate\".",
        ],
      };
    }
  }
}
