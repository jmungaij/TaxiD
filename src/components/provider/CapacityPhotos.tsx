/**
 * Operator photo manager for one capacity listing. The operator uploads real
 * pictures of the vehicle offered; those exact pictures are what customers see
 * in marketplace search. Nothing is generated on their behalf.
 */
import * as React from "react";
import { Camera, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  MAX_CAPACITY_PHOTOS,
  explainPhotoRefusal,
  removeCapacityPhoto,
  setCapacityPhotos,
  signCapacityPhotos,
  uploadCapacityPhoto,
} from "@/lib/provider/photos";

interface Props {
  capacityId: string;
  paths: string[];
  editable: boolean;
  onChanged: () => void;
}

export function CapacityPhotos({ capacityId, paths, editable, onChanged }: Props) {
  const [urls, setUrls] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let live = true;
    void signCapacityPhotos(paths).then((u) => live && setUrls(u));
    return () => {
      live = false;
    };
  }, [paths.join("|")]);

  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_CAPACITY_PHOTOS - paths.length;
    if (room <= 0) {
      toast({ title: explainPhotoRefusal("TOO_MANY_PHOTOS"), variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        added.push(await uploadCapacityPhoto(capacityId, file));
      }
      await setCapacityPhotos(capacityId, [...paths, ...added]);
      toast({ title: `${added.length} photograph(s) added to this listing.` });
      onChanged();
    } catch (e) {
      toast({
        title: explainPhotoRefusal(e instanceof Error ? e.message : String(e)),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const drop = async (path: string) => {
    setBusy(true);
    try {
      await removeCapacityPhoto(capacityId, paths, path);
      toast({ title: "Photograph removed." });
      onChanged();
    } catch (e) {
      toast({
        title: explainPhotoRefusal(e instanceof Error ? e.message : String(e)),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Camera className="h-3.5 w-3.5" aria-hidden />
          Photographs ({paths.length}/{MAX_CAPACITY_PHOTOS})
        </span>
        {editable && (
          <>
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => void pick(e.target.files)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              Add photos
            </Button>
          </>
        )}
      </div>

      {paths.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No pictures yet. Customers see a listing without photographs as exactly that — add real
          pictures of this vehicle so they can browse it before booking.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {paths.map((p) => (
            <div key={p} className="relative h-20 w-28 overflow-hidden rounded-md border border-border">
              {urls[p] ? (
                <img src={urls[p]} alt="Vehicle photograph" className="h-20 w-28 object-cover" />
              ) : (
                <div className="h-20 w-28 animate-pulse bg-muted" />
              )}
              {editable && (
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  aria-label="Remove this photograph"
                  className="absolute right-1 top-1 h-6 w-6"
                  disabled={busy}
                  onClick={() => void drop(p)}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CapacityPhotos;
