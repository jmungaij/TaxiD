/**
 * Corporate wallet funding — four-tab workflow.
 *
 *   Fund Wallet → Payment → Waiting for Payment → Confirmation
 *
 * The available balance NEVER changes in this component. Step 1 stores a
 * pending funding request, step 2 asks Safaricom for an STK prompt, step 3
 * polls the server while the customer enters their PIN, and step 4 only ever
 * reflects a state the server already committed after a verified callback.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { describeFunctionError } from "@/lib/platform/functionErrors";
import { charterApi, type CorporateWalletRow } from "@/lib/charter/api";
import {
  FUNDING_STATUS_LABEL,
  fundingBlockers,
  fundingIdempotencyKey,
  isIdempotencyConflict,
  isPending,
  isValidStkWalletType,
  msisdn,
  normalizeStkWalletType,
  paymentBlockers,
  stkIdempotencyKey,
  type FundingRequestRow,
} from "@/lib/charter/walletFunding";
import { AlertCircle, CheckCircle2, Loader2, Receipt, RotateCcw, ShieldCheck, Smartphone } from "lucide-react";

/** Wallet the corporate charter funding flow settles into. */
const FUNDING_WALLET_TYPE = "corporate";


const money = (n: number | string | null | undefined) =>
  `KSh ${new Intl.NumberFormat("en-KE").format(Math.round(Number(n ?? 0)))}`;

type Step = "request" | "payment" | "waiting" | "confirmation";

interface Props {
  wallet: CorporateWalletRow | null;
  /** Provision the wallet on demand when funding starts without one. */
  ensureWallet: () => Promise<CorporateWalletRow>;
  defaults?: { costCenter?: string; approverName?: string; approverTitle?: string; phone?: string };
  canFund?: boolean;
  onWalletChange?: (wallet: CorporateWalletRow) => void;
  onFundingChange?: () => void;
}

