/**
 * Trusted partners strip — organisations SAFARID works with across
 * mobility, technology and logistics. Presentation only: no claims beyond the
 * relationship itself, and no invented metrics.
 */
import royalPrince from "@/assets/partners/royal-prince.png";
import metroIct from "@/assets/partners/metro-ict.png";
import ehs from "@/assets/partners/ehs.png";
import gigLogistics from "@/assets/partners/gig-logistics.png";

type Partner = { name: string; note: string; logo?: string };

const PARTNERS: Partner[] = [
  { name: "Royal Prince", note: "Corporate & executive travel", logo: royalPrince },
  { name: "Metro ICT", note: "Technology partner", logo: metroIct },
  { name: "M-KOPA", note: "Asset financing", logo: undefined },
  { name: "EHS", note: "Logistics — Uganda", logo: ehs },
  { name: "GIG Logistics", note: "Logistics — Nigeria", logo: gigLogistics },
];

export function TrustedPartners() {
  return (
    <section aria-labelledby="trusted-partners" className="border-y border-border bg-secondary/20 py-14">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Trusted partners</p>
          <h2 id="trusted-partners" className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">
            Organisations working with SAFARID.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Mobility operators, technology providers and logistics businesses connect to SAFARID to
            reach customers, supply capacity and integrate their own systems.
          </p>
        </div>

        <ul className="mx-auto mt-10 grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {PARTNERS.map((p) => (
            <li
              key={p.name}
              className="flex h-28 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-center"
            >
              {p.logo ? (
                <img
                  src={p.logo}
                  alt={`${p.name} logo`}
                  loading="lazy"
                  decoding="async"
                  className="h-10 w-full max-w-[120px] object-contain"
                />
              ) : (
                <span className="text-base font-semibold tracking-tight text-primary">{p.name}</span>
              )}
              <span className="text-[11px] text-muted-foreground">{p.note}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default TrustedPartners;
