import { cn } from "@/lib/utils";
const taxiDLockup = "/taxid-lockup.png";
const taxiDMark = "/taxid-mark.png";

/**
 * BrandLogo — single source of truth for the TaxiD lockup.
 *
 * The supplied multicolour wordmark is used for both surface tones.
 */
export type BrandLogoTone = "ink" | "light";
/** `lockup` = pin + wordmark; `mark` = the mobility pin alone (square). */
export type BrandLogoVariant = "lockup" | "mark";

const SOURCES: Record<BrandLogoTone, string> = {
  ink: taxiDLockup,
  light: taxiDLockup,
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
  alt = "TaxiD — Move Smarter. Go Further.",
  priority = false,
}: BrandLogoProps) => (
  <img
    src={variant === "mark" ? taxiDMark : SOURCES[tone]}
    alt={alt}
    width={variant === "mark" ? 696 : 927}
    height={variant === "mark" ? 840 : 357}
    decoding="async"
    loading={priority ? "eager" : "lazy"}
    // React 18 does not map the camelCase prop; emit the DOM attribute directly.
    {...(priority ? { fetchpriority: "high" } : {})}

    data-brand-logo={variant === "mark" ? "mark" : tone}
    className={cn("w-auto object-contain", className)}
  />
);

export default BrandLogo;
