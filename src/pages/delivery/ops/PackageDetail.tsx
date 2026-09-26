import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  CheckCircle2,
  Circle,
  Truck,
  PackageCheck,
  RotateCcw,
  XCircle,
  ClipboardCheck,
  Lock,
} from "lucide-react";

interface Pkg {
  id: string;
  tracking_number: string;
  status: string;
  recipient_name: string | null;
  recipient_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  assigned_driver_id: string | null;
  created_at: string;
}
interface Evt {
  id: string;
  event_type: string;
  notes: string | null;
  occurred_at: string;
  actor_id: string | null;
}

const LIFECYCLE = ["accepted", "picked_up", "in_transit", "delivered"] as const;
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  created: Circle,
  accepted: CheckCircle2,
  picked_up: PackageCheck,
  in_transit: Truck,
  delivered: CheckCircle2,
  returned: RotateCcw,
  cancelled: XCircle,
};

export default function PackageDetail() {
  const { id } = useParams();
  const [pkg, setPkg] = useState<Pkg | null>(null);
  const [events, setEvents] = useState<Evt[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const [p, e] = await Promise.all([
      supabase.from("packages").select("*").eq("id", id).maybeSingle(),
      supabase.from("package_events").select("*").eq("package_id", id).order("occurred_at", { ascending: true }),
    ]);
    if (p.error) toast.error("Failed to load package");
    setPkg((p.data as Pkg) ?? null);
    setEvents((e.data as Evt[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [id]);

  const transition = async (next: string) => {
    if (!pkg) return;
    setBusy(true);
    const { data: user } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const patch: {
      status: string;
      picked_up_at?: string;
      delivered_at?: string;
      cancelled_at?: string;
      cancellation_reason?: string;
    } = { status: next };
    if (next === "picked_up") patch.picked_up_at = now;
    if (next === "delivered") patch.delivered_at = now;
    if (next === "cancelled") {
      patch.cancelled_at = now;
      patch.cancellation_reason = note || "Cancelled by operator";
    }
    const { error: uerr } = await supabase.from("packages").update(patch).eq("id", pkg.id);
    if (uerr) {
      toast.error(uerr.message);
      setBusy(false);
      return;
    }
    const { error: eerr } = await supabase.from("package_events").insert({
      package_id: pkg.id,
      event_type: next,
      actor_id: user.user?.id,
      notes: note || null,
    });
    if (eerr) toast.error(eerr.message);
    else toast.success(`Marked as ${next.replace("_", " ")}`);
    setNote("");
    setBusy(false);
    load();
  };

  if (loading) return <MarketingLayout><div className="container mx-auto p-10 text-sm text-muted-foreground">Loading…</div></MarketingLayout>;
  if (!pkg) return <MarketingLayout><div className="container mx-auto p-10">Package not found.</div></MarketingLayout>;

  const stageIndex = LIFECYCLE.indexOf(pkg.status as typeof LIFECYCLE[number]);
  const terminal = pkg.status === "delivered" || pkg.status === "cancelled" || pkg.status === "returned";

  return (
    <MarketingLayout>
      <section className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-8">
          <Link to="/delivery/ops/packages" className="text-xs opacity-80 hover:underline">← Packages</Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold font-mono">{pkg.tracking_number}</h1>
            <Badge variant="secondary">{pkg.status.replace("_", " ")}</Badge>
          </div>
          <p className="opacity-90 text-sm mt-1">
            {pkg.pickup_address} → {pkg.dropoff_address} · Recipient: {pkg.recipient_name ?? "—"}
          </p>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
        {/* Lifecycle stepper */}
        <Card className="p-5">
          <h2 className="font-semibold mb-4">Lifecycle</h2>
          <div className="grid grid-cols-4 gap-2">
            {LIFECYCLE.map((s, i) => {
              const reached = stageIndex >= i;
              const Icon = ICONS[s] ?? Circle;
              return (
                <div key={s} className={`flex flex-col items-center text-xs ${reached ? "text-primary" : "text-muted-foreground"}`}>
                  <Icon className="h-6 w-6 mb-1" />
                  <span className="capitalize">{s.replace("_", " ")}</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Actions */}
        {!terminal && (
          <Card className="p-5 space-y-3">
            <h2 className="font-semibold">Record next event</h2>
            <div>
              <Label>Optional note</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Hand-off context, exceptions…" />
            </div>
            <div className="flex flex-wrap gap-2">
              {pkg.status === "created" && <Button onClick={() => transition("accepted")} disabled={busy}>Accept</Button>}
              {pkg.status === "accepted" && <Button onClick={() => transition("picked_up")} disabled={busy}>Mark picked up</Button>}
              {pkg.status === "picked_up" && <Button onClick={() => transition("in_transit")} disabled={busy}>Start transit</Button>}
              {pkg.status === "in_transit" && (
                <Button asChild>
                  <Link to={`/delivery/ops/pod/${pkg.id}`}>
                    <ClipboardCheck className="h-4 w-4 mr-1" /> Capture POD & deliver
                  </Link>
                </Button>
              )}
              <Button variant="outline" onClick={() => transition("returned")} disabled={busy}>
                <RotateCcw className="h-4 w-4 mr-1" /> Mark returned
              </Button>
              <Button variant="destructive" onClick={() => transition("cancelled")} disabled={busy}>
                <XCircle className="h-4 w-4 mr-1" /> Cancel
              </Button>
            </div>
          </Card>
        )}

        {/* Immutable timeline */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Lock className="h-4 w-4" /> Immutable timeline
            <span className="text-xs text-muted-foreground font-normal">({events.length} events)</span>
          </h2>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded yet.</p>
          ) : (
            <ol className="relative border-l border-border ml-2">
              {events.map((e) => {
                const Icon = ICONS[e.event_type] ?? Circle;
                return (
                  <li key={e.id} className="mb-5 ml-4">
                    <div className="absolute -left-2 mt-1 rounded-full bg-background border border-border p-1">
                      <Icon className="h-3 w-3 text-primary" />
                    </div>
                    <div className="text-sm font-medium capitalize">{e.event_type.replace("_", " ")}</div>
                    <time className="text-xs text-muted-foreground">{new Date(e.occurred_at).toLocaleString()}</time>
                    {e.notes && <p className="text-sm mt-1">{e.notes}</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </section>
    </MarketingLayout>
  );
}
