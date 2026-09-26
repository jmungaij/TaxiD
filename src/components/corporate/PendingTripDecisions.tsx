/**
 * TRIP REQUESTS AWAITING A MANAGER'S DECISION.
 *
 * Shown on the company dashboard so a manager sees a held request the moment it
 * is raised and can approve or reject it without leaving the dashboard.
 *
 * The decision itself is taken on the server (decide_corporate_ride_request):
 * only a manager or administrator of that company may decide, approval creates
 * the booking, and the outcome is written to the audit trail. This card only
 * shows the outcome it is given.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { decideCorporateRideRequest } from "@/lib/corporateRides";
import { toast } from "sonner";
import { Check, ClipboardCheck, RefreshCw, X } from "lucide-react";

interface Row {
  id: string;
  ride_type: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  estimated_fare_cents: number;
  justification: string | null;
  scheduled_for: string | null;
  created_at: string;
  expires_at: string | null;
}

export function PendingTripDecisions({ corporateId }: { corporateId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState<{ id: string; kind: "approved" | "rejected" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!corporateId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("corporate_ride_approvals")
      .select(
        "id,ride_type,pickup_address,dropoff_address,estimated_fare_cents," +
          "justification,scheduled_for,created_at,expires_at",
      )
      .eq("corporate_id", corporateId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) toast.error("Could not load trip requests");
    setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
  }, [corporateId]);

  useEffect(() => { void load(); }, [load]);

  const decide = async () => {
    if (!choice) return;
    if (choice.kind === "rejected" && note.trim().length < 3) {
      toast.error("Give a reason so the person knows why");
      return;
    }
    setBusy(true);
    try {
      const res = await decideCorporateRideRequest(choice.id, choice.kind, note.trim() || undefined);
      toast.success(
        res.status === "approved"
          ? `Approved — booking ${res.booking_number ?? ""} is now with dispatch`
          : res.status === "rejected"
            ? "Request rejected"
            : "That request had already expired",
      );
      setChoice(null);
      setNote("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the decision");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-analytics-id="corporate-pending-trip-decisions">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-status-warning" /> Trip requests awaiting your decision
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{rows.length} held</Badge>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground py-4">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">
            No trip requests are waiting. Requests appear here when they need a manager's approval.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="rounded-lg border p-3 flex flex-wrap gap-3 justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="capitalize">
                      {(r.ride_type ?? "ride").split("_").join(" ")}
                    </Badge>
                    <span className="font-semibold text-sm">
                      KES {(r.estimated_fare_cents / 100).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm truncate">
                    {r.pickup_address ?? "—"} → {r.dropoff_address ?? "—"}
                  </div>
                  {r.justification && <div className="text-sm italic">“{r.justification}”</div>}
                  <div className="text-xs text-muted-foreground">
                    Raised {new Date(r.created_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}
                    {r.expires_at
                      ? ` · expires ${new Date(r.expires_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}`
                      : ""}
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Button size="sm" onClick={() => { setChoice({ id: r.id, kind: "approved" }); setNote(""); }}>
                    <Check className="h-4 w-4 mr-1" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => { setChoice({ id: r.id, kind: "rejected" }); setNote(""); }}
                  >
                    <X className="h-4 w-4 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!choice} onOpenChange={(o) => { if (!o) setChoice(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {choice?.kind === "approved" ? "Approve this trip" : "Reject this trip"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {choice?.kind === "approved"
              ? "Approving books the trip and sends it to dispatch for a driver."
              : "Give a short reason — the person who asked will see it."}
          </p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={choice?.kind === "approved" ? "Note (optional)" : "Reason for rejecting"}
          />
          <DialogFooter>
            <Button
              onClick={() => void decide()}
              disabled={busy}
              variant={choice?.kind === "approved" ? "default" : "destructive"}
            >
              {busy ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default PendingTripDecisions;
