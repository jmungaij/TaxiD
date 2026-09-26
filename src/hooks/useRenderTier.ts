import { useEffect, useState } from "react";

/**
 * Adaptive rendering tier for cinematic surfaces.
 *
 *  full    — capable desktop: full parallax stack + pointer light field
 *  reduced — tablets / mid devices: fewer layers, no pointer field
 *  lite    — mobile, constrained devices, save-data or prefers-reduced-motion:
 *            static premium presentation. Functionality is never removed.
 *
 * Detection is done once per resize (no continuous work) so animation stays
 * frame-budget aware instead of relying on artificial FPS caps.
 */
export type RenderTier = "full" | "reduced" | "lite";

export interface RenderCapabilities {
  tier: RenderTier;
  /** prefers-reduced-motion: reduce */
  reducedMotion: boolean;
  /** fine pointer + hover, i.e. safe for the cursor light field */
  finePointer: boolean;
  /** convenience: no continuous motion should run */
  still: boolean;
}

function detect(): RenderCapabilities {
  if (typeof window === "undefined") {
    return { tier: "lite", reducedMotion: true, finePointer: false, still: true };
  }
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const width = window.innerWidth;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  const constrained =
    cores <= 4 || memory <= 4 || !!conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? "");

  let tier: RenderTier;
  if (reducedMotion || width < 768 || constrained) tier = "lite";
  else if (!finePointer || width < 1280) tier = "reduced";
  else tier = "full";

  return { tier, reducedMotion, finePointer: finePointer && tier === "full", still: tier === "lite" };
}

export function useRenderTier(): RenderCapabilities {
  const [caps, setCaps] = useState<RenderCapabilities>(() => ({
    tier: "lite",
    reducedMotion: true,
    finePointer: false,
    still: true,
  }));

  useEffect(() => {
    const apply = () => setCaps(detect());
    apply();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

  return caps;
}
