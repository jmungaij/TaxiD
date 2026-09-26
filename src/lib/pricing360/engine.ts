/**
 * Pricing 360 — deterministic pricing engine (client mirror).
 *
 * ONE algorithm governs every SAFARID price:
 *
 *   Base rate (published rate card line × quantity)
 *   ± Surcharges      (multiplier / percentage / fixed, on the BASE)
 *   + Fees            (percentage / fixed, on the ADJUSTED BASE)
 *   − Discounts       (server-resolved only, never client-supplied)
 *   + Taxes           (ONLY when explicitly configured — never implied)
 *   = Customer total
 *
 * This module is a behavioural mirror of `public.pricing360_calculate` and is
 * used for (a) instant admin simulator previews and (b) the golden regression
 * suite that proves the two implementations agree. The SERVER remains the
 * authoritative calculator for every customer-facing transaction: nothing here
 * is ever trusted as a transaction total.
 *
 * Determinism rule: given the same inputs, the same rate card lines and the
 * same published rule-set components, this function always returns the same
 * result. No clocks, no randomness, no ambient configuration.
 */
import type {
  DayType, PriceCalculationInput, PriceComponentLine, PriceResult,
  PricingComponent, PricingRuleSet, RateCard, RateLine,
} from "./types";

const round = (n: number) => Math.round(n);

function scopeMatches(component: PricingComponent, input: {
  dayType: DayType; serviceCode: string; categoryCode: string; scopeLabel: string;
}): boolean {
  const s = component.scope ?? {};
  if (s.day_type?.length && !s.day_type.includes(input.dayType)) return false;
  if (s.service_code?.length && !s.service_code.includes(input.serviceCode)) return false;
  if (s.category_code?.length && !s.category_code.includes(input.categoryCode)) return false;
  if (s.scope_label?.length && !s.scope_label.includes(input.scopeLabel)) return false;
  return true;
}

const byPriority = (a: PricingComponent, b: PricingComponent) =>
  a.priority - b.priority || a.code.localeCompare(b.code);

/**
 * Resolves the rate line for a request. Precedence: an exact scope match wins;
 * an empty requested scope falls back to the first published line. If nothing
 * matches we return null — the engine NEVER invents a price.
 */
export function resolveRateLine(lines: RateLine[], input: PriceCalculationInput): RateLine | null {
  const basis = input.pricing_basis ?? "per_day";
  const scope = input.scope_label ?? "";
  const candidates = lines.filter(
    (l) => l.service_code === input.service_code
      && l.category_code === input.category_code
      && l.pricing_basis === basis
      && (scope === "" || l.scope_label === scope),
  );
  if (!candidates.length) return null;
  return candidates.find((l) => l.scope_label === scope) ?? candidates[0];
}

export interface EngineContext {
  rateCard: RateCard | null;
  rateLines: RateLine[];
  ruleSet: PricingRuleSet | null;
  components: PricingComponent[];
}

