/**
 * Brand token bridge — resolves design-system CSS variables for APIs that
 * cannot consume `hsl(var(--token))` (canvas, Google Maps symbols, print HTML,
 * chart libraries reading raw colour strings).
 *
 * This exists so no component ever hardcodes a hex value again.
 */
export type BrandTokenName =
  | "background"
  | "foreground"
  | "card"
  | "border"
  | "primary"
  | "primary-glow"
  | "accent"
  | "muted"
  | "muted-foreground"
  | "gold"
  | "titanium"
  | "titanium-silver"
  | "executive-sapphire"
  | "deep-executive-blue"
  | "premium-navy"
  | "mobility-blue"
  | "midnight-sapphire"
  | "executive-navy"
  | "ice-white"
  /* Executive Blue Spectrum v4.0 */
  | "executive-midnight"
  | "executive-blue"
  | "sapphire-blue"
  | "royal-azure"
  | "ice-blue"
  | "titanium-blue-grey"
  | "ai-accent"
  | "status-success"
  | "status-warning"
  | "status-danger"
  | "status-info"
  | "status-neutral"
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5"
  | "chart-6";

/** `hsl(var(--token))` — for CSS-capable contexts. */
export const token = (name: BrandTokenName, alpha?: number) =>
  alpha === undefined ? `hsl(var(--${name}))` : `hsl(var(--${name}) / ${alpha})`;

/** Resolved `hsl(h s% l%)` string — for canvas / map / print contexts. */
export function brandColor(name: BrandTokenName, alpha?: number): string {
  const fallback: Partial<Record<BrandTokenName, string>> = {
    foreground: "223 62% 13%",
    background: "211 100% 98%",
    card: "0 0% 100%",
    border: "218 41% 85%",
    primary: "225 76% 32%",
    "primary-glow": "221 83% 53%",
    "muted-foreground": "218 22% 40%",
    titanium: "218 20% 42%",
    "titanium-silver": "218 41% 85%",
    "executive-sapphire": "225 76% 32%",
    "mobility-blue": "221 83% 53%",
    "executive-midnight": "223 76% 18%",
    "executive-blue": "225 76% 32%",
    "sapphire-blue": "221 83% 53%",
    "royal-azure": "217 91% 60%",
    "ice-blue": "211 100% 96%",
    "titanium-blue-grey": "218 41% 85%",
    "status-success": "156 69% 36%",
    "status-info": "217 91% 48%",
    gold: "41 49% 57%",
    "ai-accent": "221 83% 47%",
  };
  let raw = fallback[name] ?? "218 20% 42%";
  if (typeof window !== "undefined" && typeof getComputedStyle === "function") {
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    if (v) raw = v;
  }
  return alpha === undefined ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`;
}


/** Executive tier ramp — sapphire → titanium → gold → orange, never ad-hoc. */
export const tierToken: Record<string, BrandTokenName> = {
  Bronze: "gold",
  Silver: "titanium",
  Gold: "gold",
  Platinum: "ai-accent",
  Diamond: "primary",
};

export const tierColor = (tier: string) => brandColor(tierToken[tier] ?? "titanium");
