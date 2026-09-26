import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Check, X, Clock } from "lucide-react";
import { decideCorporateRideRequest } from "@/lib/corporateRides";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface Approval {
  id: string; status: string; ride_type: string | null;
  pickup_address: string | null; dropoff_address: string | null;
  estimated_fare_cents: number; estimated_distance_km: number | null;
  scheduled_for: string | null; justification: string | null;
  requested_by: string; created_at: string; expires_at: string;
  decision_note: string | null; decided_at: string | null;
  employee_id: string;
}

export default function CorporateApprovals({ corporateId }: { corporateId: string | null }) {
  const { user, isCorporateAdmin } = useAuth();
  const [items, setItems] = useState<Approval[]>([]);
  const [decision, setDecision] = useState<{ id: string; kind: "approved" | "rejected" } | null>(null);
  const [note, setNote] = useState("");

  const load = async () => {
    if (!corporateId) return;
    const { data } = await supabase.from("corporate_ride_approvals")
      .select("*").eq("corporate_id", corporateId)
      .order("created_at", { ascending: false }).limit(100);
    setItems((data ?? []) as Approval[]);
  };
  useEffect(() => { load(); }, [corporateId]);

  const submit = async () => {
    if (!decision) return;
    try {
      const res = await decideCorporateRideRequest(decision.id, decision.kind, note);
      await supabase.from("corporate_policy_audit_log").insert({
        corporate_id: corporateId!, actor_user_id: user!.id,
        action: `approval.${decision.kind}`, target_type: "approval", target_id: decision.id,
        after: { note, booking_id: res.booking_id ?? null },
      });
      toast({
        title: res.status === "approved" ? "Ride approved" : res.status === "rejected" ? "Request rejected" : "Request expired",
        description: res.status === "approved"
          ? `Booking ${res.booking_number ?? ""} is now in dispatch.`
          : res.reason ?? undefined,
        variant: res.status === "expired" ? "destructive" : undefined,
      });
      setDecision(null); setNote(""); load();
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    }
  };


  const pending = items.filter(i => i.status === "pending");
  const history = items.filter(i => i.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-3 flex items-center gap-2"><Clock className="h-5 w-5" /> Pending approvals ({pending.length})</h2>
        <div className="space-y-3">
          {pending.map(a => (
            <Card key={a.id} className="p-4">
              <div className="flex justify-between items-start gap-3">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{a.ride_type ?? "ride"}</Badge>
                    <span className="font-semibold">KES {(a.estimated_fare_cents / 100).toLocaleString()}</span>
                    {a.estimated_distance_km && <span className="text-sm text-muted-foreground">· {a.estimated_distance_km.toFixed(1)} km</span>}
                  </div>
                  <div className="text-sm"><span className="text-muted-foreground">From:</span> {a.pickup_address ?? "—"}</div>
                  <div className="text-sm"><span className="text-muted-foreground">To:</span> {a.dropoff_address ?? "—"}</div>
                  {a.justification && <div className="text-sm italic mt-2">"{a.justification}"</div>}
                  <div className="text-xs text-muted-foreground mt-1">
                    Requested {formatDistanceToNow(new Date(a.created_at))} ago · expires {formatDistanceToNow(new Date(a.expires_at))}
                  </div>
                </div>
                {isCorporateAdmin && (
                  <div className="flex flex-col gap-2">
                    <Button size="sm" onClick={() => setDecision({ id: a.id, kind: "approved" })} className="gap-1"><Check className="h-4 w-4" /> Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => setDecision({ id: a.id, kind: "rejected" })} className="gap-1"><X className="h-4 w-4" /> Reject</Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
          {pending.length === 0 && <Card className="p-6 text-center text-muted-foreground">No pending approvals.</Card>}
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-3">Recent decisions</h2>
        <div className="space-y-2">
          {history.slice(0, 20).map(a => (
            <Card key={a.id} className="p-3 flex justify-between items-center text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={a.status === "approved" ? "default" : "destructive"}>{a.status}</Badge>
                <span>{a.ride_type} · KES {(a.estimated_fare_cents / 100).toLocaleString()}</span>
                <span className="text-muted-foreground">· {a.pickup_address?.slice(0, 30)}… → {a.dropoff_address?.slice(0, 30)}…</span>
              </div>
              <span className="text-xs text-muted-foreground">{a.decided_at && formatDistanceToNow(new Date(a.decided_at))} ago</span>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{decision?.kind === "approved" ? "Approve" : "Reject"} ride request</DialogTitle></DialogHeader>
          <Textarea placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter><Button onClick={submit} variant={decision?.kind === "approved" ? "default" : "destructive"}>Confirm</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
