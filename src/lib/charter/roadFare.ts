/**
 * Customer-facing fare presentation for road charter (bus, van, coach).
 *
 * Road charter quotes are presented with exactly three items:
 *   1. Booking fee   — vehicle, fuel and driver / co-driver cost, all in.
 *   2. Surcharge     — ×1.25, and only for vehicles booked at night or on Sunday.
 *   3. Marketplace Service — the configurable TaxiD platform service fee.
 *
 * Nothing else is shown; the operator cost drivers stay in the pricing engine.
 */
import { formatMoney, type CharterCategory } from "./catalog";
import {
  marketplaceServiceLabel,
  marketplaceServicePct,
} from "./marketplaceService";

/** Multiplier applied to the booking fee for night / Sunday departures. */
export const ROAD_SURCHARGE_MULTIPLIER = 1.25;
/** Night window (local time) that attracts the surcharge. */
export const ROAD_NIGHT_FROM_HOUR = 20;
export const ROAD_NIGHT_TO_HOUR = 6;

/**
 * Marketplace Service rate in force. Kept as a function (not a frozen const)
 * so the admin-configured rate is honoured at quote time.
 */
export const roadServicePct = marketplaceServicePct;
/** @deprecated Use `roadServicePct()` — retained for existing call sites. */
export const ROAD_COMMISSION_PCT = marketplaceServicePct();

/**
 * True when the departure falls on a Sunday, or at night (20:00–06:00).
 * A date without a time component is treated as a daytime departure.
 */
export function isSurchargeWindow(when?: string | null): boolean {
  if (!when) return false;
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return false;
  if (d.getDay() === 0) return true;
  if (!when.includes("T")) return false;
  const h = d.getHours();
  return h >= ROAD_NIGHT_FROM_HOUR || h < ROAD_NIGHT_TO_HOUR;
}

export interface RoadFare {
  /** Vehicle + fuel + driver & co-driver, all-in. */
  bookingFee: number;
  /** 1 or ROAD_SURCHARGE_MULTIPLIER. */
  surchargeMultiplier: number;
  /** Money value of the surcharge (0 when it does not apply). */
  surcharge: number;
  surchargeApplies: boolean;
  /** Marketplace Service fee (formerly "platform commission"). */
  commission: number;
  /** Rate used for the Marketplace Service fee, in percent. */
  servicePct: number;
  total: number;
  perUnit: number;
}

export function computeRoadFare(
  bookingFee: number,
  units = 1,
  when?: string | null,
): RoadFare {
  const fee = Math.max(0, Math.round(bookingFee));
  const surchargeApplies = isSurchargeWindow(when);
  const surchargeMultiplier = surchargeApplies ? ROAD_SURCHARGE_MULTIPLIER : 1;
  const surcharge = Math.round(fee * (surchargeMultiplier - 1));
  const servicePct = marketplaceServicePct();
  const commission = Math.round(((fee + surcharge) * servicePct) / 100);
  const total = fee + surcharge + commission;
  return {
    bookingFee: fee,
    surchargeMultiplier,
    surcharge,
    surchargeApplies,
    commission,
    servicePct,
    total,
    perUnit: Math.round(total / Math.max(1, units)),
  };
}

/** The three presentation lines, in order, for any road charter surface. */
export function roadFareLines(
  fare: RoadFare,
  currency: CharterCategory["currency"] = "KES",
): Array<{ label: string; value: string }> {
  return [
    { label: "Booking fee (vehicle, fuel, driver & co-driver)", value: formatMoney(fare.bookingFee, currency) },
    {
      label: `Night & Sunday surcharge (×${ROAD_SURCHARGE_MULTIPLIER})`,
      value: fare.surchargeApplies ? formatMoney(fare.surcharge, currency) : "Not applicable",
    },
    { label: marketplaceServiceLabel(fare.servicePct), value: formatMoney(fare.commission, currency) },
  ];
}