export function WalletFundingWizard({
  wallet, ensureWallet, defaults = {}, canFund = true, onWalletChange, onFundingChange,
}: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("request");
  const [amount, setAmount] = useState("");
  const [costCenter, setCostCenter] = useState(defaults.costCenter ?? "");
  const [purpose, setPurpose] = useState("");
  const [approverName, setApproverName] = useState(defaults.approverName ?? "");
  const [approverTitle, setApproverTitle] = useState(defaults.approverTitle ?? "");
  const [phone, setPhone] = useState(defaults.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<FundingRequestRow | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /** Increments per STK attempt so a retry never reuses a spent idempotency key. */
  const [stkAttempt, setStkAttempt] = useState(0);
  const [stkError, setStkError] = useState<{ message: string; hint: string } | null>(null);
  const poll = useRef<number | null>(null);


  const amountKes = Math.round(Number(amount) || 0);
  const step1Errors = useMemo(
    () => fundingBlockers({ amountKes, costCenter, approverName }),
    [amountKes, costCenter, approverName],
  );
  const step2Errors = useMemo(() => paymentBlockers(phone), [phone]);

  const stopPolling = useCallback(() => {
    if (poll.current) { window.clearInterval(poll.current); poll.current = null; }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  /* ── Step 1 — pending funding request only, no money moves ─────── */
  const createRequest = async () => {
    if (Object.keys(step1Errors).length) {
      toast({ title: "Complete the funding request", description: Object.values(step1Errors)[0], variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const target = wallet ?? (await ensureWallet());
      const res = await charterApi.createFundingRequest({
        wallet_id: target.id,
        amount_kes: amountKes,
        cost_center: costCenter.trim(),
        purpose: purpose.trim() || undefined,
        approver_name: approverName.trim() || undefined,
        approver_title: approverTitle.trim() || undefined,
        idempotency_key: fundingIdempotencyKey(target.id, amountKes),
      });
      setRequest(res.request);
      setStep("payment");
      onFundingChange?.();
      if (res.reused) {
        toast({ title: "Existing funding request resumed", description: `${res.request.reference} is still awaiting payment.` });
      }
    } catch (e) {
      toast({
        title: "Could not create the funding request",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally { setBusy(false); }
  };

  /* ── Step 2 — request the STK prompt via the existing M-Pesa spine ── */
  const requestStk = async (attemptOverride?: number) => {
    if (!request) return;
    if (Object.keys(step2Errors).length) {
      toast({ title: "Check the M-Pesa number", description: Object.values(step2Errors)[0], variant: "destructive" });
      return;
    }
    // Client-side wallet_type guard — never let an unsupported label reach Daraja.
    if (!isValidStkWalletType(FUNDING_WALLET_TYPE)) {
      setStkError({
        message: `Unsupported wallet type "${FUNDING_WALLET_TYPE}".`,
        hint: "This is a configuration problem — contact support instead of retrying.",
      });
      return;
    }
    const walletType = normalizeStkWalletType(FUNDING_WALLET_TYPE)!;
    const attempt = attemptOverride ?? stkAttempt;
    const amountToPush = Math.round(Number(request.amount_kes));
    const payer = msisdn(phone);
    setBusy(true);
    setStkError(null);
    try {
      const { data, error } = await supabase.functions.invoke("mpesa-stkpush", {
        body: {
          amount: amountToPush,
          phone: payer,
          wallet_type: walletType,
          account_reference: request.reference,
          // Bound to this exact payload + attempt: duplicate clicks collapse,
          // but editing the number or retrying is a genuinely new request
          // instead of an HTTP 409 idempotency conflict.
          idempotency_key: stkIdempotencyKey(
            request.reference ?? request.id, payer, amountToPush, attempt,
          ),
        },
      });
      if (error) throw new Error(await describeFunctionError(error));
      const checkout = (data as { checkoutRequestId?: string; data?: { checkoutRequestId?: string } })?.checkoutRequestId
        ?? (data as { data?: { checkoutRequestId?: string } })?.data?.checkoutRequestId;
      const merchant = (data as { merchantRequestId?: string; data?: { merchantRequestId?: string } })?.merchantRequestId
        ?? (data as { data?: { merchantRequestId?: string } })?.data?.merchantRequestId;
      if (!checkout) throw new Error("M-Pesa did not return a checkout reference. Try again.");
      const marked = await charterApi.markFundingStk({
        request_id: request.id, phone: payer,
        checkout_request_id: checkout, merchant_request_id: merchant,
      });
      setRequest(marked.request);
      setElapsed(0);
      setStep("waiting");
      onFundingChange?.();
      startPolling(marked.request.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Error";
      const conflict = isIdempotencyConflict(message);
      // Structured client log — mirrors the server fields used for debugging.
      console.error(JSON.stringify({
        level: "error", surface: "wallet_funding_wizard", event: "stk_push_failed",
        reference: request.reference, wallet_type: walletType, amount_kes: amountToPush,
        attempt, idempotency_conflict: conflict, reason: message,
        ts: new Date().toISOString(),
      }));
      // A conflict means the key was already spent — the next attempt gets a new one.
      setStkAttempt(attempt + 1);
      setStkError({
        message,
        hint: conflict
          ? "That payment reference was already used. Press Retry — a fresh request is sent and you are never charged twice."
          : "No money moved. Check the number is on M-Pesa and has network, then press Retry.",
      });
      toast({ title: "STK push could not be sent", description: message, variant: "destructive" });
    } finally { setBusy(false); }
  };


  /* ── Step 3 — poll the server; only it knows if a callback landed ── */
  const startPolling = useCallback((id: string) => {
    stopPolling();
    poll.current = window.setInterval(async () => {
      setElapsed((e) => e + 3);
      try {
        const res = await charterApi.fundingStatus(id);
        setRequest(res.request);
        if (res.wallet) onWalletChange?.(res.wallet);
        if (!isPending(res.request.status)) {
          stopPolling();
          setStep("confirmation");
          onFundingChange?.();
        }
      } catch { /* transient — keep polling */ }
    }, 3000);
  }, [onFundingChange, onWalletChange, stopPolling]);

  const cancel = async () => {
    if (!request) return;
    stopPolling();
    try {
      const res = await charterApi.cancelFunding(request.id);
      setRequest(res.request);
      setStep("confirmation");
      onFundingChange?.();
    } catch (e) {
      toast({ title: "Could not cancel", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    }
  };

  const reset = () => {
    stopPolling();
    setRequest(null); setAmount(""); setPurpose(""); setElapsed(0); setStep("request");
    setStkAttempt(0); setStkError(null);
  };


  const paid = request?.status === "paid";

  return (
    <Card data-testid="wallet-funding-wizard">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Fund the corporate wallet</CardTitle>
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="h-3 w-3" /> Credited only after M-Pesa confirms
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={step}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="request" disabled={step !== "request"}>Fund wallet</TabsTrigger>
            <TabsTrigger value="payment" disabled={step !== "payment"}>Payment</TabsTrigger>
            <TabsTrigger value="waiting" disabled={step !== "waiting"}>Waiting</TabsTrigger>
            <TabsTrigger value="confirmation" disabled={step !== "confirmation"}>Confirmation</TabsTrigger>
          </TabsList>

          {/* Step 1 */}
          <TabsContent value="request" className="space-y-3 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cwf-amount">Amount (KES)</Label>
                <Input id="cwf-amount" inputMode="numeric" value={amount} placeholder="250000"
                  onChange={(e) => setAmount(e.target.value)} />
                {step1Errors.amountKes && <p className="text-xs text-destructive">{step1Errors.amountKes}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cwf-cc">Cost centre</Label>
                <Input id="cwf-cc" value={costCenter} onChange={(e) => setCostCenter(e.target.value)} />
                {step1Errors.costCenter && <p className="text-xs text-destructive">{step1Errors.costCenter}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cwf-purpose">Funding purpose</Label>
                <Input id="cwf-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cwf-approver">Approving authority</Label>
                <Input id="cwf-approver" value={approverName} onChange={(e) => setApproverName(e.target.value)} />
                {step1Errors.approverName && <p className="text-xs text-destructive">{step1Errors.approverName}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cwf-title">Authority title</Label>
                <Input id="cwf-title" value={approverTitle} onChange={(e) => setApproverTitle(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Next records a pending funding request. No balance changes until M-Pesa confirms the payment.
            </p>
            <Button onClick={createRequest} disabled={busy || !canFund} data-testid="cwf-next">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Next
            </Button>
          </TabsContent>

          {/* Step 2 */}
          <TabsContent value="payment" className="space-y-3 pt-4">
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Funding amount</p>
              <p className="text-2xl font-bold">{money(request?.amount_kes)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Reference <span className="font-mono">{request?.reference}</span> · Cost centre {request?.cost_center}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cwf-phone">M-Pesa number</Label>
              <div className="relative">
                <Smartphone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="cwf-phone" className="pl-9" inputMode="tel" placeholder="0712 345 678"
                  value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              {phone && step2Errors.phone && <p className="text-xs text-destructive">{step2Errors.phone}</p>}
            </div>
            <p className="text-xs text-muted-foreground">Payment method: M-Pesa STK Push · Paybill 4573823</p>
            {stkError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3" data-testid="cwf-stk-error">
                <p className="flex items-start gap-2 text-sm font-medium text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {stkError.message}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{stkError.hint}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void requestStk()} disabled={busy || !phone || !!step2Errors.phone} data-testid="cwf-stk">
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {stkError ? "Send a new STK push" : "Request STK push"}
              </Button>
              {stkError && (
                <Button variant="secondary" onClick={() => void requestStk(stkAttempt)}
                  disabled={busy || !phone || !!step2Errors.phone} data-testid="cwf-stk-retry">
                  <RotateCcw className="mr-2 h-4 w-4" /> Retry
                </Button>
              )}
              <Button variant="outline" onClick={cancel} disabled={busy}>Cancel</Button>
            </div>

          </TabsContent>

          {/* Step 3 */}
          <TabsContent value="waiting" className="space-y-3 pt-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for M-Pesa confirmation…
            </p>
            <Progress value={Math.min((elapsed / 120) * 100, 98)} />
            <p className="text-xs text-muted-foreground">
              An STK push was sent to <span className="font-mono">{request?.phone}</span>. Do not close this page —
              your balance updates only once Safaricom confirms the payment.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep("payment")}>Change number / resend</Button>
              <Button variant="outline" size="sm" onClick={cancel}>Cancel</Button>
            </div>
          </TabsContent>

          {/* Step 4 */}
          <TabsContent value="confirmation" className="space-y-3 pt-4">
            {paid ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <CheckCircle2 className="h-4 w-4" /> Funding cleared — {money(request?.amount_kes)} credited.
                </p>
                <p className="text-xs text-muted-foreground">
                  M-Pesa receipt <span className="font-mono">{request?.mpesa_receipt}</span> · ledger entry{" "}
                  <span className="font-mono">{request?.ledger_entry_id?.slice(0, 8)}</span> · reference{" "}
                  <span className="font-mono">{request?.reference}</span>
                </p>
                <Badge variant="outline" className="gap-1"><Receipt className="h-3 w-3" /> Receipt issued</Badge>
              </div>
            ) : (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {FUNDING_STATUS_LABEL[request?.status ?? "failed"]}
                {request?.result_desc ? ` — ${request.result_desc}` : ""}. No balance was changed.
              </p>
            )}
            <Button variant="outline" onClick={reset}>Start another funding request</Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export default WalletFundingWizard;
