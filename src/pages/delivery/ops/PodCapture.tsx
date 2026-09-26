import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Camera, PenLine, ClipboardCheck, Lock } from "lucide-react";
import { brandColor } from "@/lib/design/brandColor";

export default function PodCapture() {
  const { packageId } = useParams();
  const navigate = useNavigate();
  const sigRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [pkgInfo, setPkgInfo] = useState<{ tracking_number: string; order_id: string | null } | null>(null);
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!packageId) return;
    supabase
      .from("packages")
      .select("tracking_number, order_id, recipient_name")
      .eq("id", packageId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setPkgInfo({ tracking_number: data.tracking_number, order_id: data.order_id });
          setRecipient(data.recipient_name ?? "");
        }
      });
  }, [packageId]);

  // Signature pad
  useEffect(() => {
    const cvs = sigRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = brandColor("card");
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.strokeStyle = brandColor("foreground");
    ctx.lineWidth = 2;
    ctx.lineCap = "round";

    const pos = (e: MouseEvent | TouchEvent) => {
      const r = cvs.getBoundingClientRect();
      const p = "touches" in e ? e.touches[0] : (e as MouseEvent);
      return { x: p.clientX - r.left, y: p.clientY - r.top };
    };
    const start = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      drawingRef.current = true;
      const { x, y } = pos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };
    const move = (e: MouseEvent | TouchEvent) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      const { x, y } = pos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
    };
    const end = () => {
      drawingRef.current = false;
    };
    cvs.addEventListener("mousedown", start);
    cvs.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    cvs.addEventListener("touchstart", start);
    cvs.addEventListener("touchmove", move);
    cvs.addEventListener("touchend", end);
    return () => {
      cvs.removeEventListener("mousedown", start);
      cvs.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      cvs.removeEventListener("touchstart", start);
      cvs.removeEventListener("touchmove", move);
      cvs.removeEventListener("touchend", end);
    };
  }, []);

  const clearSig = () => {
    const cvs = sigRef.current;
    const ctx = cvs?.getContext("2d");
    if (!cvs || !ctx) return;
    ctx.fillStyle = brandColor("card");
    ctx.fillRect(0, 0, cvs.width, cvs.height);
  };

  const submit = async () => {
    if (!packageId || !pkgInfo) return;
    if (!recipient.trim()) {
      toast.error("Recipient name is required");
      return;
    }
    setSubmitting(true);
    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id;
    if (!userId) {
      toast.error("Sign in required");
      setSubmitting(false);
      return;
    }

    let photo_url: string | null = null;
    let signature_url: string | null = null;
    let image_sha256: string | null = null;

    try {
      if (photoFile) {
        // Compute SHA-256 of the raw file bytes for duplicate-image fraud detection.
        const buf = await photoFile.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", buf);
        image_sha256 = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        const path = `${userId}/pod/${packageId}/photo-${Date.now()}.jpg`;
        const { error } = await supabase.storage.from("delivery-documents").upload(path, photoFile, { upsert: false });
        if (error) throw error;
        photo_url = path;
      }
      // signature → blob
      const cvs = sigRef.current;
      if (cvs) {
        const blob: Blob | null = await new Promise((res) => cvs.toBlob((b) => res(b), "image/png"));
        if (blob) {
          const path = `${userId}/pod/${packageId}/sig-${Date.now()}.png`;
          const { error } = await supabase.storage.from("delivery-documents").upload(path, blob, { upsert: false, contentType: "image/png" });
          if (error) throw error;
          signature_url = path;
        }
      }

      // Geolocation (best-effort)
      let lat: number | null = null;
      let lng: number | null = null;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch { /* ignore */ }

      const { error: podErr } = await supabase.from("proof_of_delivery").insert({
        package_id: packageId,
        recipient_name: recipient.trim(),
        signature_url,
        photo_url,
        image_sha256,
        notes: notes.trim() || null,
        delivered_lat: lat,
        delivered_lng: lng,
      });
      if (podErr) throw podErr;


      const { error: pkgErr } = await supabase
        .from("packages")
        .update({ status: "delivered", delivered_at: new Date().toISOString() })
        .eq("id", packageId);
      if (pkgErr) throw pkgErr;

      const { error: evErr } = await supabase.from("package_events").insert({
        package_id: packageId,
        event_type: "delivered",
        actor_id: userId,
        location_lat: lat,
        location_lng: lng,
        notes: `POD captured: ${recipient.trim()}${notes ? " — " + notes : ""}`,
        metadata: { has_signature: !!signature_url, has_photo: !!photo_url },
      });
      if (evErr) throw evErr;

      toast.success("Proof of delivery recorded");
      navigate(`/delivery/ops/packages/${packageId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MarketingLayout>
      <section className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-8">
          <Link to={`/delivery/ops/packages/${packageId ?? ""}`} className="text-xs opacity-80 hover:underline">← Back to package</Link>
          <h1 className="text-2xl font-bold flex items-center gap-2 mt-1">
            <ClipboardCheck className="h-6 w-6" /> Capture proof of delivery
          </h1>
          {pkgInfo && <p className="text-sm opacity-90 font-mono">{pkgInfo.tracking_number}</p>}
        </div>
      </section>

      <section className="container mx-auto px-4 py-8 max-w-2xl space-y-5">
        <Card className="p-5 space-y-4">
          <div>
            <Label>Recipient name *</Label>
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} maxLength={120} />
          </div>

          <div>
            <Label className="flex items-center gap-1"><Camera className="h-4 w-4" /> Photo of parcel / recipient</Label>
            <Input type="file" accept="image/*" capture="environment" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
            {photoFile && <p className="text-xs text-muted-foreground mt-1">{photoFile.name} · {(photoFile.size / 1024).toFixed(0)} KB</p>}
          </div>

          <div>
            <Label className="flex items-center gap-1"><PenLine className="h-4 w-4" /> Signature</Label>
            <canvas
              ref={sigRef}
              width={520}
              height={160}
              className="w-full border rounded-md bg-ice touch-none"
            />
            <Button type="button" variant="ghost" size="sm" onClick={clearSig}>Clear signature</Button>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Left with concierge, ID checked…" />
          </div>

          <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground flex items-start gap-2">
            <Lock className="h-4 w-4 mt-0.5" />
            Once submitted, the POD record and lifecycle event are immutable — they cannot be edited or deleted.
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild><Link to={`/delivery/ops/packages/${packageId ?? ""}`}>Cancel</Link></Button>
            <Button onClick={submit} disabled={submitting}>{submitting ? "Submitting…" : "Submit POD & mark delivered"}</Button>
          </div>
        </Card>
      </section>
    </MarketingLayout>
  );
}