export function calculatePrice(input: PriceCalculationInput, ctx: EngineContext): PriceResult {
  if (!input.service_code || !input.category_code) {
    return { status: "INVALID_INPUT", error: "service_code and category_code are required" };
  }
  if (!ctx.rateCard) {
    return {
      status: "NO_PUBLISHED_RATE_CARD",
      error: "Pricing configuration unavailable — manual pricing review required",
    };
  }

  const line = resolveRateLine(ctx.rateLines, input);
  if (!line) {
    return {
      status: "NO_VALID_RATE",
      error: "Pricing configuration unavailable — manual pricing review required",
      rate_card_version: ctx.rateCard.version,
      requested: {
        service_code: input.service_code,
        scope_label: input.scope_label ?? "",
        category_code: input.category_code,
        pricing_basis: input.pricing_basis ?? "per_day",
      },
    };
  }
  if (!ctx.ruleSet) {
    return {
      status: "PRICING_CONFIGURATION_ERROR",
      error: "No published commercial rule set is in force",
      rate_card_version: ctx.rateCard.version,
    };
  }

  const quantity = Math.max(1, input.quantity ?? 1);
  const dayType: DayType = input.day_type ?? "standard";
  const match = {
    dayType,
    serviceCode: input.service_code,
    categoryCode: input.category_code,
    scopeLabel: input.scope_label ?? line.scope_label,
  };
  const active = ctx.components.filter((c) => c.active && c.rule_set_id === ctx.ruleSet!.id);

  const base = round(line.amount * quantity);
  let adjusted = base;
  let fees = 0;
  let discounts = 0;
  let taxes = 0;
  let blocked = false;

  const components: PriceComponentLine[] = [{
    kind: "base",
    code: "base_rate",
    label: `${line.service_code} base rate`,
    calc: "fixed",
    amount: base,
    reason: `${quantity} × ${line.category_code} at ${line.currency} ${line.amount} per ${line.pricing_basis.replace("per_", "")}`,
    source: `rate_line:${line.id}`,
  }];

  /* 1 — Surcharges, on the base. */
  for (const c of active.filter((c) => c.kind === "surcharge").sort(byPriority)) {
    if (!scopeMatches(c, match)) continue;
    const amount = c.calc === "multiplier"
      ? round(base * c.value) - base
      : c.calc === "percentage" ? round((base * c.value) / 100) : round(c.value * quantity);
    if (amount === 0) continue;
    adjusted += amount;
    components.push({ kind: "surcharge", code: c.code, label: c.label, calc: c.calc, value: c.value, amount, reason: c.reason, source: `pricing_component:${c.id}` });
    if (!c.stackable) break;
  }

  /* 2 — Fees, on the adjusted base. */
  for (const c of active.filter((c) => c.kind === "fee").sort(byPriority)) {
    if (!scopeMatches(c, match)) continue;
    const basisAmount = c.basis === "base" ? base : adjusted;
    let amount = c.calc === "percentage" ? round((basisAmount * c.value) / 100) : round(c.value);
    if (c.max_amount != null) amount = Math.min(amount, c.max_amount);
    if (amount === 0) continue;
    fees += amount;
    components.push({ kind: "fee", code: c.code, label: c.label, calc: c.calc, value: c.value, amount, reason: c.reason, source: `pricing_component:${c.id}` });
  }

  /* 3 — Discounts. Server-resolved: a client-supplied amount is never used. */
  for (const c of active.filter((c) => c.kind === "discount").sort(byPriority)) {
    if (c.requires_code && (input.promo_code ?? "").toLowerCase() !== c.code.toLowerCase()) continue;
    if (!scopeMatches(c, match)) continue;
    const basisAmount = c.basis === "base" ? base : adjusted;
    let amount = c.calc === "percentage" ? round((basisAmount * c.value) / 100) : round(c.value);
    if (c.max_amount != null) amount = Math.min(amount, c.max_amount);
    if (amount <= 0) continue;
    discounts += amount;
    components.push({ kind: "discount", code: c.code, label: c.label, calc: c.calc, value: c.value, amount: -amount, reason: c.reason, source: `pricing_component:${c.id}` });
    if (!c.stackable) break;
  }

  /* 4 — Taxes. Nothing is added unless a tax component is configured. */
  for (const c of active.filter((c) => c.kind === "tax").sort(byPriority)) {
    if (!scopeMatches(c, match)) continue;
    const basisAmount = adjusted + fees - discounts;
    const amount = c.calc === "percentage" ? round((basisAmount * c.value) / 100) : round(c.value);
    if (amount === 0) continue;
    taxes += amount;
    components.push({ kind: "tax", code: c.code, label: c.label, calc: c.calc, value: c.value, amount, reason: c.reason, source: `pricing_component:${c.id}` });
  }

  const total = adjusted + fees - discounts + taxes;

  /* 5 — Floors. */
  for (const c of active.filter((c) => c.kind === "floor")) {
    if (c.min_amount != null && total < c.min_amount) blocked = true;
  }

  return {
    status: blocked ? "PRICE_FLOOR_BREACH" : "OK",
    currency: line.currency,
    base,
    adjusted_base: adjusted,
    fees_total: fees,
    discounts_total: discounts,
    taxes_total: taxes,
    total,
    components,
    included_distance_km: line.included_distance_km,
    included_distance_period: line.included_distance_period,
    rate_card_id: ctx.rateCard.id,
    rate_card_code: ctx.rateCard.code,
    rate_card_version: ctx.rateCard.version,
    rule_set_id: ctx.ruleSet.id,
    rule_set_version: ctx.ruleSet.version,
    effective_date: input.effective_date,
  };
}

/** Renders the calculation as an auditable, human-readable explanation. */
export function explainPrice(result: PriceResult): string[] {
  if (result.status !== "OK" && result.status !== "PRICE_FLOOR_BREACH") {
    return [result.error ?? result.status];
  }
  const lines = (result.components ?? []).map(
    (c) => `${c.label.padEnd(32)} ${c.amount < 0 ? "-" : ""}${result.currency} ${Math.abs(c.amount).toLocaleString()} — ${c.reason}`,
  );
  lines.push(`${"Customer total".padEnd(32)} ${result.currency} ${(result.total ?? 0).toLocaleString()}`);
  lines.push(`Rate card ${result.rate_card_version} · rules ${result.rule_set_version}`);
  return lines;
}
