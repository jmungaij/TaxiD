import { cn } from "@/lib/utils";
import yallaLogoInk from "@/assets/yalla-logo.png";
import yallaLogoLight from "@/assets/yalla-logo-light.png";
import yallaMark from "@/assets/yalla-mark.png";

/**
 * BrandLogo — single source of truth for the Yalla Mobility lockup.
 *
 * `ink`  — Executive Blue wordmark, for light / ice-blue surfaces.
 * `light`— Ice White wordmark, for Executive Blue, midnight and glass surfaces.
 * Both variants share the same orange mobility pin, so the brand mark reads
 * identically across the ecosystem.
 */
export type BrandLogoTone = "ink" | "light";
/** `lockup` = pin + wordmark; `mark` = the mobility pin alone (square). */
export type BrandLogoVariant = "lockup" | "mark";

const SOURCES: Record<BrandLogoTone, string> = {
  ink: yallaLogoInk,
  light: yallaLogoLight,
};

interface BrandLogoProps {
  tone?: BrandLogoTone;
  variant?: BrandLogoVariant;
  className?: string;
  /** Rendered as the accessible name; omit only for decorative duplicates. */
  alt?: string;
  priority?: boolean;
}

const BrandLogo = ({
  tone = "ink",
  variant = "lockup",
  className,
  alt = "Yalla Mobility — Move Smart. Book Yalla.",
  priority = false,
}: BrandLogoProps) => (
  <img
    src={variant === "mark" ? yallaMark : SOURCES[tone]}
    alt={alt}
    width={variant === "mark" ? 256 : 723}
    height={variant === "mark" ? 256 : 260}
    decoding="async"
    loading={priority ? "eager" : "lazy"}
    // React 18 does not map the camelCase prop; emit the DOM attribute directly.
    {...(priority ? { fetchpriority: "high" } : {})}

    data-brand-logo={variant === "mark" ? "mark" : tone}
    className={cn("w-auto object-contain", className)}
  />
);

export default BrandLogo;
