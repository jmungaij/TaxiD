/**
 * FN-01 COLLECTION EXECUTION DIALOG.
 *
 * FN-01 certifies a real M-Pesa collection, and TaxiD only ever collects from a
 * payer who supplies their own M-Pesa number — the same orchestration as the
 * production checkout: the paying party enters the number, that handset receives
 * the STK prompt. This dialog therefore requires the payer's number on every
 * execution and never remembers a default.
 *
 * Live mode uses the production Daraja application and debits real money, so it
 * additionally requires an explicit confirmation which the server re-checks.
 */
import * as React from "react";
import { Loader2, ShieldAlert, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatKenyanMsisdnDisplay, isValidKenyanMsisdn, normalizeKenyanMsisdn } from "@/lib/kenyaPhone";
import type { FnProviderExecutionOptions } from "@/lib/logistics/finance/fnCertification";

const LIVE_MAX_KES = 10;

export function FnCollectionDialog({
  open,
  controlId,
  busy,
  onOpenChange,
  onExecute,
}: {
  open: boolean;
  controlId: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onExecute: (options: FnProviderExecutionOptions) => void;
}) {
  const [phone, setPhone] = React.useState("");
  const [mode, setMode] = React.useState<"sandbox" | "live">("sandbox");
  const [amount, setAmount] = React.useState("1");
  const [confirmed, setConfirmed] = React.useState(false);

  React.useEffect(() => {
    if (!open) { setPhone(""); setMode("sandbox"); setAmount("1"); setConfirmed(false); }
  }, [open]);

  const normalised = normalizeKenyanMsisdn(phone);
  const amt = Number(amount);
  const amountOk = Number.isFinite(amt) && amt >= 1 && (mode === "sandbox" || amt <= LIVE_MAX_KES);
  const ready = !!normalised && amountOk && (mode === "sandbox" || confirmed);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Execute {controlId} — real M-Pesa collection</DialogTitle>
          <DialogDescription>
            The payer always supplies the M-Pesa number, and that handset receives the STK prompt. No number is stored
            or defaulted for certification runs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="fn-payer">Payer M-Pesa number</Label>
            <div className="relative">
              <Smartphone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="fn-payer"
                inputMode="tel"
                className="pl-9"
                placeholder="0712 345 678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={busy}
              />
            </div>
            {phone && !isValidKenyanMsisdn(phone) && (
              <p className="text-xs text-destructive">Enter a valid Kenyan mobile number.</p>
            )}
            {normalised && (
              <p className="text-xs text-muted-foreground">
                Prompt goes to <span className="font-mono">{normalised}</span> ({formatKenyanMsisdnDisplay(normalised)}).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Daraja application</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                { key: "sandbox" as const, title: "Sandbox", note: "No real money can move." },
                { key: "live" as const, title: "Live", note: "Debits the payer's real M-Pesa account." },
              ]).map((o) => (
                <label
                  key={o.key}
                  className={`cursor-pointer rounded-lg border p-3 text-xs ${mode === o.key ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="fn-mode"
                      checked={mode === o.key}
                      onChange={() => setMode(o.key)}
                      disabled={busy}
                    />
                    <span className="text-sm font-semibold">{o.title}</span>
                  </span>
                  <span className="mt-1 block text-muted-foreground">{o.note}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fn-amount">Certification amount (KES)</Label>
            <Input
              id="fn-amount"
              type="number"
              min={1}
              max={mode === "live" ? LIVE_MAX_KES : 100}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
            />
            {mode === "live" && (
              <p className="text-xs text-muted-foreground">Live certification collections are capped at KES {LIVE_MAX_KES}.</p>
            )}
          </div>

          {mode === "live" && (
            <label className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy}
              />
              <span>
                <ShieldAlert className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                I confirm this is a real-money collection on the production Daraja application, that the payer above has
                consented, and that the debit is irreversible without a manual reversal.
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            disabled={!ready || busy}
            onClick={() => onExecute({
              payerMsisdn: normalised ?? undefined,
              providerMode: mode,
              liveExecutionConfirmed: mode === "live" ? confirmed : false,
              amountKes: Math.round(amt),
            })}
          >
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            {mode === "live" ? "Send live STK prompt" : "Send sandbox STK prompt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FnCollectionDialog;
