/**
 * Authoritative asset price for any booking surface.
 *
 * The browser submits the mission (category, hours, distance, passengers) and
 * the database returns the governed price with its full explanation. There is no
 * client-side fallback calculation: when the authority cannot price the request
 * the surface states why instead of showing a number nobody approved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ap360Quote, ap360SaveQuote, authoritativePrice, indicativePrice, AP360_STATUS_COPY, isPriced, type Ap360Quote, type Ap360QuoteInput, type Ap360SaveQuoteResult } from "@/lib/pricing360/ap360";
import { logPricingAction } from "@/lib/pricing360/audit";

export interface Ap360QuoteState {
  loading: boolean;
  quote: Ap360Quote | null;
  /** Customer-payable total, only when the authority produced one. */
  price: number | null;
  /** Non-binding estimate, when the authority offered one. Never payable. */
  indicative: number | null;
  priced: boolean;
  /** Plain-language reason a price is absent. */
  blockedReason: string | null;
  /** True when the outcome is "talk to us", not "we failed". */
  needsManualQuote: boolean;
  refresh: () => void;
  /**
   * Freezes the exact quote against a booking reference. Throws when the
   * authority refuses — an indicative-only or withheld price can never be
   * frozen, so the order total stays withheld.
   */
  freeze: (quoteRef: string) => Promise<Ap360SaveQuoteResult>;
}


export function useAp360Quote(input: Ap360QuoteInput | null, enabled = true): Ap360QuoteState {
  const key = JSON.stringify(input ?? {});
  const [state, setState] = useState<{ loading: boolean; quote: Ap360Quote | null; error: string | null }>({
    loading: false, quote: null, error: null,
  });
  const seq = useRef(0);
  const [nonce, setNonce] = useState(0);

  /** One audit row per distinct withheld outcome, not one per re-render. */
  const audited = useRef<string | null>(null);
  const recordWithheld = useCallback(
    (event: string, blockedReason: string, extra?: Record<string, unknown>) => {
      const fingerprint = `${key}|${event}|${blockedReason}`;
      if (audited.current === fingerprint) return;
      audited.current = fingerprint;
      void logPricingAction({
        action: "view",
        entity: "ap360_quote",
        // `entity_id` is a uuid column — the asset category belongs in the payload.
        entityId: null,
        rbac: "denied",
        reason: `ap360_quote withheld: ${event}`,
        context: {
          event,
          blockedReason,
          category_code: input?.category_code ?? null,
          priced: false,
          authoritative_price: null,
          ...(extra ?? {}),
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    if (!enabled || !input?.category_code) {
      setState({ loading: false, quote: null, error: null });
      return;
    }
    const token = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    void ap360Quote(input)
      .then((quote) => {
        if (seq.current !== token) return;
        setState({ loading: false, quote, error: null });
        if (!isPriced(quote)) {
          recordWithheld(
            quote?.status ?? "NO_QUOTE",
            quote?.message ?? quote?.error ?? (AP360_STATUS_COPY as Record<string, string>)[quote?.status ?? ""] ?? "No governed price is available.",
            {
              indicative_price: indicativePrice(quote),
              contract_violations: quote?.contract_violations ?? null,
            },
          );
        }
      })
      .catch((e: unknown) => {
        if (seq.current !== token) return;
        const message = e instanceof Error ? e.message : "Pricing authority unavailable — please request a manual quote.";
        setState({ loading: false, quote: null, error: message });
        recordWithheld("QUOTE_ERROR", message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, nonce]);


  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const freeze = useCallback(async (quoteRef: string) => {
    if (!input?.category_code) throw new Error("No pricing request to freeze");
    const saved = await ap360SaveQuote(input, quoteRef);
    if (!saved.saved) {
      const blocked = saved.blocked_reason ?? "The pricing authority withheld this price.";
      recordWithheld(saved.status ?? "SAVE_REFUSED", blocked, { quote_ref: quoteRef, stage: "freeze" });
      throw new Error(blocked);
    }
    return saved;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, recordWithheld]);

  return useMemo(() => {
    const q = state.quote;
    const priced = isPriced(q);
    return {
      loading: state.loading,
      quote: q,
      price: authoritativePrice(q),
      indicative: priced ? null : indicativePrice(q),
      priced,
      blockedReason: priced
        ? null
        : state.error ?? (q ? q.message ?? q.error ?? AP360_STATUS_COPY[q.status] ?? "No governed price is available." : null),
      needsManualQuote: !!state.error || (!!q && (q.status === "QUOTE_REQUIRED" || q.status === "PRICE_EXCEPTION_REQUIRED")),
      refresh,
      freeze,
    };
  }, [state, refresh, freeze]);

}
