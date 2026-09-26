/**
 * M-PESA PAYMENTS BOARD (finance authority).
 * Every figure is computed by payments_board(); this page only displays it.
 * Flags are append-only (payment_dispute_record).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Check, Loader2, RefreshCw, X } from "lucide-react";

type Row = {
  id: string; created_at: string; amount_kes: number; account_reference: string | null;
  phone_masked: string; provider_state: string; receipt: string | null; wallet_posted: boolean;
  callbacks: number; safaricom_verified: boolean; callback_amount_kes: number | null;
  receiving_account: string | null; dispute: string | null; intent_state: string;
  checks: Record<string, boolean>;
};

const CHECK_LABEL: Record<string, string> = {
  safaricom_confirmed: "Safaricom confirmed",
  amount_matches: "Amount matches",
  paybill_matches: "PayBill matches",
  receipt_present: "Receipt",
  credited_once: "Credited",
};

const FILTERS: Record<string, (r: Row) => boolean> = {
  pending: (r) => ["PENDING", "AWAITING_CUSTOMER", "SAFARICOM_CONFIRMED"].includes(r.intent_state),
  confirmed: (r) => r.intent_state.startsWith("POSTED"),
  review: (r) => ["REQUIRES_REVIEW", "DISPUTED"].includes(r.intent_state),
  failed: (r) => ["FAILED", "CANCELLED"].includes(r.intent_state),
  all: () => true,
};

export default function MpesaPayments() {
  const [rows, setRows] = useState<Row[]>([]);
  const [paybill, setPaybill] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("pending");
  const [reason, setReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await untypedDb.rpc("payments_board", { p_limit: 500 });
    setLoading(false);
    if (error) { toast.error("Couldn't load payments."); return; }
    setRows((data?.rows ?? []) as Row[]);
    setPaybill(data?.paybill ?? null);
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => rows.filter(FILTERS[tab]), [rows, tab]);
  const count = (k: string) => rows.filter(FILTERS[k]).length;

  const flag = async (r: Row, action: "flagged" | "resolved") => {
    const text = (reason[r.id] ?? "").trim();
    if (text.length < 5) { toast.error("Write a reason of at least 5 characters."); return; }
    const { error } = await untypedDb.rpc("payment_dispute_record", { p_attempt_id: r.id, p_action: action, p_reason: text });
    if (error) { toast.error("Couldn't save the flag."); return; }
    toast.success(action === "flagged" ? "Payment flagged as disputed." : "Dispute resolved.");
    setReason((s) => ({ ...s, [r.id]: "" }));
    load();
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">M-Pesa payments</h1>
          <p className="text-sm text-muted-foreground">
            Every payment prompt, Safaricom confirmation and reconciliation check. Receiving PayBill:{" "}
            <strong>{paybill ?? "not configured"}</strong>
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({count("pending")})</TabsTrigger>
          <TabsTrigger value="confirmed">Confirmed ({count("confirmed")})</TabsTrigger>
          <TabsTrigger value="review">Needs review ({count("review")})</TabsTrigger>
          <TabsTrigger value="failed">Failed ({count("failed")})</TabsTrigger>
          <TabsTrigger value="all">All ({rows.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {shown.length === 0 && !loading && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No payments in this view.</CardContent></Card>
      )}

      <div className="space-y-3">
        {shown.map((r) => (
          <Card key={r.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  KES {Number(r.amount_kes).toLocaleString("en-KE")} · {r.account_reference ?? "no reference"}
                </CardTitle>
                <Badge variant={r.intent_state.startsWith("POSTED") ? "default" : r.intent_state === "DISPUTED" || r.intent_state === "REQUIRES_REVIEW" ? "destructive" : "secondary"}>
                  {r.intent_state.replace(/_/g, " ")}
                </Badge>
              </div>
              <CardDescription>
                {new Date(r.created_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })} · payer {r.phone_masked} ·
                receipt {r.receipt ?? "none"} · {r.callbacks} callback{r.callbacks === 1 ? "" : "s"}
                {r.callback_amount_kes != null && ` · Safaricom amount KES ${r.callback_amount_kes}`}
                {` · PayBill ${r.receiving_account ?? "not recorded"}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {Object.entries(r.checks).map(([k, ok]) => (
                  <Badge key={k} variant="outline" className="gap-1">
                    {ok ? <Check className="h-3 w-3 text-primary" /> : <X className="h-3 w-3 text-destructive" />}
                    {CHECK_LABEL[k] ?? k}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-md" placeholder="Reason (required)"
                  value={reason[r.id] ?? ""} onChange={(e) => setReason((s) => ({ ...s, [r.id]: e.target.value }))}
                />
                {r.dispute === "flagged" ? (
                  <Button size="sm" variant="outline" onClick={() => flag(r, "resolved")}>Resolve dispute</Button>
                ) : (
                  <Button size="sm" variant="destructive" onClick={() => flag(r, "flagged")}>Flag as disputed</Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
