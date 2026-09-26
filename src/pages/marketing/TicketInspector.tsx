/**
 * Digital ticket inspector.
 *
 * Every scan is verified against the `ticket-verify` edge function, which
 * checks the ticket's HMAC-SHA-256 signature against a server-held key. The
 * verification key never ships to this device, so a ticket cannot be
 * validated — or forged — from the browser bundle. Verdicts are queued
 * locally and synced whenever connectivity allows.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, CloudOff, Camera, RefreshCw, ShieldAlert, Wifi, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  listInspections,
  pendingCount,
  recordInspection,
  syncInspections,
  type InspectionRecord,
} from "@/lib/charter/inspectorQueue";

type Verdict = InspectionRecord["verdict"];

interface VerifiedTicket {
  serial: string;
  reference: string;
  passenger: string;
  route: string;
  departAt: string;
  vehicle: string;
  seat: string;
  fareKes: number;
}

interface Result {
  verdict: Verdict;
  ticket: VerifiedTicket | null;
  control: string | null;
  message: string;
}

export default function TicketInspector() {
  const { toast } = useToast();
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [queue, setQueue] = useState<InspectionRecord[]>([]);
  const [pending, setPending] = useState(0);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const refresh = useCallback(() => {
    setQueue(listInspections().slice(0, 12));
    setPending(pendingCount());
  }, []);

  useEffect(() => {
    refresh();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [refresh]);

  const sync = useCallback(async () => {
    const res = await syncInspections();
    refresh();
    toast({
      title: res.error ? "Sync failed" : `Synced ${res.synced} inspection${res.synced === 1 ? "" : "s"}`,
      description: res.error ?? "Audit trail is up to date.",
      variant: res.error ? "destructive" : "default",
    });
  }, [refresh, toast]);

  useEffect(() => {
    if (online && pending > 0) void syncInspections().then(refresh);
  }, [online, pending, refresh]);

  const check = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text || verifying) return;
      if (!online) {
        toast({
          title: "Connection required",
          description: "Ticket signatures are verified against SAFARID's secure signing service — reconnect to verify.",
          variant: "destructive",
        });
        return;
      }
      setVerifying(true);
      try {
        const { data, error } = await supabase.functions.invoke("ticket-verify", { body: { qr: text } });
        if (error) throw error;
        const verdict = (["VALID", "EXPIRED", "TAMPERED", "UNREADABLE"].includes(String(data?.verdict))
          ? data.verdict
          : "UNREADABLE") as Verdict;
        const r: Result = {
          verdict,
          ticket: (data?.ticket as VerifiedTicket | null) ?? null,
          control: (data?.control as string | null) ?? null,
          message: String(data?.inspectorMessage ?? "No verdict returned."),
        };
        setResult(r);
        recordInspection({
          serial: r.ticket?.serial ?? null,
          reference: r.ticket?.reference ?? null,
          control: r.control,
          verdict: r.verdict,
          scannedAt: new Date().toISOString(),
          inspector: "device",
          deviceOnline: true,
        });
        refresh();
      } catch (e) {
        toast({
          title: "Verification failed",
          description: e instanceof Error ? e.message : "The verification service could not be reached.",
          variant: "destructive",
        });
      } finally {
        setVerifying(false);
      }
    },
    [online, refresh, toast, verifying],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) {
      toast({ title: "Camera scanning unavailable", description: "Paste the QR text below instead." });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setScanning(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new Detector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes[0]?.rawValue) {
            void check(codes[0].rawValue);
            stopCamera();
            return;
          }
        } catch {
          /* keep scanning */
        }
        requestAnimationFrame(() => void tick());
      };
      void tick();
    } catch {
      toast({ title: "Camera permission denied", variant: "destructive" });
      stopCamera();
    }
  }, [check, stopCamera, toast]);

  useEffect(() => stopCamera, [stopCamera]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Helmet>
        <title>Ticket Inspector | SAFARID</title>
        <meta
          name="description"
          content="Scan a SAFARID digital bus ticket QR and verify its server-issued cryptographic signature against SAFARID's secure verification service."
        />
        <link rel="canonical" href="https://www.safarid.org/inspect" />
        <meta property="og:image" content="https://yalla-africa.lovable.app/og-safarid-1200x630.v1.png" />
        <meta name="twitter:image" content="https://yalla-africa.lovable.app/og-safarid-1200x630.v1.png" />
      </Helmet>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ticket inspector</h1>
          <p className="text-sm text-muted-foreground">
            Every scan is verified against SAFARID's secure signing service. Verdicts sync automatically.
          </p>
        </div>
        <Badge variant="outline" className="gap-1">
          {online ? <Wifi className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
          {online ? "Online" : "Offline"} · {pending} queued
        </Badge>
      </header>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => (scanning ? stopCamera() : void startCamera())}>
              <Camera className="mr-2 h-4 w-4" /> {scanning ? "Stop camera" : "Scan QR"}
            </Button>
            <Button variant="outline" onClick={() => void sync()} disabled={!online || pending === 0}>
              <RefreshCw className="mr-2 h-4 w-4" /> Sync audit trail
            </Button>
          </div>

          {scanning && (
            <video ref={videoRef} className="w-full rounded-lg border border-border" muted playsInline />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="qr-input">Or paste the QR payload</Label>
            <div className="flex gap-2">
              <Input id="qr-input" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="YBT2:…" />
              <Button onClick={() => void check(raw)} disabled={!raw.trim() || verifying || !online}>
                {verifying ? "Verifying…" : "Verify"}
              </Button>
            </div>
          </div>

          {result && (
            <div
              className={`rounded-lg p-4 ${
                result.verdict === "VALID"
                  ? "bg-primary/10 text-primary"
                  : result.verdict === "EXPIRED"
                    ? "bg-muted text-foreground"
                    : "bg-destructive/10 text-destructive"
              }`}
            >
              <p className="flex items-center gap-2 text-sm font-semibold">
                {result.verdict === "VALID" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : result.verdict === "EXPIRED" ? (
                  <ShieldAlert className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {result.verdict}
              </p>
              <p className="mt-1 text-xs">{result.message}</p>
              {result.ticket && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {result.ticket.serial} · control {result.control ?? "—"} · {result.ticket.vehicle} ·{" "}
                  {new Date(result.ticket.departAt).toLocaleString("en-KE")}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Recent inspections</h2>
        <div className="space-y-1">
          {queue.length === 0 && <p className="text-xs text-muted-foreground">No scans on this device yet.</p>}
          {queue.map((q) => (
            <div key={q.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs">
              <span className="text-foreground">{q.serial ?? "Unreadable QR"}</span>
              <span className="text-muted-foreground">
                {q.verdict} · {new Date(q.scannedAt).toLocaleTimeString("en-KE")} · {q.synced ? "synced" : "queued"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
