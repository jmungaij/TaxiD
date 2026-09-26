import { ReactNode } from "react";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { ResponsiveImage, type PictureSet } from "@/components/marketing/ResponsiveImage";
import { useHeroImagePreload } from "@/hooks/useHeroImagePreload";

interface PageHeroProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  /** Either a plain URL or a build-time responsive picture set. */
  image?: string | PictureSet;
  imageAlt?: string;
  /** sizes attribute used when `image` is a picture set. */
  imageSizes?: string;
}

const isPictureSet = (v: string | PictureSet): v is PictureSet =>
  typeof v === "object" && v !== null && "img" in v;

export const PageHero = ({ eyebrow, title, subtitle, children, image, imageAlt, imageSizes = "100vw" }: PageHeroProps) => {
  // LCP: start fetching the hero photograph in the same task as the first
  // render instead of after React commits the <picture> element.
  useHeroImagePreload(image && isPictureSet(image) ? image : undefined, imageSizes);

  return (
  <section className="relative overflow-hidden bg-primary text-primary-foreground">
    {image && (
      /* Solid, constant Executive Blue scrim — never a gradient, never a blur,
         and the photograph itself carries no opacity fade. */
      <div className="absolute inset-0 bg-primary">
        {isPictureSet(image) ? (
          <ResponsiveImage
            picture={image}
            alt={imageAlt ?? ""}
            sizes={imageSizes}
            priority
            className="h-full w-full object-cover object-center"
          />
        ) : (
          <img
            src={image}
            alt={imageAlt ?? ""}
            width={1920}
            height={1080}
            loading="eager"
            decoding="sync"
            fetchPriority="high"
            className="h-full w-full object-cover object-center"
          />
        )}
        <div className="absolute inset-0 bg-primary/80" />
      </div>
    )}
    <div className="relative container mx-auto px-4 py-20 md:py-28 max-w-4xl">
      {eyebrow && <span className="inline-block px-3 py-1 rounded-full bg-ice/20 text-xs font-semibold mb-4 uppercase tracking-wider">{eyebrow}</span>}
      <h1 className="text-4xl md:text-5xl font-bold mb-4">{title}</h1>
      {subtitle && <p className="text-lg text-primary-foreground/90 max-w-2xl">{subtitle}</p>}
      {children && <div className="mt-6">{children}</div>}
    </div>
    </section>
  );
};

export const MarketingPage = ({ children }: { children: ReactNode }) => (
  <MarketingLayout>{children}</MarketingLayout>
);
