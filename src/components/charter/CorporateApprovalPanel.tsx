/**
 * Corporate organisation approval panel.
 *
 * Replaces the legacy passenger sign-off. The approving authority of the
 * organisation identifies themselves, supplies enterprise procurement details
 * (cost centre, purchase order, invoice schedule), and authorises the mission.
 * When the corporate wallet is chosen the wallet is provisioned on demand, can
 * be funded here, and the invoice is then settled against its balance — every
 * movement written to a hash-chained ledger.
 */
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { charterApi, type CorporateWalletRow } from "@/lib/charter/api";
import { WalletFundingWizard } from "@/components/charter/WalletFundingWizard";

import {
  APPROVER_TITLES,
  INVOICE_SCHEDULES,
  approvalChain,
  procurementBlockers,
  type ProcurementDetails,
} from "@/lib/charter/corporateApproval";

interface Props {
  reference: string;
  totalKes: number;
  totalLabel: string;
  bookingId?: string | null;
  procurement: ProcurementDetails;
  onProcurementChange: (next: ProcurementDetails) => void;
  approved: boolean;
  onApprovedChange: (approved: boolean) => void;
  /** Rendered wallet controls only matter once the wallet route is chosen. */
  walletSelected: boolean;
  /** Fired once the invoice has been settled from the wallet balance. */
  onWalletSettled?: (wallet: CorporateWalletRow) => void;
  /** Hides the authority fields when the caller is not signed in. */
  signedIn?: boolean;
}

const money = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

