/**
 * Company collateral (Documents OS) — the versioned register of published
 * company documents. The six-page enterprise company profile is the first
 * entry: it is published once, served from the CDN pointer committed to the
 * repository, and every employee download is logged.
 */
import { supabase } from "@/integrations/supabase/client";
import profileAsset from "@/assets/collateral/yalla-company-profile-6pp.pdf.asset.json";

export const COMPANY_PROFILE_SLUG = "company-profile";

/** Repository-committed pointer — the profile renders even before a DB read. */
export const COMPANY_PROFILE_FALLBACK = {
  slug: COMPANY_PROFILE_SLUG,
  title: "TaxiD — Enterprise Company Profile",
  version: "v1.0",
  description:
    "Six-page enterprise company profile: corporate identity, service ecosystem, corporate mobility, partners and future direction.",
  file_url: profileAsset.url,
  file_size: profileAsset.size,
  page_count: 6,
} as const;

export interface Collateral {
  id: string;
  slug: string;
  title: string;
  version: string;
  description: string | null;
  file_url: string;
  file_size: number | null;
  page_count: number | null;
  status: string;
  published_at: string | null;
  created_at: string;
}

/** Published collateral, newest first. Public read — no session required. */
export async function fetchPublishedCollateral(): Promise<Collateral[]> {
  const { data, error } = await supabase
    .from("company_collateral")
    .select("*")
    .eq("status", "published")
    .order("published_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as Collateral[];
}

/** Every version of one document (published + superseded), newest first. */
export async function fetchCollateralHistory(slug: string): Promise<Collateral[]> {
  const { data, error } = await supabase
    .from("company_collateral")
    .select("*")
    .eq("slug", slug)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as Collateral[];
}

/**
 * Records that a signed-in employee took a copy of a document. Best effort:
 * a failed log never blocks the download.
 */
export async function logCollateralDownload(
  collateralId: string,
  surface = "staff_documents",
): Promise<void> {
  try {
    await supabase.from("company_collateral_downloads").insert({
      collateral_id: collateralId,
      surface,
    });
  } catch {
    /* logging is advisory */
  }
}

export const formatFileSize = (bytes: number | null | undefined) =>
  !bytes ? "—" : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
