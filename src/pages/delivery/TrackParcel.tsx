/**
 * PUBLIC SHIPMENT TRACKING.
 *
 * Reads only what the `logistics-track` function is willing to publish:
 * redacted addresses, masked recipient, milestones and events. No courier
 * identity, no coordinates, no contact numbers, no proof-of-delivery images.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Circle, FileCheck2, Loader2, PackageSearch } from "lucide-react";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CONTACT } from "@/config/contact";
import { trackShipment, fetchProofOfDelivery, type PodResult, type TrackingResult } from "@/lib/logistics/booking/api";

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

const TrackParcel = () => {
  const [params, setParams] = useSearchParams();
  const [value, setValue] = useState(params.get("tracking") ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [pod, setPod] = useState<PodResult | null>(null);
  const [podLoading, setPodLoading] = useState(false);
  const [podError, setPodError] = useState<string | null>(null);

  const lookup = useCallback(async (tracking: string) => {
    const normalised = tracking.trim().toUpperCase();
    if (!normalised) return;
    setLoading(true);
    setResult(null);
    const response = await trackShipment(normalised);
    setResult(response);
    setPod(null);
    setPodError(null);
    setLoading(false);
  }, []);

  // POD is authorised server-side: only the sender, an authorised corporate
  // member, the assigned courier or staff receive the artefacts.
  const loadPod = useCallback(async () => {
    if (!result?.tracking_number) return;
    setPodLoading(true);
    setPodError(null);
    const outcome = await fetchProofOfDelivery(result.tracking_number);
    if ("error" in outcome && outcome.error) {
      setPodError(outcome.message ?? "Proof of delivery could not be retrieved.");
      setPod(null);
    } else {
      setPod(outcome as PodResult);
    }
    setPodLoading(false);
  }, [result?.tracking_number]);

  useEffect(() => {
    const initial = params.get("tracking");
    if (initial) void lookup(initial);
    // Only on first mount / when the query param changes.
  }, [params, lookup]);

  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-10">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Track a shipment</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Enter the tracking number from your booking confirmation. Tracking shows the milestones we have actually
            recorded — nothing is estimated into the timeline.
          </p>
        </div>
      </section>

      <section className="container mx-auto grid gap-6 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  setParams({ tracking: value.trim().toUpperCase() });
                  void lookup(value);
                }}
              >
                <div className="flex-1">
                  <Label htmlFor="tracking">Tracking number</Label>
                  <Input
                    id="tracking"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="YM1A2B3C4D5E"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <Button type="submit" disabled={loading || value.trim().length < 4}>
                  {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <PackageSearch className="mr-1 h-4 w-4" aria-hidden />}
                  Track
                </Button>
              </form>
            </CardContent>
          </Card>

          {result && !result.found && (
            <Alert variant="destructive">
              <AlertTitle>Not found</AlertTitle>
              <AlertDescription>
                {result.message ?? "We could not find that tracking number."} If you booked in the last few minutes, try
                again shortly, or contact {CONTACT.supportEmail}.
              </AlertDescription>
            </Alert>
          )}

          {result?.found && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-3">
                    <span className="font-mono">{result.tracking_number}</span>
                    <Badge>{(result.status ?? "").replace(/_/g, " ")}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
                  <Row label="Service" value={result.service ?? "—"} />
                  <Row label="Order" value={result.order_reference ?? "—"} />
                  <Row label="From" value={result.origin ?? "—"} />
                  <Row label="To" value={result.destination ?? "—"} />
                  <Row label="Recipient" value={result.recipient ?? "—"} />
                  <Row label="Booked" value={when(result.booked_at)} />
                  <Row label="Collected" value={when(result.collected_at)} />
                  <Row label="Delivered" value={when(result.delivered_at)} />
                  <p className="sm:col-span-2 pt-2 text-xs text-muted-foreground">{result.sla_qualifier}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Milestones</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-3">
                    {(result.milestones ?? []).map((m) => (
                      <li key={m.code} className="flex items-start gap-3">
                        {m.reached ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-[hsl(var(--status-success))]" aria-hidden />
                        ) : (
                          <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
                        )}
                        <div>
                          <p className={m.reached ? "text-sm font-medium" : "text-sm text-muted-foreground"}>{m.label}</p>
                          {m.at && <p className="text-xs text-muted-foreground">{when(m.at)}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>

              {(result.events ?? []).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recorded events</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {(result.events ?? []).map((e, i) => (
                        <li key={`${e.code}-${i}`} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
                          <span>
                            {e.code.replace(/_/g, " ")}
                            {e.note ? ` — ${e.note}` : ""}
                          </span>
                          <span className="text-muted-foreground">{when(e.at)}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <Alert>
                <FileCheck2 className="h-4 w-4" aria-hidden />
                <AlertTitle>Proof of delivery</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>
                    {result.proof_of_delivery_available
                      ? "Proof of delivery has been captured for this shipment."
                      : "Proof of delivery appears here once the courier captures it at handover."}
                  </p>
                  {result.proof_of_delivery_available && (
                    <div className="space-y-2">
                      <Button size="sm" variant="outline" onClick={() => void loadPod()} disabled={podLoading}>
                        {podLoading ? "Retrieving…" : "Retrieve proof of delivery"}
                      </Button>
                      {podError && <p className="text-sm text-destructive">{podError}</p>}
                      {pod?.available && (
                        <div className="space-y-1 rounded-md border p-3 text-sm">
                          <p>
                            Received by <strong>{pod.recipient_name ?? "recipient"}</strong>
                            {pod.captured_at ? ` on ${when(pod.captured_at)}` : ""}
                            {pod.otp_verified ? " · OTP verified" : ""}
                          </p>
                          {pod.notes && <p className="text-muted-foreground">{pod.notes}</p>}
                          <div className="flex flex-wrap gap-3">
                            {pod.signature_url && (
                              <a className="underline" href={pod.signature_url} target="_blank" rel="noreferrer">
                                View signature
                              </a>
                            )}
                            {pod.photo_url && (
                              <a className="underline" href={pod.photo_url} target="_blank" rel="noreferrer">
                                View handover photo
                              </a>
                            )}
                          </div>
                          {pod.integrity_hash && (
                            <p className="font-mono text-xs text-muted-foreground">integrity: {pod.integrity_hash.slice(0, 16)}…</p>
                          )}
                          <p className="text-xs text-muted-foreground">Links expire in {Math.round((pod.expires_in_seconds ?? 300) / 60)} minutes.</p>
                        </div>
                      )}
                      {pod && !pod.available && <p className="text-sm text-muted-foreground">{pod.message}</p>}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            </>
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Send something</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Book a parcel or courier job and get tracking numbers immediately.</p>
              <Button asChild size="sm">
                <Link to="/delivery/book">Book a delivery</Link>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Support</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>{CONTACT.phoneDisplay}</p>
              <p>{CONTACT.supportEmail}</p>
            </CardContent>
          </Card>
        </aside>
      </section>
    </MarketingLayout>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3 border-b py-1 last:border-0">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium">{value}</span>
  </div>
);

export default TrackParcel;
