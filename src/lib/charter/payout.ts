/**
 * Operator payout model.
 *
 * The customer sees a stacked price (base → operations → multipliers →
 * discounts → platform layers → VAT). The operator must see the *mirror* of
 * that stack: which layers are theirs, which are deducted, and what settles.
 * Both views are derived from the same `PriceBreakdown`, so a payout can never
 * drift from the price the customer was charged.
 */
import {
  computeCancellationPolicy, DEFAULT_GLOBAL_CONTROLS,
  type GlobalPricingControls, type PriceBreakdown,
} from "./aviationPricing";

export interface PayoutLine {
  label: string;
  amount: number;
  /** `credit` increases the payout, `debit` reduces it, `info` is contextual. */
  kind: "credit" | "debit" | "info";
  hint?: string;
}

export interface OperatorPayout {
  currency: "USD";
  /** Gross the customer paid, including tax. */
  customerPrice: number;
  /** Tax collected on behalf of the revenue authority — never operator revenue. */
  taxes: number;
  /** Net of tax — the commercial value of the booking. */
  netOfTax: number;
  /** The operator's earned revenue before platform deductions. */
  operatorRevenue: number;
  lines: PayoutLine[];
  /** Total platform deductions applied to the operator's revenue. */
  deductions: number;
  /** Amount that settles to the operator. */
  payoutAmount: number;
  /** Payout as a share of the customer price. */
  payoutSharePct: number;
  platformRevenue: number;
  platformSharePct: number;
  settlementDays: number;
  /** ISO date the payout is expected to settle. */
  settlementDate: string;
  /** Operator-side exposure if the customer cancels at each tier. */
  cancellationExposure: Array<{ label: string; window: string; retained: number; refunded: number }>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeOperatorPayout(
  breakdown: PriceBreakdown,
  controls: Partial<GlobalPricingControls> = {},
  opts: { bookedAt?: Date } = {},
): OperatorPayout {
  const cfg = { ...DEFAULT_GLOBAL_CONTROLS, ...controls };
  const netOfTax = r2(breakdown.customerPrice - breakdown.taxes);

  const lines: PayoutLine[] = [
    {
      label: `Base flight (${breakdown.time.billableHours.toFixed(2)}h @ ${breakdown.hourlyRate}/h)`,
      amount: breakdown.baseCost, kind: "credit",
      hint: "Operator hourly rate × billable time, mirrors the customer base layer.",
    },
    {
      label: "Operational charges recovered",
      amount: breakdown.operationalTotal, kind: "credit",
      hint: "Landing, navigation, handling, crew and airport charges.",
    },
  ];

  if (breakdown.multiplierEffect !== 1) {
    lines.push({
      label: `Demand & calendar uplift (×${breakdown.multiplierEffect.toFixed(2)})`,
      amount: r2((breakdown.baseCost + breakdown.operationalTotal) * (breakdown.multiplierEffect - 1)),
      kind: "credit",
      hint: breakdown.multipliers.map((m) => `${m.label} ×${m.amount}`).join(" · "),
    });
  }

  if (breakdown.discountTotal > 0) {
    lines.push({
      label: breakdown.emptyLeg
        ? `Discounts applied (incl. empty-leg ${breakdown.emptyLeg.pct}%)`
        : "Discounts applied",
      amount: -breakdown.discountTotal, kind: "debit",
      hint: breakdown.discounts.map((d) => `${d.label} −${d.amount}%`).join(" · "),
    });
  }

  const deductionLines: PayoutLine[] = [
    { label: "Platform commission", amount: -breakdown.platformCommission, kind: "debit", hint: "Clamped inside the governed margin band." },
    { label: "Technology fee", amount: -breakdown.technologyFee, kind: "debit", hint: "Flat per-booking platform fee, billed to the customer." },
    { label: "Payment processing", amount: -breakdown.paymentProcessing, kind: "debit" },
  ];
  if (breakdown.premiumServiceFee > 0) {
    deductionLines.push({ label: "Premium service fee", amount: -breakdown.premiumServiceFee, kind: "debit" });
  }
  if (breakdown.dynamicUpliftShare > 0) {
    deductionLines.push({
      label: "Dynamic uplift share", amount: -breakdown.dynamicUpliftShare, kind: "debit",
      hint: `Platform retains ${cfg.dynamicUpliftSharePct}% of price achieved above the operator minimum.`,
    });
  }

  // Fees are charged on top of operator revenue in the customer stack, so the
  // payout is operator revenue itself — deductions are shown for transparency.
  const deductions = r2(deductionLines.reduce((s, l) => s + Math.abs(l.amount), 0));
  const payoutAmount = r2(breakdown.operatorRevenue);

  const settlementDays = cfg.operatorPayoutDays;
  const base = opts.bookedAt ?? new Date();
  const settlementDate = new Date(base.getTime() + settlementDays * 86400000).toISOString();

  const policy = computeCancellationPolicy(breakdown.customerPrice, cfg);

  return {
    currency: "USD",
    customerPrice: breakdown.customerPrice,
    taxes: breakdown.taxes,
    netOfTax,
    operatorRevenue: breakdown.operatorRevenue,
    lines: [
      ...lines,
      { label: "Operator revenue", amount: breakdown.operatorRevenue, kind: "info", hint: "Subtotal earned by the operator before platform layers." },
      ...deductionLines,
      { label: "Taxes collected for remittance", amount: breakdown.taxes, kind: "info", hint: "Collected from the customer, remitted by the platform — not operator income." },
    ],
    deductions,
    payoutAmount,
    payoutSharePct: breakdown.customerPrice > 0 ? Math.round((payoutAmount / breakdown.customerPrice) * 1000) / 10 : 0,
    platformRevenue: breakdown.platformRevenue,
    platformSharePct: breakdown.marginPct,
    settlementDays,
    settlementDate,
    cancellationExposure: policy.tiers.map((t) => ({
      label: t.label,
      window: t.window,
      // The operator keeps their share of whatever the platform retains.
      retained: r2(t.feeAmount * (breakdown.customerPrice > 0 ? payoutAmount / breakdown.customerPrice : 0)),
      refunded: t.refundAmount,
    })),
  };
}
