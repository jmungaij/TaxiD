/**
 * SAFARID® — Enterprise Design Contract (Phase 11)
 * -------------------------------------------------------
 * Single machine-readable source of truth for the Design Intelligence Layer.
 * Consumed by:
 *  - <Surface />, <BrandContext /> (runtime presentation)
 *  - scripts/brand-intelligence.ts (build-time governance audit)
 *  - /dashboard/admin/brand-governance (living governance dashboard)
 *
 * Presentation-only. No business logic.
 */

/* ---------------- Surface hierarchy ---------------- */
export const SURFACE_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type SurfaceLevel = (typeof SURFACE_LEVELS)[number];

export const surfaceRole: Record<SurfaceLevel, string> = {
  0: "Page foundation",
  1: "Navigation and rails",
  2: "Content panels",
  3: "Interactive cards",
  4: "Glass overlays",
  5: "Modal dialogs",
};

export const surfaceClass: Record<SurfaceLevel, string> = {
  0: "surface-0",
  1: "surface-1",
  2: "surface-2",
  3: "surface-3",
  4: "surface-4",
  5: "surface-5",
};

/* ---------------- Contextual colour intelligence ---------------- */
export const BRAND_CONTEXTS = [
  "corporate",
  "operations",
  "executive",
  "delivery",
  "analytics",
  "neutral",
] as const;
export type BrandContextName = (typeof BRAND_CONTEXTS)[number];

export const contextIntent: Record<BrandContextName, string> = {
  corporate: "Midnight Sapphire dominant — governance and trust",
  operations: "Titanium dominant — instrumentation and control",
  executive: "Executive Gold signalling — charter, VIP, elite",
  delivery: "Marginally warmer — movement and velocity",
  analytics: "Neutral — data reads before chrome",
  neutral: "Platform default",
};

/* ---------------- Enterprise motion grammar ---------------- */
export const MOTION_CATEGORIES = [
  "arrival",
  "focus",
  "confirmation",
  "navigation",
  "loading",
  "success",
  "error",
  "transition",
] as const;
export type MotionCategory = (typeof MOTION_CATEGORIES)[number];

export const motionClass: Record<MotionCategory, string> = {
  arrival: "motion-arrival",
  focus: "motion-focus",
  confirmation: "motion-confirmation",
  navigation: "motion-navigation",
  loading: "motion-loading",
  success: "motion-success",
  error: "motion-error",
  transition: "motion-transition",
};

/* ---------------- Visual hierarchy engine ---------------- */
export const HIERARCHY_ORDER = [
  "headline",
  "purpose",
  "primary-action",
  "supporting",
  "analytics",
  "secondary-actions",
  "footer",
] as const;
export type HierarchySlot = (typeof HIERARCHY_ORDER)[number];

/* ---------------- Density thresholds ---------------- */
export interface DensityThresholds {
  maxCardsPerScreen: number;
  maxPrimaryActionsPerScreen: number;
  maxChartsPerScreen: number;
  minWhitespaceRatio: number;
  maxTextBlockChars: number;
}

export const densityThresholds: DensityThresholds = {
  maxCardsPerScreen: 14,
  maxPrimaryActionsPerScreen: 2,
  maxChartsPerScreen: 6,
  minWhitespaceRatio: 0.32,
  maxTextBlockChars: 900,
};

/* ---------------- Photography governance ---------------- */
export const photographyRules = [
  "Natural daylight only — no synthetic rim lighting",
  "Real people, real vehicles, authentic operations",
  "No exaggerated HDR or clarity halos",
  "Consistent 35–50mm lens character",
  "One colour grade: neutral highlights, sapphire shadows",
  "Served as AVIF/WebP with an LCP-safe poster",
] as const;

/* ---------------- Governance release gates ---------------- */
export const releaseGates = {
  brandHealth: 98,
  accessibility: 95,
  performance: 95,
  tokenCompliance: 100,
  visualRegressions: 0,
  maxP0P1Defects: 0,
} as const;

/* ---------------- Banned visual constructs ---------------- */
export const bannedPatterns: { id: string; pattern: RegExp; severity: "P0" | "P1" | "P2"; reason: string }[] = [
  { id: "hardcoded-hex", pattern: /#[0-9a-fA-F]{3,8}\b/, severity: "P1", reason: "Hardcoded hex bypasses design tokens" },
  { id: "banned-purple", pattern: /\b(?:bg|text|from|to|via|border)-(?:purple|violet|fuchsia|indigo)-\d{2,3}\b/, severity: "P0", reason: "Purple was eliminated platform-wide (BR-03)" },
  { id: "raw-white-black", pattern: /\b(?:bg|text)-(?:white|black)\b/, severity: "P2", reason: "Use semantic tokens so dark mode and theming hold" },
  { id: "tailwind-palette", pattern: /\b(?:bg|text|border)-(?:gray|slate|zinc|neutral|stone|blue|green|red|amber|orange|teal|cyan|emerald|rose|pink|lime|sky)-\d{2,3}\b/, severity: "P1", reason: "Tailwind default palette bypasses the brand palette" },
  { id: "orange-large-surface", pattern: /\b(?:from|via|to)-accent\b/, severity: "P1", reason: "Orange is interaction-only; large surfaces must be sapphire/navy" },
  { id: "bounce-hover", pattern: new RegExp("hover:-translate-y" + "-"), severity: "P2", reason: "Motion must be calm — elevation and border only (BR-09)" },
];
