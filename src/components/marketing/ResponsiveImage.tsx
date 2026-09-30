/**
 * ResponsiveImage — retina-crisp <picture> renderer for marketing photography.
 *
 * Build-time variants come from vite-imagetools (`?as=picture`), so the browser
 * picks AVIF → WebP → JPEG at the closest width for its DPR.
 *
 * Colour-orchestration contract (Executive Blue standard):
 *  • no opacity fades, no blur-up placeholders, no gradient scrims
 *  • intrinsic width/height are always emitted → zero layout shift
 */

export interface PictureSet {
  /** Format → srcset string, e.g. { avif: "...", webp: "...", jpeg: "..." } */
  sources: Record<string, string>;
  /** Fallback image plus intrinsic dimensions of the largest variant. */
  img: { src: string; w: number; h: number };
}

const FORMAT_ORDER = ["avif", "webp", "jpeg", "jpg", "png"];

interface ResponsiveImageProps {
  picture: PictureSet;
  alt: string;
  /** Sizes attribute — required for correct DPR selection. */
  sizes: string;
  className?: string;
  /** Above-the-fold images must be eager + high priority. */
  priority?: boolean;
}

export const ResponsiveImage = ({
  picture,
  alt,
  sizes,
  className,
  priority = false,
}: ResponsiveImageProps) => {
  const formats = Object.keys(picture.sources).sort(
    (a, b) => FORMAT_ORDER.indexOf(a) - FORMAT_ORDER.indexOf(b),
  );

  return (
    <picture>
      {formats.map((format) => (
        <source
          key={format}
          type={`image/${format === "jpg" ? "jpeg" : format}`}
          srcSet={picture.sources[format]}
          sizes={sizes}
        />
      ))}
      <img
        src={picture.img.src}
        alt={alt}
        width={picture.img.w}
        height={picture.img.h}
        sizes={sizes}
        loading={priority ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        {...({ fetchpriority: priority ? "high" : "auto" } as Record<string, string>)}
        className={className}
      />
    </picture>
  );
};
