/**
 * BRAND ENTITY — Organization.sameAs
 *
 * `index.html` ships the canonical Organization node with `sameAs: []`. This
 * component extends that entity at runtime with ONLY verified, approved and
 * published social profiles. Nothing unverified ever enters structured data;
 * when nothing is published it emits nothing at all.
 */
import { Helmet } from "react-helmet-async";
import { useSocialAccounts } from "@/components/marketing/SocialLinks";

const ORG_ID = "https://yalla-africa.lovable.app/#organization";

export function SocialSameAs() {
  const accounts = useSocialAccounts();
  const sameAs = (accounts ?? [])
    .filter((a) => a.profile_url)
    .map((a) => a.profile_url as string);

  if (sameAs.length === 0) return null;

  return (
    <Helmet>
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          "@id": ORG_ID,
          name: "SAFARID",
          url: "https://yalla-africa.lovable.app",
          sameAs,
        })}
      </script>
    </Helmet>
  );
}

export default SocialSameAs;
