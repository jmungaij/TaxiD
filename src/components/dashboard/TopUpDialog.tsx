import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { newCorrelationId, logClientEvent, invokeWithJourney } from "@/lib/journeyLogger";

interface TopUpDialogProps {
  walletType: string;
  walletId: string;
  onSuccess?: (newBalanceCents: number) => void;
  /** Presentation-only overrides for the trigger button. */
  triggerLabel?: string;
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
  triggerSize?: React.ComponentProps<typeof Button>["size"];
}

interface StkDiag {
  code?: string;
  message?: string;
  environment?: string;
  request_id?: string;
  correlation_id?: string;
  http_status?: number;
  last_response?: unknown;
}

export function TopUpDialog({
  walletType,
  walletId,
  onSuccess,
  triggerLabel = "Top Up Wallet",
  triggerVariant,
  triggerSize,
}: TopUpDialogProps) {

  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [diag, setDiag] = useState<StkDiag | null>(null);
  const { toast } = useToast();

  async function handleTopUp() {
    if (!walletId) {
      toast({ title: "No wallet", description: "Wallet not loaded yet.", variant: "destructive" });
      return;
    }
    setBusy(true);
    setDiag(null);
    const correlationId = newCorrelationId();
    const journeyCtx = { correlationId, component: "TopUpDialog", route: window.location.pathname };
    const idemKey = `${walletId}:${phone}:${amount}:${Date.now()}`;

    await logClientEvent(journeyCtx, "button_clicked", {
      evidence: { wallet_type: walletType, amount: Number(amount) } as Record<string, unknown>,
    });
    await logClientEvent(journeyCtx, "validation_started");
    if (!phone || !amount || Number(amount) < 1) {
      await logClientEvent(journeyCtx, "validation_failed", { errorMessage: "phone/amount invalid" });
      setBusy(false);
      return;
    }
    await logClientEvent(journeyCtx, "validation_passed");
    await logClientEvent(journeyCtx, "mutation_started");

    try {
      const { data, error, httpStatus } = await invokeWithJourney<{ message?: string; checkoutRequestId?: string }>(
        journeyCtx,
        "mpesa-stkpush",
        {
          amount: Number(amount),
          phone,
          wallet_type: walletType,
          account_reference: `TOPUP-${Date.now()}`,
          idempotency_key: idemKey,
        },
        { "Idempotency-Key": idemKey },
      );

      if (error) {
        let parsed: StkDiag = { message: (error as { message?: string }).message };
        try {
          const ctx = (error as { context?: { body?: BodyInit } }).context;
          const body = ctx?.body ? await new Response(ctx.body).json() : ctx;
          const env = body?.error ?? body;
          parsed = { code: env?.code, message: env?.message ?? parsed.message, ...(env?.details ?? {}) };
        } catch { /* keep default */ }
        setDiag(parsed);
        await logClientEvent(journeyCtx, "error_surfaced", { httpStatus, errorMessage: parsed.message });
        throw new Error(parsed.message || "STK push failed");
      }
      toast({ title: "STK Push Sent", description: data?.message || "Check your phone for the M-Pesa prompt." });
      await logClientEvent(journeyCtx, "ui_updated", { success: true });
      setOpen(false);
      if (data?.checkoutRequestId) pollTransaction(data.checkoutRequestId);
    } catch (err) {
      toast({ title: "Top-up failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      await logClientEvent(journeyCtx, "mutation_completed");
      setBusy(false);
    }
  }

  async function pollTransaction(checkoutRequestId: string) {
    // Poll the canonical payment lifecycle (payment_attempts) rather than
    // the derived mpesa_transactions projection. Stops immediately on any
    // terminal canonical state.
    const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "REVERSED", "RECONCILED"]);
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const { data: attempt } = await supabase
        .from("payment_attempts")
        .select("state,failure_reason")
        .eq("checkout_request_id", checkoutRequestId)
        .maybeSingle();
      const state = attempt?.state as string | undefined;
      if (state && TERMINAL.has(state)) {
        clearInterval(interval);
        if (state === "COMPLETED" || state === "RECONCILED") {
          toast({ title: "Payment confirmed", description: "Your wallet has been topped up." });
          const { data: wallet } = await supabase
            .from("wallets")
            .select("balance_cents")
            .eq("id", walletId)
            .single();
          if (wallet) onSuccess?.(wallet.balance_cents);
        } else {
          toast({
            title: "Payment " + state.toLowerCase(),
            description: attempt?.failure_reason || "The M-Pesa transaction did not complete.",
            variant: "destructive",
          });
        }
      } else if (attempts > 20) {
        clearInterval(interval);
      }
    }, 3000);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Top Up Wallet</DialogTitle>
          <DialogDescription>Enter your M-Pesa phone number and amount.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="topup-phone">Phone Number</Label>
            <Input id="topup-phone" placeholder="0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="topup-amount">Amount (KES)</Label>
            <Input id="topup-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          {diag && (
            <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1">
              <div className="font-semibold text-destructive">
                STK failed{diag.code ? ` — ${diag.code}` : ""}
              </div>
              {diag.message && <div>{diag.message}</div>}
              <div className="grid grid-cols-2 gap-x-2 mt-2 font-mono">
                {diag.environment && <div><span className="text-muted-foreground">env:</span> {diag.environment}</div>}
                {diag.http_status != null && <div><span className="text-muted-foreground">http:</span> {diag.http_status}</div>}
                {diag.request_id && <div className="col-span-2 truncate"><span className="text-muted-foreground">request_id:</span> {diag.request_id}</div>}
                {diag.correlation_id && <div className="col-span-2 truncate"><span className="text-muted-foreground">correlation_id:</span> {diag.correlation_id}</div>}
              </div>
              {diag.last_response != null && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-muted-foreground">last response</summary>
                  <pre className="mt-1 max-h-40 overflow-auto bg-background p-2 rounded">{JSON.stringify(diag.last_response, null, 2)}</pre>
                </details>
              )}
              <div className="pt-1 text-muted-foreground">
                Admin can inspect all attempts at <code>/dashboard/admin/mpesa</code>.
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleTopUp} disabled={busy || !phone || !amount}>
            {busy ? "Sending..." : "Send STK Push"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
