/**
 * PHASE 3 — RATE PLAN GOVERNANCE.
 *
 * Embedded, opaque pricing is rejected: it prevents historical reconstruction,
 * commercial audit, invoice reconciliation, dispute resolution and versioning.
 *
 * Persistence: RATE_PLAN → RATE_PLAN_VERSION → RATE_COMPONENT → RATE_RULE.
 * A priced transaction retains the exact rate_plan_version used, and
 * reconstructPrice() must reproduce the charged amount from stored parts alone.
 */

export type RateBasis =
  | "FLAT"
  | "PER_KM"
  | "PER_KG"
  | "PER_PACKAGE"
  | "PER_STOP"
  | "PERCENT_OF_BASE"
  | "MINIMUM_CHARGE"
  | "WEIGHT_BAND";

export type RateComponentKind = "BASE" | "SURCHARGE" | "DISCOUNT" | "TAX" | "MINIMUM";

export interface RateComponent {
  component_id: string;
  code: string;
  label: string;
  kind: RateComponentKind;
  basis: RateBasis;
  rate: number;
  /** Weight-band bounds (kg) when basis = WEIGHT_BAND. */
  band_from_kg?: number;
  band_to_kg?: number;
  sequence: number;
}

export interface RateRule {
  rule_id: string;
  /** Applies only when every predicate matches the pricing inputs. */
  predicate: Partial<{ service_level: string; vehicle_class: string; corporate_account_id: string; zone: string }>;
  applies_component_codes: string[];
  note: string;
}

export interface RatePlanVersion {
  rate_plan_id: string;
  version: number;
  status: "DRAFT" | "APPROVED" | "SUPERSEDED";
  effective_from: string;
  effective_to: string | null;
  approved_by: string | null;
  components: RateComponent[];
  rules: RateRule[];
  /** Immutable once APPROVED — enforced by trigger in the migration plan. */
  immutable: boolean;
}

export interface RatePlan {
  rate_plan_id: string;
  code: string;
  offering_code: string;
  currency: "KES";
  versions: RatePlanVersion[];
}

export interface PricingInputs {
  distance_km: number;
  billable_weight_kg: number;
  package_count: number;
  stop_count: number;
  service_level: string;
  vehicle_class: string;
  corporate_account_id?: string | null;
  zone?: string;
  tax_rate: number;
}

export interface PriceLine {
  code: string;
  label: string;
  kind: RateComponentKind;
  basis: RateBasis;
  amount_kes: number;
}

export interface PriceReconstruction {
  lines: PriceLine[];
  base_kes: number;
  surcharges_kes: number;
  discounts_kes: number;
  tax_kes: number;
  total_kes: number;
  rate_plan_id: string;
  rate_plan_version: number;
}

const ruleAllows = (version: RatePlanVersion, code: string, inputs: PricingInputs): boolean => {
  const relevant = version.rules.filter((r) => r.applies_component_codes.includes(code));
  if (relevant.length === 0) return true;
  return relevant.some((r) =>
    Object.entries(r.predicate).every(([k, v]) => (inputs as unknown as Record<string, unknown>)[k] === v),
  );
};

function componentAmount(c: RateComponent, inputs: PricingInputs, base: number): number {
  switch (c.basis) {
    case "FLAT":
      return c.rate;
    case "PER_KM":
      return c.rate * inputs.distance_km;
    case "PER_KG":
      return c.rate * inputs.billable_weight_kg;
    case "PER_PACKAGE":
      return c.rate * inputs.package_count;
    case "PER_STOP":
      return c.rate * inputs.stop_count;
    case "PERCENT_OF_BASE":
      return (c.rate / 100) * base;
    case "WEIGHT_BAND":
      return inputs.billable_weight_kg >= (c.band_from_kg ?? 0) &&
        inputs.billable_weight_kg <= (c.band_to_kg ?? Number.POSITIVE_INFINITY)
        ? c.rate
        : 0;
    case "MINIMUM_CHARGE":
    default:

      return 0;
  }
}

/**
 * Deterministically reconstructs a price from a stored rate-plan version.
 * Finance can therefore answer "why was shipment YM-1234 charged KES 486?".
 */
export function reconstructPrice(version: RatePlanVersion, inputs: PricingInputs): PriceReconstruction {
  const ordered = [...version.components].sort((a, b) => a.sequence - b.sequence);
  const lines: PriceLine[] = [];

  let base = 0;
  for (const c of ordered.filter((c) => c.kind === "BASE")) {
    if (!ruleAllows(version, c.code, inputs)) continue;
    const amount = round(componentAmount(c, inputs, base));
    base += amount;
    lines.push({ code: c.code, label: c.label, kind: c.kind, basis: c.basis, amount_kes: amount });
  }

  const minimum = ordered.find((c) => c.kind === "MINIMUM" || c.basis === "MINIMUM_CHARGE");
  if (minimum && base < minimum.rate) {
    const uplift = round(minimum.rate - base);
    base = minimum.rate;
    lines.push({ code: minimum.code, label: minimum.label, kind: "MINIMUM", basis: "MINIMUM_CHARGE", amount_kes: uplift });
  }

  let surcharges = 0;
  for (const c of ordered.filter((c) => c.kind === "SURCHARGE")) {
    if (!ruleAllows(version, c.code, inputs)) continue;
    const amount = round(componentAmount(c, inputs, base));
    surcharges += amount;
    lines.push({ code: c.code, label: c.label, kind: c.kind, basis: c.basis, amount_kes: amount });
  }

  let discounts = 0;
  for (const c of ordered.filter((c) => c.kind === "DISCOUNT")) {
    if (!ruleAllows(version, c.code, inputs)) continue;
    const amount = round(componentAmount(c, inputs, base));
    discounts += amount;
    lines.push({ code: c.code, label: c.label, kind: c.kind, basis: c.basis, amount_kes: -amount });
  }

  const taxable = base + surcharges - discounts;
  const tax = round(taxable * inputs.tax_rate);
  if (tax > 0) lines.push({ code: "VAT", label: "VAT", kind: "TAX", basis: "PERCENT_OF_BASE", amount_kes: tax });

  return {
    lines,
    base_kes: round(base),
    surcharges_kes: round(surcharges),
    discounts_kes: round(discounts),
    tax_kes: tax,
    total_kes: round(taxable + tax),
    rate_plan_id: version.rate_plan_id,
    rate_plan_version: version.version,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** An APPROVED version may never be edited; changes require a new version. */
export function versionMutationErrors(before: RatePlanVersion, after: RatePlanVersion): string[] {
  if (before.status !== "APPROVED") return [];
  const errors: string[] = [];
  if (JSON.stringify(before.components) !== JSON.stringify(after.components)) errors.push("components mutated on an APPROVED rate-plan version");
  if (JSON.stringify(before.rules) !== JSON.stringify(after.rules)) errors.push("rules mutated on an APPROVED rate-plan version");
  if (before.effective_from !== after.effective_from) errors.push("effective_from mutated on an APPROVED rate-plan version");
  return errors;
}

/** Version in force at a given instant; null when pricing is unavailable. */
export function versionInForce(plan: RatePlan, at: string): RatePlanVersion | null {
  const t = Date.parse(at);
  return (
    plan.versions.find(
      (v) =>
        v.status === "APPROVED" &&
        Date.parse(v.effective_from) <= t &&
        (v.effective_to === null || Date.parse(v.effective_to) > t),
    ) ?? null
  );
}
