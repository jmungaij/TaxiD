import * as Icons from "lucide-react";
import type { LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Brand Identity System v2.0 — standardized icon tones.
 * No random icon colours anywhere in the platform.
 */
export type IconTone =
  | "primary"     // Titanium — default, structural
  | "interactive" // Yalla Orange — actions, active state
  | "corporate"   // Midnight Sapphire / Executive Navy
  | "executive"   // Champagne Gold — VIP, Charter, Elite
  | "success"     // Emerald
  | "critical"    // Red
  | "inherit";

export const iconTone: Record<IconTone, string> = {
  primary: "text-muted-foreground",
  interactive: "text-primary",
  corporate: "text-primary",
  executive: "text-gold",
  success: "text-status-success",
  critical: "text-status-danger",
  inherit: "",
};

export function Icon({
  name,
  tone = "inherit",
  className,
  ...props
}: { name: string; tone?: IconTone } & LucideProps) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name];
  const cls = cn(iconTone[tone], className);
  if (!Cmp) return <Icons.Circle className={cls} {...props} />;
  return <Cmp className={cls} {...props} />;
}
