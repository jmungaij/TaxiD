/**
 * Governed road charter price for the booking surface.
 *
 * The price is calculated by the server (`pricing360_calculate`). There is no
 * client-side fallback: if the governed configuration cannot price the request,
 * the surface must offer manual pricing review rather than show a number that no
 * rate card approved.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { calculatePriceServer } from "./api";
import { buildRoadPricingRequest, governedRoadFare, type GovernedRoadFare, type RoadPricingRequest, type RoadRequest } from "./roadCharter";
import { PRICE_STATUS_COPY, type PriceCalculationInput, type PriceResult } from "./types";

export interface RoadPriceState {
  loading: boolean;
  fare: GovernedRoadFare | null;
  result: PriceResult | null;
  /** Customer-safe explanation when no governed price exists. */
  blockedReason: string | null;
  /** True when the itinerary/vehicle is simply not on the published card. */
  needsManualPricing: boolean;
  /**
   * The exact request that produced `result`. Booking submission freezes this
   * into an immutable Pricing 360 snapshot keyed on the booking reference, so
   * every later total is read back from the snapshot rather than recomputed.
   */
  input: PriceCalculationInput | null;
}

export function useRoadCharterPrice(req: RoadRequest, enabled = true): RoadPriceState {
  const request = useMemo<RoadPricingRequest>(() => buildRoadPricingRequest(req), [
    req.assetName, req.origin, req.destination, req.duration, req.quantity, req.when, req.promoCode,
  ]);
  const [state, setState] = useState<RoadPriceState>({
    loading: false, fare: null, result: null, blockedReason: null, needsManualPricing: false, input: null,
  });
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, fare: null, result: null, blockedReason: null, needsManualPricing: false, input: null });
      return;
    }
    if (request.ok !== true) {
      const reason = "reason" in request ? request.reason : "Manual pricing review required.";
      setState({
        loading: false, fare: null, result: null,
        blockedReason: reason, needsManualPricing: true, input: null,
      });
      return;
    }
    const input = request.input;
    const token = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    void calculatePriceServer(input)
      .then((result) => {
        if (seq.current !== token) return;
        const units = Number(input.quantity ?? 1);
        const fare = governedRoadFare(result, units);
        setState({
          loading: false,
          fare,
          result,
          blockedReason: fare ? null : (result.error ?? PRICE_STATUS_COPY[result.status]),
          needsManualPricing: !fare && result.status !== "OK",
          input,
        });
      })
      .catch((e: unknown) => {
        if (seq.current !== token) return;
        setState({
          loading: false, fare: null, result: null,
          blockedReason: e instanceof Error ? e.message : "Pricing service unavailable — please request a manual quote.",
          needsManualPricing: true, input: null,
        });
      });
  }, [enabled, request]);

  return state;
}
