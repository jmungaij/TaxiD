/**
 * PARTNER MESSAGING EXPERIMENT — A/B test over the economics frames.
 *
 * The four economic frames on /partners (customer, service, no-asset
 * fulfilment, margin) are the commercial argument of the whole page. Two
 * messaging variants are under test:
 *
 *   • `outcome`      — control. States the commercial outcome for the partner.
 *   • `operational`  — states the operating mechanic that produces the outcome.
 *
 * Assignment is deterministic from the visitor's existing analytics session id,
 * so a visitor sees one variant consistently, the assignment needs no storage
 * and no extra request, and every funnel event carries `variant` in its
 * metadata for the report at /staff/partners/funnel.
 *
 * Governance: variants change wording only. Neither variant states volumes,
 * rates, SLAs or guarantees, and neither promises a capability the platform
 * does not have.
 */
import { getSessionId } from "@/lib/cta";

export type FrameVariant = "outcome" | "operational";

export const FRAME_VARIANTS: FrameVariant[] = ["outcome", "operational"];

export const VARIANT_LABEL: Record<FrameVariant, string> = {
  outcome: "A — outcome-led",
  operational: "B — operations-led",
};

export const VARIANT_DESCRIPTION: Record<FrameVariant, string> = {
  outcome: "Frames each economic argument as the commercial outcome for the partner.",
  operational: "Frames each economic argument as the operating mechanic that produces it.",
};

/** Copy overrides for the `operational` variant, keyed by economics frame id. */
export const FRAME_COPY: Record<FrameVariant, Record<string, { t: string; d: string }>> = {
  outcome: {},
  operational: {
    acquire: {
      t: "Keep the customer relationship",
      d: "Your customer register, references and brand stay yours; SAFARID never becomes the relationship owner.",
    },
    services: {
      t: "One order surface, every service line",
      d: "Rides, charters, deliveries, logistics, rentals and leasing are placed as one partner order type.",
    },
    network: {
      t: "Allocate to verified supply",
      d: "Document-verified operators are matched to your order with the reasons for the match recorded.",
    },
    margin: {
      t: "Margin computed before confirmation",
      d: "Your margin is computed server-side from the contracted rate card and reconciled before settlement.",
    },
  },
};

/** Stable, dependency-free 32-bit string hash. */
function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic bucket for an explicit key — pure, so it is unit-testable. */
export function variantForKey(key: string): FrameVariant {
  return FRAME_VARIANTS[hash32(key) % FRAME_VARIANTS.length];
}

const isVariant = (v: string | null | undefined): v is FrameVariant =>
  FRAME_VARIANTS.includes((v ?? "") as FrameVariant);

/**
 * The variant this visitor is in. `?variant=` forces a bucket so the partner
 * desk and QA can review either arm of the test; anything unrecognised is
 * ignored and the deterministic assignment applies.
 */
export function currentFrameVariant(): FrameVariant {
  if (typeof window !== "undefined") {
    const forced = new URLSearchParams(window.location.search).get("variant");
    if (isVariant(forced)) return forced;
  }
  return variantForKey(getSessionId());
}

/** Frame copy for a variant, falling back to the control's own copy. */
export function frameCopy(
  variant: FrameVariant,
  frameId: string,
  control: { t: string; d: string },
): { t: string; d: string } {
  return FRAME_COPY[variant]?.[frameId] ?? control;
}
