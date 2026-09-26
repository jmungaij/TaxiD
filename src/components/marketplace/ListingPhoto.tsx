/**
 * Listing photograph strip. Shows the pictures the operator actually uploaded
 * for that vehicle, or — for the governed charter fleet — the fleet photograph
 * of the vehicle class. When neither exists it says so instead of showing a
 * decorative stand-in.
 */
import * as React from "react";
import { Camera, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CapacityListing } from "@/lib/marketplace/search";

interface Props {
  listing: CapacityListing;
  /** Signed links keyed by stored path. */
  urls: Record<string, string>;
}

export function ListingPhoto({ listing, urls }: Props) {
  const gallery = listing.photoPaths.map((p) => urls[p]).filter(Boolean);
  const images = gallery.length > 0 ? gallery : listing.fleetImage ? [listing.fleetImage] : [];
  const [index, setIndex] = React.useState(0);

  if (images.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 rounded-t-lg border-b border-border bg-muted/40 text-xs text-muted-foreground">
        <Camera className="h-4 w-4" aria-hidden /> No photographs supplied yet
      </div>
    );
  }

  const shown = images[Math.min(index, images.length - 1)];

  return (
    <div className="relative h-40 overflow-hidden rounded-t-lg border-b border-border bg-muted">
      <img
        src={shown}
        alt={`${listing.name} operated by ${listing.operator}`}
        loading="lazy"
        className="h-40 w-full object-cover"
      />
      {images.length > 1 && (
        <>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Previous photograph"
            className="absolute left-2 top-1/2 h-7 w-7 -translate-y-1/2 opacity-90"
            onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Next photograph"
            className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 opacity-90"
            onClick={() => setIndex((i) => (i + 1) % images.length)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <span className="absolute bottom-2 right-2 rounded bg-background/85 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {Math.min(index, images.length - 1) + 1} / {images.length}
          </span>
        </>
      )}
    </div>
  );
}

export default ListingPhoto;
