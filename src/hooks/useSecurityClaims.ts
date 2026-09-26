import { useEffect, useState } from "react";
import { loadDisplayableClaims, type PublicClaim } from "@/lib/identity/plane";
import { TRUST_LINE } from "@/lib/security/publicClaims";

/**
 * Security statements a public surface is allowed to render.
 *
 * The list comes from the server-side claims register, which only returns
 * wording backed by a named control and passing evidence. Until it answers we
 * show the single conservative line held in the local register — never more.
 */
export function useSecurityClaims(surface?: string) {
  const [claims, setClaims] = useState<PublicClaim[] | null>(null);

  useEffect(() => {
    let live = true;
    void loadDisplayableClaims().then((rows) => {
      if (!live) return;
      setClaims(surface ? rows.filter((r) => !r.surface || r.surface === surface) : rows);
    });
    return () => {
      live = false;
    };
  }, [surface]);

  const wording = (claims ?? []).map((c) => c.wording).filter(Boolean) as string[];
  // Two statements is the most a footer line can carry without becoming noise.
  const trustLine = wording.length > 0 ? wording.slice(0, 2).join(" · ") : TRUST_LINE;
  return { claims: claims ?? [], wording, trustLine };
}
