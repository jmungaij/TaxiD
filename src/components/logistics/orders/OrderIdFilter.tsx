import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Camera, CameraOff, ScanLine, X } from "lucide-react";
import { describeIdFilter, MAX_IDS, parseOrderIds } from "@/lib/logistics/orders/idFilter";

interface Props {
  ids: string[];
  onChange: (ids: string[]) => void;
  /** Identifiers that were scanned/pasted but matched no order — surfaced, never dropped. */
  unmatched?: string[];
}

/**
 * Multi-identifier filter with continuous scanning.
 *
 * - Paste or type any mix of comma / newline / space separated identifiers.
 * - Hardware (HID keyboard-emulation) scanners work with no focus management:
 *   rapid keystrokes terminated by Enter/Tab are captured globally while
 *   scanning is armed.
 * - Camera scanning uses the native `BarcodeDetector` where the browser and
 *   camera permission allow it; the page is never reloaded per scan.
 */
export function OrderIdFilter({ ids, onChange, unmatched = [] }: Props) {
  const [draft, setDraft] = useState("");
  const [hidArmed, setHidArmed] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const admit = (input: string, source: "manual" | "scan") => {
    const parsed = parseOrderIds(input, idsRef.current, MAX_IDS);
    if (parsed.accepted.length) {
      onChange([...idsRef.current, ...parsed.accepted]);
      if (source === "scan") toast.success(`Scanned ${parsed.accepted.join(", ")}`);
    }
    if (parsed.duplicates.length) {
      toast.info(`Already in the filter: ${parsed.duplicates.slice(0, 3).join(", ")}`);
    }
    if (parsed.rejected.length) {
      toast.error(`Not a valid identifier: ${parsed.rejected.slice(0, 3).join(", ")}`);
    }
    if (parsed.truncated) toast.warning(`Filter is capped at ${MAX_IDS} identifiers.`);
    return parsed.accepted.length > 0;
  };

  // --- hardware scanner (HID keyboard emulation) --------------------------
  useEffect(() => {
    if (!hidArmed) return;
    let buffer = "";
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typingInField =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const now = Date.now();
      if (now - last > 120) buffer = ""; // human typing speed resets the buffer
      last = now;
      if (e.key === "Enter" || e.key === "Tab") {
        if (buffer.length >= 6) {
          e.preventDefault();
          admit(buffer, "scan");
        }
        buffer = "";
        return;
      }
      if (e.key.length === 1) {
        if (typingInField) return; // never hijack deliberate typing
        buffer += e.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidArmed]);

  // --- camera scanner -----------------------------------------------------
  useEffect(() => {
    if (!cameraOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const start = async () => {
      const Detector = (window as unknown as { BarcodeDetector?: new (o?: unknown) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      if (!Detector) {
        toast.error("This browser cannot scan with the camera. Use a hardware scanner or paste identifiers.");
        setCameraOn(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        const detector = new Detector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            for (const code of found) admit(code.rawValue, "scan");
          } catch {
            /* transient decode failures are expected between frames */
          }
          timer = window.setTimeout(tick, 350);
        };
        tick();
      } catch {
        toast.error("Camera permission denied. Use a hardware scanner or paste identifiers.");
        setCameraOn(false);
      }
    };
    start();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [cameraOn]);

  return (
    <Card className="space-y-3 border-border/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ScanLine className="h-4 w-4 text-muted-foreground" aria-hidden />
        <label htmlFor="order-id-filter" className="text-sm font-semibold">
          Order / package identifiers
        </label>
        <Badge variant="outline" className="text-[11px]">{describeIdFilter(ids)}</Badge>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={hidArmed ? "secondary" : "outline"}
            onClick={() => setHidArmed((v) => !v)}
            aria-pressed={hidArmed}
          >
            {hidArmed ? "Scanner armed" : "Scanner off"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setCameraOn((v) => !v)}>
            {cameraOn ? <CameraOff className="mr-1 h-3.5 w-3.5" /> : <Camera className="mr-1 h-3.5 w-3.5" />}
            {cameraOn ? "Stop camera" : "Camera scan"}
          </Button>
          {ids.length > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>
              Clear all
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="order-id-filter"
          value={draft}
          placeholder="ORD-1001, ORD-1002 — or scan labels continuously"
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text && /[\s,;|]/.test(text)) {
              e.preventDefault();
              if (admit(text, "manual")) setDraft("");
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (admit(draft, "manual")) setDraft("");
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={() => admit(draft, "manual") && setDraft("")}>
          Add
        </Button>
      </div>

      {cameraOn && (
        <video
          ref={videoRef}
          muted
          playsInline
          className="h-40 w-full rounded-md border border-border object-cover"
          aria-label="Camera barcode scanner preview"
        />
      )}

      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label="Active identifier filters">
          {ids.map((id) => (
            <Badge key={id} variant="secondary" role="listitem" className="gap-1 font-mono text-[11px]">
              {id}
              <button
                type="button"
                aria-label={`Remove ${id}`}
                className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onChange(ids.filter((x) => x !== id))}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {unmatched.length > 0 && (
        <p className="text-xs text-status-warning">
          Order not found: <span className="font-mono">{unmatched.join(", ")}</span>
        </p>
      )}
    </Card>
  );
}

export default OrderIdFilter;
