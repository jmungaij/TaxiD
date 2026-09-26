/**
 * Photograph of the actual road vehicle booked — used on confirmation surfaces
 * in place of aviation imagery for bus, van and coach charters.
 */
import { vehicleImageFor } from "@/lib/charter/vehicleImages";

interface Props {
  assetName: string;
  spec?: string | null;
  caption?: string;
  className?: string;
}

export function VehicleImage({ assetName, spec, caption, className }: Props) {
  const src = vehicleImageFor(assetName, spec);
  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-xl border border-border">
        <img
          src={src}
          alt={`${assetName} — vehicle booked for this journey`}
          loading="lazy"
          className="h-56 w-full object-cover sm:h-72"
        />
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground">
        {caption ?? `${assetName} — the vehicle assigned to this booking`}
      </figcaption>
    </figure>
  );
}

export default VehicleImage;
