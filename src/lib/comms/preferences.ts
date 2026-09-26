/**
 * Recipient communication preferences.
 *
 * Security and receipt (transactional) mail is mandatory and cannot be
 * disabled — only optional categories are user-controlled. Writes go through
 * the `comms_set_category_preference` RPC, which scopes the change to the
 * signed-in user's own email address; the client never writes another
 * recipient's row.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

export const OPTIONAL_CATEGORIES = ["operational", "reports", "marketing", "internal"] as const;
export const MANDATORY_CATEGORIES = ["security", "transactional"] as const;

export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];

export interface CategoryDescriptor {
  key: OptionalCategory | (typeof MANDATORY_CATEGORIES)[number];
  label: string;
  description: string;
  mandatory: boolean;
}

export const CATEGORY_CATALOGUE: CategoryDescriptor[] = [
  {
    key: "security",
    label: "Security & account",
    description: "Sign-in alerts, password changes and access decisions. Always on.",
    mandatory: true,
  },
  {
    key: "transactional",
    label: "Bookings & receipts",
    description: "Trip confirmations, invoices, receipts and document requests. Always on.",
    mandatory: true,
  },
  {
    key: "operational",
    label: "Operational updates",
    description: "Driver assignment, schedule changes, delivery progress and service notices.",
    mandatory: false,
  },
  {
    key: "reports",
    label: "Reports & statements",
    description: "Periodic spend, utilisation and compliance summaries.",
    mandatory: false,
  },
  {
    key: "marketing",
    label: "Offers & product news",
    description: "New services, corporate offers and product announcements.",
    mandatory: false,
  },
  {
    key: "internal",
    label: "Internal staff notices",
    description: "Workforce, rota and internal operations bulletins (staff only).",
    mandatory: false,
  },
];

export type PreferenceMap = Record<string, boolean>;

/** Optional categories default to enabled when no explicit row exists. */
export async function fetchMyPreferences(email: string): Promise<PreferenceMap> {
  const map: PreferenceMap = {};
  for (const key of OPTIONAL_CATEGORIES) map[key] = true;

  const { data, error } = await untypedDb
    .from("email_category_prefs")
    .select("category, enabled")
    .eq("email", email.toLowerCase());
  if (error) throw error;

  for (const row of (data ?? []) as { category: string; enabled: boolean }[]) {
    map[row.category] = row.enabled;
  }
  return map;
}

export async function setMyPreference(
  category: OptionalCategory,
  enabled: boolean,
): Promise<void> {
  const { data, error } = await untypedDb.rpc("comms_set_category_preference", {
    p_category: category,
    p_enabled: enabled,
  });
  if (error) throw error;
  if (data && data.ok === false) throw new Error(String(data.reason ?? "preference refused"));
}
