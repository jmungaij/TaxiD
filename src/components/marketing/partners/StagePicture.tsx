/**
 * StagePicture — responsive <picture> with a branded failure state.
 *
 * If the network drops or a variant 404s, the frame degrades to an Executive
 * Blue plate carrying the TaxiD mark rather than a broken-image glyph, and the
 * surrounding section keeps working without imagery.
 */
import { useEffect, useState } from "react";
import { ResponsiveImage, type PictureSet } from "@/components/marketing/ResponsiveImage";

interface StagePictureProps {
  picture: PictureSet;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
}

export const StagePicture = ({ picture, alt, sizes, className, priority }: StagePictureProps) => {
  const [failed, setFailed] = useState(false);

  // A new source must get its own chance to load.
  useEffect(() => setFailed(false), [picture]);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex items-center justify-center bg-primary ${className ?? ""}`}
      >
        <span className="select-none text-xs font-semibold uppercase tracking-[0.32em] text-primary-foreground/70">
          TaxiD
        </span>
      </div>
    );
  }

  return (
    <div className={className} onErrorCapture={() => setFailed(true)}>
      <ResponsiveImage
        picture={picture}
        alt={alt}
        sizes={sizes}
        priority={priority}
        className="h-full w-full object-cover object-center"
      />
    </div>
  );
};
