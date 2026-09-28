import { Helmet } from "react-helmet-async";
import { useClaimRouteHead } from "./headClaim";

const SITE_URL = "https://taxid.lovable.app";
const SITE_NAME = "TaxiD";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-taxid-1200x630.png`;

export interface SeoHeadProps {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article";
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

export function SeoHead({ title, description, path, image = DEFAULT_OG_IMAGE, type = "website", jsonLd }: SeoHeadProps) {
  // This page owns its route's head metadata — RouteSEO stays silent here.
  useClaimRouteHead(path.startsWith("/") ? path : `/${path}`);
  const url = `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const fullTitle = title.length > 60 ? title.slice(0, 57) + "…" : title;
  const desc = description.length > 160 ? description.slice(0, 157) + "…" : description;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={url} />

      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE_NAME} />
      {image && <meta property="og:image" content={image} />}

      <meta name="twitter:card" content={image ? "summary_large_image" : "summary"} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
      {image && <meta name="twitter:image" content={image} />}

      {jsonLd && (
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      )}
    </Helmet>
  );
}
