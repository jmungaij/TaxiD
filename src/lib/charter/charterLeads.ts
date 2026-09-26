/**
 * Charter lead capture + quote-lead deep links.
 *
 * A qualified enquiry captured on the public marketplace is encoded into a
 * portal deep link so the Charter Business Portal pre-fills the mission, sector
 * details and contact/procurement identity. Nothing is retyped, so a lead can
 * never drift out of sync with the booking it becomes.
 */

export interface CharterLead {
  collection: string;
  categorySlug: string;
  missionType: string;
  origin: string;
  destination: string;
  passengers: number;
  startDate: string;
  departureTime: string;
  days: number;
  budgetKes: number;
  requirements: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  costCenter: string;
  approverTitle: string;
}

export const emptyLead = (categorySlug: string, collection = "executive"): CharterLead => ({
  collection,
  categorySlug,
  missionType: "",
  origin: "",
  destination: "",
  passengers: 0,
  startDate: "",
  departureTime: "",
  days: 1,
  budgetKes: 0,
  requirements: "",
  name: "",
  email: "",
  phone: "",
  company: "",
  costCenter: "",
  approverTitle: "",
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Field-level blockers, evaluated per wizard step (1-based). */
export function leadBlockers(lead: CharterLead, step?: number): Record<string, string> {
  const e: Record<string, string> = {};
  if (!step || step === 1) {
    if (!lead.missionType.trim()) e.missionType = "Tell us what this journey has to achieve.";
    if (lead.passengers < 1) e.passengers = "Enter how many people are travelling.";
  }
  if (!step || step === 2) {
    if (lead.origin.trim().length < 2) e.origin = "Enter the pickup city or venue.";
    if (lead.destination.trim().length < 2) e.destination = "Enter the destination.";
    if (!lead.startDate) e.startDate = "Select the departure date.";
    if (lead.days < 1) e.days = "Enter at least one operating day.";
  }
  if (!step || step === 3) {
    if (lead.name.trim().length < 3) e.name = "Enter your full name.";
    if (!EMAIL_RE.test(lead.email.trim())) e.email = "Enter a deliverable work email.";
    if (lead.company.trim().length < 2) e.company = "Enter the organisation this journey is for.";
  }
  return e;
}

export const leadReady = (lead: CharterLead) => Object.keys(leadBlockers(lead)).length === 0;

/** Human-readable enquiry body emailed to the charter desk. */
export function composeLeadMessage(lead: CharterLead): string {
  const lines = [
    `Mission: ${lead.missionType}`,
    `Collection: ${lead.collection}`,
    `Route: ${lead.origin} → ${lead.destination}`,
    `Departure: ${lead.startDate}${lead.departureTime ? ` at ${lead.departureTime}` : ""}`,
    `Duration: ${lead.days} operating day${lead.days > 1 ? "s" : ""}`,
    `Passengers: ${lead.passengers}`,
    lead.budgetKes > 0 ? `Indicative budget: KSh ${lead.budgetKes.toLocaleString("en-KE")}` : null,
    lead.costCenter ? `Cost centre: ${lead.costCenter}` : null,
    lead.approverTitle ? `Approving authority title: ${lead.approverTitle}` : null,
    lead.requirements.trim() ? `Special requirements / concierge: ${lead.requirements.trim()}` : null,
    `Organisation: ${lead.company}`,
    `Contact: ${lead.name} · ${lead.email}${lead.phone ? ` · ${lead.phone}` : ""}`,
  ].filter(Boolean);
  return lines.join("\n");
}

const PARAM_MAP: Array<[keyof CharterLead, string]> = [
  ["collection", "col"],
  ["categorySlug", "cat"],
  ["missionType", "mission"],
  ["origin", "from"],
  ["destination", "to"],
  ["passengers", "pax"],
  ["startDate", "date"],
  ["departureTime", "time"],
  ["days", "days"],
  ["budgetKes", "budget"],
  ["requirements", "notes"],
  ["name", "cname"],
  ["email", "cemail"],
  ["phone", "cphone"],
  ["company", "org"],
  ["costCenter", "cc"],
  ["approverTitle", "title"],
];

export function leadToParams(lead: CharterLead): URLSearchParams {
  const params = new URLSearchParams();
  for (const [field, key] of PARAM_MAP) {
    const value = lead[field];
    if (value === "" || value === 0 || value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  params.set("lead", "1");
  return params;
}

/** Deep link into the portal with the mission + procurement identity pre-filled. */
export function portalDeepLink(lead: CharterLead, tab = "missions"): string {
  const params = leadToParams(lead);
  params.set("tab", tab);
  return `/dashboard/charter/portal?${params.toString()}`;
}

/** Reads a quote-lead deep link back out of the portal URL. */
export function leadFromSearch(search: string): CharterLead | null {
  const params = new URLSearchParams(search);
  if (params.get("lead") !== "1") return null;
  const lead = emptyLead(params.get("cat") ?? "bus-charter", params.get("col") ?? "executive");
  for (const [field, key] of PARAM_MAP) {
    const raw = params.get(key);
    if (raw === null) continue;
    if (field === "passengers" || field === "days" || field === "budgetKes") {
      (lead[field] as number) = Number(raw) || 0;
    } else {
      (lead[field] as string) = raw;
    }
  }
  return lead;
}

/** Short mission label shown in the portal banner. */
export const leadHeadline = (lead: CharterLead) =>
  `${lead.missionType || "Charter mission"} · ${lead.origin || "?"} → ${lead.destination || "?"} · ${lead.passengers || 0} pax`;
