import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { ArrowUpRight } from "lucide-react";

interface WithdrawDialogProps {
  driverId: string;
  availableCents: number;
  onRequested?: () => void;
}

interface PayoutMethod {
  id: string;
  method_type: string;
  msisdn: string | null;
  is_default: boolean | null;
}

const MIN_KES = 50;
const MAX_KES = 150_000;

export function WithdrawDialog({ driverId, availableCents, onRequested }: WithdrawDialogProps) {
  const [open, setOpen] = useState(false);
  const [methods, setMethods] = useState<PayoutMethod[]>([]);
  const [methodId, setMethodId] = useState<string>("");
  const [manualPhone, setManualPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    // driver_payout_methods.driver_id is the authenticated user id (RLS: driver_id = auth.uid()),
    // so resolve it from the session rather than trusting the caller's prop.
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return;
      const { data } = await untypedDb
        .from("driver_payout_methods")
        .select("id,method_type,msisdn,is_default")
        .eq("driver_id", uid)
        .order("is_default", { ascending: false });
      const rows = (data as PayoutMethod[]) ?? [];
      setMethods(rows);
      const def = rows.find((r) => r.is_default) ?? rows[0];
      if (def) setMethodId(def.id);
    })();
  }, [open, driverId]);

  async function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < MIN_KES) {
      toast({ title: "Invalid amount", description: `Minimum KES ${MIN_KES}.`, variant: "destructive" });
      return;
    }
    if (amt > MAX_KES) {
      toast({ title: "Amount too large", description: `Maximum KES ${MAX_KES.toLocaleString()}.`, variant: "destructive" });
      return;
    }
    if (amt * 100 > availableCents) {
      toast({ title: "Insufficient balance", description: "Amount exceeds available wallet balance.", variant: "destructive" });
      return;
    }
    const selected = methods.find((m) => m.id === methodId);
    const msisdn = selected?.msisdn ?? manualPhone;
    if (!msisdn) {
      toast({ title: "Payout destination required", description: "Add an M-Pesa number.", variant: "destructive" });
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("driver-withdraw", {
        body: {
          amount_cents: Math.round(amt * 100),
          method_id: selected?.id ?? null,
          msisdn,
          channel: "mpesa",
        },
      });
      if (error) throw error;
      if (data?.replay) {
        toast({
          title: "Withdrawal already in queue",
          description: `Reference ${data.reference} is being processed.`,
        });
      } else {
        toast({
          title: "Withdrawal requested",
          description: `KES ${amt.toLocaleString()} → ${msisdn}. Ref ${data?.reference ?? ""}. You'll be notified once payout completes.`,
        });
      }
      setOpen(false);
      setAmount("");
      onRequested?.();
    } catch (err) {
      const message = err?.context?.error?.message ?? err?.message ?? "Unable to submit withdrawal";
      toast({ title: "Withdrawal failed", description: message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <ArrowUpRight className="h-4 w-4 mr-2" /> Withdraw
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Withdraw to M-Pesa</DialogTitle>
          <DialogDescription>
            Available balance: <span className="font-semibold text-foreground">KES {(availableCents / 100).toLocaleString()}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {methods.length > 0 ? (
            <div>
              <Label>Payout destination</Label>
              <div className="space-y-2 mt-2">
                {methods.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 rounded border p-2 cursor-pointer hover:bg-muted/40">
                    <input
                      type="radio"
                      name="method"
                      value={m.id}
                      checked={methodId === m.id}
                      onChange={() => setMethodId(m.id)}
                    />
                    <span className="text-sm">
                      {m.method_type} · {m.msisdn} {m.is_default && <span className="text-xs text-muted-foreground">(default)</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <Label htmlFor="wdr-phone">M-Pesa phone number</Label>
              <Input id="wdr-phone" placeholder="0712345678" value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">
                Save this number under <a className="underline" href="/dashboard/driver/payouts">Payouts</a> so you don't retype it next time.
              </p>
            </div>
          )}
          <div>
            <Label htmlFor="wdr-amount">Amount (KES)</Label>
            <Input
              id="wdr-amount"
              type="number"
              min={MIN_KES}
              max={MAX_KES}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Min ${MIN_KES} · Max ${MAX_KES.toLocaleString()}`}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || !amount}>
            {busy ? "Submitting..." : "Request Withdrawal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
