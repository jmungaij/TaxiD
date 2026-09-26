// Pure math for the driver profit simulator. No I/O, no React.

export interface PricingModel {
  category_slug: string;
  currency: string;
  base_fare: number;
  per_km: number;
  per_min: number;
  minimum_fare: number;
  booking_fee: number;
  commission_pct: number; // 0..1
}

export interface CityRule {
  category_slug: string;
  city: string;
  base_fare_override: number | null;
  per_km_override: number | null;
  per_min_override: number | null;
  minimum_fare_override: number | null;
  fuel_cost_per_km: number;
  maintenance_per_km: number;
  insurance_monthly: number;
  avg_trips_per_hour: number;
  avg_km_per_trip: number;
}

export interface SurgeRule {
  city: string;
  category_slug: string;
  hour_of_week: number; // 0..167
  multiplier: number;
}

export interface SimInputs {
  city: string;
  categorySlug: string;
  hoursPerDay: number;
  daysPerWeek: number;
  ownsVehicle: boolean; // false = rents/lease, true = fuel+maintenance+insurance fully theirs
  loanMonthly?: number;
}

export interface SimOutput {
  currency: string;
  perTrip: { gross: number; commission: number; net: number };
  perHour: { trips: number; gross: number; net: number; profit: number };
  perDay: { gross: number; commission: number; fuel: number; maintenance: number; insurance: number; tax: number; loan: number; netProfit: number };
  perWeek: { gross: number; netProfit: number };
  perMonth: { gross: number; netProfit: number };
  perYear: { gross: number; netProfit: number };
  effectiveSurge: number;
  assumptions: {
    tripsPerHour: number;
    kmPerTrip: number;
    minPerTrip: number;
    totRatePct: number;
    insuranceMonthly: number;
  };
}

const TOT_RATE = 0.03; // KRA Turnover Tax 3% on gross under ride-hailing
const WORK_DAYS_PER_MONTH = 4.33; // weeks/month
const MIN_PER_TRIP_DEFAULT = 18; // minutes per trip (door-to-door average urban Kenya)

export function resolveActiveSurge(rules: SurgeRule[], city: string, slug: string): number {
  // Effective surge across a typical driving schedule (peak windows weighted).
  // We average all surge multipliers for the (city, category) — fallback 1.0.
  const matched = rules.filter((r) => r.city === city && r.category_slug === slug);
  if (matched.length === 0) return 1.0;
  // Weight surge by typical "on-app" hours (08-22 weekdays + Fri/Sat nights).
  const peakHours = new Set<number>();
  for (let d = 0; d < 7; d++) {
    for (let h = 7; h < 22; h++) peakHours.add(d * 24 + h);
  }
  let sum = 0, n = 0;
  for (const r of matched) {
    if (peakHours.has(r.hour_of_week)) { sum += Number(r.multiplier); n++; }
  }
  return n > 0 ? sum / n : 1.0;
}

export function simulate(
  inputs: SimInputs,
  model: PricingModel,
  rule: CityRule,
  surge: number,
): SimOutput {
  const baseFare = rule.base_fare_override ?? model.base_fare;
  const perKm = rule.per_km_override ?? model.per_km;
  const perMin = rule.per_min_override ?? model.per_min;
  const minFare = rule.minimum_fare_override ?? model.minimum_fare;

  const tripsPerHour = Number(rule.avg_trips_per_hour) || 2;
  const kmPerTrip = Number(rule.avg_km_per_trip) || 6;
  const minPerTrip = MIN_PER_TRIP_DEFAULT;

  // Per-trip economics
  const rawFare = baseFare + perKm * kmPerTrip + perMin * minPerTrip;
  const surgedFare = Math.max(rawFare * surge, minFare);
  const grossPerTrip = surgedFare + model.booking_fee;
  const commissionPerTrip = grossPerTrip * Number(model.commission_pct);
  const netPerTrip = grossPerTrip - commissionPerTrip;

  // Hour / day
  const grossPerHour = grossPerTrip * tripsPerHour;
  const netPerHour = netPerTrip * tripsPerHour;
  const kmPerHour = kmPerTrip * tripsPerHour;

  const hours = inputs.hoursPerDay;
  const grossDay = grossPerHour * hours;
  const commissionDay = grossDay * Number(model.commission_pct);
  const fuelDay = inputs.ownsVehicle ? Number(rule.fuel_cost_per_km) * kmPerHour * hours : 0;
  const maintDay = inputs.ownsVehicle ? Number(rule.maintenance_per_km) * kmPerHour * hours : 0;
  const insuranceDay = inputs.ownsVehicle
    ? Number(rule.insurance_monthly) / (WORK_DAYS_PER_MONTH * inputs.daysPerWeek)
    : 0;
  const taxDay = grossDay * TOT_RATE;
  const loanDay = (inputs.loanMonthly ?? 0) / (WORK_DAYS_PER_MONTH * inputs.daysPerWeek);
  const netProfitDay = grossDay - commissionDay - fuelDay - maintDay - insuranceDay - taxDay - loanDay;
  const profitPerHour = hours > 0 ? netProfitDay / hours : 0;

  const grossWeek = grossDay * inputs.daysPerWeek;
  const profitWeek = netProfitDay * inputs.daysPerWeek;
  const grossMonth = grossWeek * WORK_DAYS_PER_MONTH;
  const profitMonth = profitWeek * WORK_DAYS_PER_MONTH;
  const grossYear = grossMonth * 12;
  const profitYear = profitMonth * 12;

  return {
    currency: model.currency,
    perTrip: { gross: grossPerTrip, commission: commissionPerTrip, net: netPerTrip },
    perHour: { trips: tripsPerHour, gross: grossPerHour, net: netPerHour, profit: profitPerHour },
    perDay: {
      gross: grossDay, commission: commissionDay, fuel: fuelDay,
      maintenance: maintDay, insurance: insuranceDay, tax: taxDay, loan: loanDay,
      netProfit: netProfitDay,
    },
    perWeek: { gross: grossWeek, netProfit: profitWeek },
    perMonth: { gross: grossMonth, netProfit: profitMonth },
    perYear: { gross: grossYear, netProfit: profitYear },
    effectiveSurge: surge,
    assumptions: {
      tripsPerHour, kmPerTrip, minPerTrip,
      totRatePct: TOT_RATE * 100,
      insuranceMonthly: Number(rule.insurance_monthly),
    },
  };
}

export function buildSurgeHeatmap(
  rules: SurgeRule[],
  city: string,
  slug: string,
): number[][] {
  // 7 rows (Mon..Sun) x 24 cols (00..23). Default 1.0.
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(1.0));
  for (const r of rules) {
    if (r.city !== city || r.category_slug !== slug) continue;
    const d = Math.floor(r.hour_of_week / 24);
    const h = r.hour_of_week % 24;
    if (d >= 0 && d < 7 && h >= 0 && h < 24) grid[d][h] = Number(r.multiplier);
  }
  return grid;
}