export function CorporateApprovalPanel({
  reference, totalKes, totalLabel, bookingId, procurement, onProcurementChange,
  approved, onApprovedChange, walletSelected, onWalletSettled, signedIn = true,
}: Props) {
  const [attempted, setAttempted] = useState(false);
  const [wallet, setWallet] = useState<CorporateWalletRow | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  
  const [settled, setSettled] = useState(false);

  const errors = useMemo(() => procurementBlockers(procurement), [procurement]);
  const ready = Object.keys(errors).length === 0;
  const patch = (v: Partial<ProcurementDetails>) => onProcurementChange({ ...procurement, ...v });
  const err = (field: keyof ProcurementDetails) => (attempted ? errors[field] : undefined);

  // Reuse an existing wallet for this organisation as soon as the route is picked.
  useEffect(() => {
    if (!walletSelected || !signedIn || !ready || wallet) return;
    let cancelled = false;
    void charterApi
      .listCorporateWallets()
      .then((res) => {
        if (cancelled) return;
        const match = res.wallets.find(
          (w) => w.organization_name.toLowerCase() === procurement.organizationName.trim().toLowerCase(),
        );
        if (match) setWallet(match);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [walletSelected, signedIn, ready, wallet, procurement.organizationName]);

  const provisionWallet = async () => {
    setAttempted(true);
    if (!ready) return;
    setWalletBusy(true);
    try {
      const res = await charterApi.ensureCorporateWallet({
        organization_name: procurement.organizationName.trim(),
        approver_name: procurement.approverName.trim(),
        approver_title: procurement.approverTitle.trim(),
      });
      setWallet(res.wallet);
      toast({
        title: res.created ? "Corporate wallet created" : "Corporate wallet ready",
        description: `${res.wallet.organization_name} · balance ${money(Number(res.wallet.balance_kes))}`,
      });
    } catch (e) {
      toast({
        title: "Wallet unavailable",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setWalletBusy(false);
    }
  };

  /**
   * Debit only. Wallet credits are impossible from this surface — they must
   * flow through the funding wizard and a verified M-Pesa callback.
   */
  const move = async (_direction: "debit", amount: number) => {
    if (!wallet) return;
    setWalletBusy(true);
    try {
      const res = await charterApi.moveCorporateWallet({
        wallet_id: wallet.id,
        direction: "debit",
        amount_kes: amount,
        reference,
        booking_id: bookingId ?? undefined,
        cost_center: procurement.costCenter.trim() || undefined,
        approver_name: procurement.approverName.trim() || undefined,
        approver_title: procurement.approverTitle.trim() || undefined,
      });
      setWallet(res.wallet);
      setSettled(true);
      onWalletSettled?.(res.wallet);
      toast({
        title: "Invoice approved from wallet",
        description: `${totalLabel} debited · balance ${money(Number(res.wallet.balance_kes))}`,
      });
    } catch (e) {
      toast({
        title: "Approval failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setWalletBusy(false);
    }
  };


  const balance = Number(wallet?.balance_kes ?? 0);
  const shortfall = Math.max(0, Math.round(totalKes) - balance);

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Corporate organisation approval</h2>
          <p className="text-sm text-muted-foreground">
            Travel is authorised by the organisation carrying the cost — not by the passenger.
          </p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Building2 className="h-3 w-3" aria-hidden="true" />
          {procurement.organizationName.trim() || "Organisation pending"}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="approval-org">Corporate organisation</Label>
          <Input
            id="approval-org"
            value={procurement.organizationName}
            onChange={(e) => patch({ organizationName: e.target.value })}
            placeholder="Deduced from your work email"
            aria-invalid={Boolean(err("organizationName"))}
          />
          {err("organizationName") && <p className="mt-1 text-xs text-destructive" role="alert">{err("organizationName")}</p>}
        </div>
        <div>
          <Label htmlFor="approval-authority">Approving authority</Label>
          <Input
            id="approval-authority"
            value={procurement.approverName}
            onChange={(e) => patch({ approverName: e.target.value })}
            placeholder="Full name of the signatory"
            aria-invalid={Boolean(err("approverName"))}
          />
          {err("approverName") && <p className="mt-1 text-xs text-destructive" role="alert">{err("approverName")}</p>}
        </div>
        <div>
          <Label htmlFor="approval-title">Title of the approving authority</Label>
          <Select value={procurement.approverTitle} onValueChange={(v) => patch({ approverTitle: v })}>
            <SelectTrigger id="approval-title" aria-invalid={Boolean(err("approverTitle"))}>
              <SelectValue placeholder="Select a title" />
            </SelectTrigger>
            <SelectContent>
              {APPROVER_TITLES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err("approverTitle") && <p className="mt-1 text-xs text-destructive" role="alert">{err("approverTitle")}</p>}
        </div>
        <div>
          <Label htmlFor="approval-cc">Cost centre / department</Label>
          <Input
            id="approval-cc"
            value={procurement.costCenter}
            onChange={(e) => patch({ costCenter: e.target.value })}
            placeholder="e.g. OPS-NBO-01"
            aria-invalid={Boolean(err("costCenter"))}
          />
          {err("costCenter") && <p className="mt-1 text-xs text-destructive" role="alert">{err("costCenter")}</p>}
        </div>
        <div>
          <Label htmlFor="approval-po">Purchase order (optional)</Label>
          <Input
            id="approval-po"
            value={procurement.purchaseOrder}
            onChange={(e) => patch({ purchaseOrder: e.target.value })}
            placeholder="PO number quoted on the invoice"
          />
        </div>
        <div>
          <Label htmlFor="approval-schedule">Invoice schedule</Label>
          <Select
            value={procurement.invoiceSchedule}
            onValueChange={(v) => patch({ invoiceSchedule: v as ProcurementDetails["invoiceSchedule"] })}
          >
            <SelectTrigger id="approval-schedule"><SelectValue /></SelectTrigger>
            <SelectContent>
              {INVOICE_SCHEDULES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="approval-second">Counter-signatory (optional)</Label>
          <Input
            id="approval-second"
            value={procurement.secondApprover}
            onChange={(e) => patch({ secondApprover: e.target.value })}
            placeholder="Second approver for high-value missions"
          />
        </div>
      </div>

      <div className="rounded-xl bg-secondary/50 p-4 text-sm">
        <p className="font-medium">Approval chain</p>
        <ol className="mt-1 space-y-0.5 text-muted-foreground">
          {approvalChain(procurement).map((line, i) => (
            <li key={line}>{i + 1}. {line}</li>
          ))}
        </ol>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <Checkbox
          id="corporate-approve"
          checked={approved}
          onCheckedChange={(v) => {
            setAttempted(true);
            if (v === true && !ready) return;
            onApprovedChange(v === true);
          }}
          className="mt-0.5"
        />
        <div>
          <Label htmlFor="corporate-approve" className="font-medium">
            I authorise this mission on behalf of {procurement.organizationName.trim() || "the organisation"}
          </Label>
          <p className="text-xs text-muted-foreground">
            Signed as {procurement.approverName.trim() || "the approving authority"}
            {procurement.approverTitle ? `, ${procurement.approverTitle}` : ""} — recorded in the tamper-evident audit
            trail with the cost centre and purchase order.
          </p>
          {attempted && !ready && (
            <p className="mt-1 text-xs text-destructive" role="alert">
              Complete the organisation and approving-authority details above before authorising.
            </p>
          )}
        </div>
      </div>

      {walletSelected && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-medium">
              <Wallet className="h-4 w-4 text-primary" aria-hidden="true" /> Corporate wallet
            </p>
            {wallet && <Badge variant="outline">Balance {money(balance)}</Badge>}
          </div>

          {!signedIn ? (
            <p className="text-xs text-muted-foreground">Sign in to provision and fund the corporate wallet.</p>
          ) : !wallet ? (
            <>
              <p className="text-xs text-muted-foreground">
                No wallet exists for {procurement.organizationName.trim() || "this organisation"} yet — create one to
                pre-fund and settle authorised travel.
              </p>
              <Button size="sm" onClick={() => void provisionWallet()} disabled={walletBusy}>
                {walletBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create corporate wallet
              </Button>
            </>
          ) : (
            <>
              {shortfall > 0 && (
                <p className="text-xs text-destructive" role="alert">
                  Fund at least {money(shortfall)} more to approve {totalLabel} from this wallet.
                </p>
              )}
              <WalletFundingWizard
                wallet={wallet}
                ensureWallet={async () => wallet}
                defaults={{
                  costCenter: procurement.costCenter.trim(),
                  approverName: procurement.approverName.trim(),
                  approverTitle: procurement.approverTitle.trim(),
                }}
                onWalletChange={setWallet}
              />
              <div className="flex flex-wrap items-end gap-2">

                <Button
                  size="sm"
                  disabled={walletBusy || !approved || settled || shortfall > 0}
                  onClick={() => void move("debit", Math.round(totalKes))}
                >
                  {walletBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  {settled ? "Approved from wallet" : `Approve ${totalLabel} from wallet`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default CorporateApprovalPanel;
