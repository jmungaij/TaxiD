/**
 * PARTNER INTENT ROUTER — "What do you bring to Yalla?"
 *
 * A prospective partner is routed by what they contribute before they are asked
 * to pick a category: demand (customers), supply (capacity) or technology
 * (integration). Everything downstream on /partners — which conversion tracks
 * are shown, which ecosystem tab opens, which maturity level is suggested and
 * what the application form is prefilled with — is derived from this one answer.
 *
 * Governance:
 *  • destinations are the validated /partners/apply route only,
 *  • category → taxonomy segment mapping is derived from the network registry,
 *    so marketing can never name a segment the taxonomy does not have,
 *  • no volumes, rates, SLAs or guarantees are stated here.
 */
import type { CommercialModel } from "@/lib/partners/api";
import { ECOSYSTEMS, type EcosystemKey } from "@/lib/partners/networkRegistry";
import { LIFECYCLE_IDS } from "@/lib/partners/workspaceLifecycle";

export type BringKey = "demand" | "supply" | "technology";
export type TrackKey = "distribution" | "supply" | "technology";

export interface BringOption {
  key: BringKey;
  /** The answer, in the partner's own words. */
  answer: string;
  /** Who this is. */
  who: string;
  /** What Yalla does with it. */
  lead: string;
  /** What the partner brings, in short operational phrases. */
  brings: string[];
  /** Application track carried in the query string. */
  track: TrackKey;
  /** Ecosystem tab this intent opens in "The network". */
  ecosystem: EcosystemKey;
  /** Landing-page conversion cards revealed for this intent. */
  trackKeys: string[];
  /** Where the ladder suggests starting. */
  suggestedLevel: string;
}

export const BRING_OPTIONS: BringOption[] = [
  {
    key: "demand",
    answer: "I bring customers",
    who: "Tour operators, DMCs, travel agencies, OTAs, hotels, corporates, retailers, couriers and event companies.",
    lead: "You own the customer relationship and the sale. Yalla supplies the movement, the commercial record and the settlement behind it.",
    brings: ["Customers", "Orders", "Your own brand"],
    track: "distribution",
    ecosystem: "distribution",
    trackKeys: ["distribution"],
    suggestedLevel: "book",
  },
  {
    key: "supply",
    answer: "I bring capacity",
    who: "Drivers, chauffeurs, fleet operators, rental companies, bus and coach operators, logistics providers, aircraft and marine operators.",
    lead: "You hold the vehicles, crews and licences. Yalla brings recorded demand, matching with stated reasons and reconciled settlement.",
    brings: ["Vehicles", "Crews", "Licences"],
    track: "supply",
    ecosystem: "supply",
    trackKeys: ["supply"],
    suggestedLevel: "manage",
  },
  {
    key: "technology",
    answer: "I bring technology reach",
    who: "Platforms, OTAs, ERPs and enterprises that want Yalla inside their own product or operated behind their brand.",
    lead: "You hold the digital surface your customers already use. Yalla exposes quoting, booking, documents and settlement behind it.",
    brings: ["A platform", "Developers", "Distribution scale"],
    track: "technology",
    ecosystem: "distribution",
    trackKeys: ["technology"],
    suggestedLevel: "api",
  },
];

export const BRING_KEYS = BRING_OPTIONS.map((b) => b.key);

export const findBring = (key: string | null | undefined): BringOption | undefined =>
  BRING_OPTIONS.find((b) => b.key === key);

/* -------------------------------------------------------- maturity levels */

export interface MaturityLevelMeta {
  id: string;
  label: string;
  model: CommercialModel;
  track: TrackKey;
}

export const MATURITY_LEVELS: MaturityLevelMeta[] = [
  { id: "refer", label: "Refer", model: "REFER", track: "distribution" },
  { id: "book", label: "Book", model: "BOOK", track: "distribution" },
  { id: "manage", label: "Manage", model: "ORCHESTRATE", track: "distribution" },
  { id: "embed", label: "Embed", model: "EMBED", track: "technology" },
  { id: "api", label: "API", model: "API", track: "technology" },
  { id: "orchestrate", label: "White label / Orchestrate", model: "WHITE_LABEL", track: "technology" },
];

export const findLevel = (id: string | null | undefined): MaturityLevelMeta | undefined =>
  MATURITY_LEVELS.find((l) => l.id === id);

/* ------------------------------------------------ category → taxonomy slug */

/**
 * Network category id → taxonomy segment slug, derived from the registry's own
 * segment destinations so the two can never drift apart.
 */
export const CATEGORY_SEGMENT: Record<string, string> = Object.fromEntries(
  ECOSYSTEMS.flatMap((eco) =>
    eco.categories
      .map((c) => [c.id, c.segmentTo?.replace(/^\/partners\//, "")] as const)
      .filter((pair): pair is readonly [string, string] => Boolean(pair[1])),
  ),
);

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  ECOSYSTEMS.flatMap((eco) => eco.categories.map((c) => [c.id, c.label])),
);

/* ------------------------------------------------------------ apply links */

export interface ApplyContext {
  bring?: string | null;
  /** Network category id. */
  cat?: string | null;
  /** Maturity level id. */
  level?: string | null;
  /** Workspace lifecycle stage id. */
  stage?: string | null;
  /** Explicit taxonomy segment slug, when the caller already knows it. */
  type?: string | null;
}

/**
 * Build the single canonical partner onboarding link. Only values that resolve
 * against the registries are carried forward — nothing unvalidated from a URL
 * ever reaches the application form.
 */
export function buildApplyLink(ctx: ApplyContext): string {
  const bring = findBring(ctx.bring);
  const level = findLevel(ctx.level);
  const cat = ctx.cat && CATEGORY_LABEL[ctx.cat] ? ctx.cat : undefined;
  const type = ctx.type ?? (cat ? CATEGORY_SEGMENT[cat] : undefined);

  const p = new URLSearchParams();
  // What the partner brings decides the desk; the maturity level only refines it.
  p.set("track", bring?.track ?? level?.track ?? "distribution");
  if (bring) p.set("bring", bring.key);
  if (type) p.set("type", type);
  if (cat) p.set("cat", cat);
  if (level) p.set("level", level.id);
  if (ctx.stage && LIFECYCLE_IDS.includes(ctx.stage)) p.set("stage", ctx.stage);
  return `/partners/apply?${p.toString()}`;
}
