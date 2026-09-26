/**
 * Enterprise Procurement section of the mission workspace.
 *
 * Corporate, government and NGO buyers cannot raise a charter without the
 * procurement spine: which cost centre carries it, which purchase order it is
 * drawn against, which officer authorises it, how it settles (pre-funded
 * corporate wallet or invoice) and who in accounts payable receives the
 * paperwork. Captured here, once, and stamped onto the order, the invoice and
 * the tamper-evident audit trail.
 */
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Briefcase, Wallet } from "lucide-react";
import { charterApi, type CorporateWalletRow } from "@/lib/charter/api";
import {
  APPROVER_TITLES,
  INVOICE_SCHEDULES,
  approvalChain,
  procurementBlockers,
  type ProcurementDetails,
} from "@/lib/charter/corporateApproval";

interface Props {
  value: ProcurementDetails;
  onChange: (next: ProcurementDetails) => void;
  /** Wallet lookup only runs for a signed-in approving authority. */
  signedIn?: boolean;
}

const money = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

export function EnterpriseProcurementPanel({ value, onChange, signedIn = false }: Props) {
  const [wallets, setWallets] = useState<CorporateWalletRow[]>([]);
  const errors = useMemo(() => procurementBlockers(value), [value]);
  const patch = (v: Partial<ProcurementDetails>) => onChange({ ...value, ...v });

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    charterApi
      .listCorporateWallets()
      .then((r) => { if (alive) setWallets(r.wallets); })
      .catch(() => { /* wallet provisioning still available at approval */ });
    return () => { alive = false; };
  }, [signedIn]);

  const wallet = useMemo(() => {
    const org = value.organizationName.trim().toLowerCase();
    return wallets.find((w) => w.organization_name.toLowerCase() === org) ?? null;
  }, [wallets, value.organizationName]);

  return (
    <section
      id="enterprise-procurement"
      aria-labelledby="enterprise-procurement-heading"
      className="rounded-2xl border border-border bg-card p-6 space-y-5"
    >
      <div className="flex items-start gap-3">
        <Briefcase className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
        <div>
          <h2 id="enterprise-procurement-heading" className="font-semibold text-lg">Enterprise procurement</h2>
          <p className="text-sm text-muted-foreground">
            Cost allocation, authorising officer and settlement route — printed on the order, the invoice and the audit trail.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="organizationName">Corporate organisation</Label>
          <Input
            id="organizationName" className="mt-2" placeholder="Registered entity carrying the cost"
            value={value.organizationName} onChange={(e) => patch({ organizationName: e.target.value })}
            aria-invalid={Boolean(errors.organizationName)}
          />
          {errors.organizationName && (
            <p className="mt-1 text-xs text-muted-foreground">{errors.organizationName}</p>
          )}
        </div>

        <div>
          <Label htmlFor="costCenter">Cost centre / department code</Label>
          <Input
            id="costCenter" className="mt-2" placeholder="e.g. FIN-01"
            value={value.costCenter} onChange={(e) => patch({ costCenter: e.target.value })}
            aria-invalid={Boolean(errors.costCenter)}
          />
          {errors.costCenter && <p className="mt-1 text-xs text-muted-foreground">{errors.costCenter}</p>}
        </div>

        <div>
          <Label htmlFor="purchaseOrder">Purchase order number (optional)</Label>
          <Input
            id="purchaseOrder" className="mt-2" placeholder="e.g. PO-2026-00841"
            value={value.purchaseOrder} onChange={(e) => patch({ purchaseOrder: e.target.value })}
          />
        </div>

        <div>
          <Label htmlFor="invoiceSchedule">Invoice schedule</Label>
          <Select
            value={value.invoiceSchedule}
            onValueChange={(v) => patch({ invoiceSchedule: v as ProcurementDetails["invoiceSchedule"] })}
          >
            <SelectTrigger id="invoiceSchedule" className="mt-2"><SelectValue placeholder="Select billing terms" /></SelectTrigger>
            <SelectContent>
              {INVOICE_SCHEDULES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="approverName">Approving officer</Label>
          <Input
            id="approverName" className="mt-2" placeholder="Full name of the authorising officer"
            value={value.approverName} onChange={(e) => patch({ approverName: e.target.value })}
            aria-invalid={Boolean(errors.approverName)}
          />
          {errors.approverName && <p className="mt-1 text-xs text-muted-foreground">{errors.approverName}</p>}
        </div>

        <div>
          <Label htmlFor="approverTitle">Officer title / mandate</Label>
          <Select value={value.approverTitle} onValueChange={(v) => patch({ approverTitle: v })}>
            <SelectTrigger id="approverTitle" className="mt-2"><SelectValue placeholder="Select the mandate held" /></SelectTrigger>
            <SelectContent>
              {APPROVER_TITLES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.approverTitle && <p className="mt-1 text-xs text-muted-foreground">{errors.approverTitle}</p>}
        </div>

        <div>
          <Label htmlFor="billingContactName">Billing contact (accounts payable)</Label>
          <Input
            id="billingContactName" className="mt-2" placeholder="Who receives the invoice"
            value={value.billingContactName} onChange={(e) => patch({ billingContactName: e.target.value })}
          />
        </div>

        <div>
          <Label htmlFor="billingContactEmail">Billing contact email</Label>
          <Input
            id="billingContactEmail" type="email" className="mt-2" placeholder="ap@organisation.co.ke"
            value={value.billingContactEmail} onChange={(e) => patch({ billingContactEmail: e.target.value })}
            aria-invalid={Boolean(errors.billingContactEmail)}
          />
          {errors.billingContactEmail && (
            <p className="mt-1 text-xs text-destructive" role="alert">{errors.billingContactEmail}</p>
          )}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-secondary/20 p-4">
        <div className="flex items-start gap-3">
          <Wallet className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
          <div>
            <Label htmlFor="useCorporateWallet" className="font-medium">Settle from the corporate wallet</Label>
            <p className="text-xs text-muted-foreground">
              {wallet
                ? `Pre-funded wallet available — balance ${money(wallet.balance_kes)}.`
                : signedIn
                  ? "No wallet exists for this organisation yet — it is provisioned when the officer authorises the mission."
                  : "Sign in as the approving officer to provision or fund the wallet."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {wallet && <Badge variant="secondary">{money(wallet.balance_kes)}</Badge>}
          <Switch
            id="useCorporateWallet"
            checked={value.useCorporateWallet}
            onCheckedChange={(v) => patch({ useCorporateWallet: v })}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="budgetNote">Budget / procurement note (optional)</Label>
        <Textarea
          id="budgetNote" className="mt-2" rows={2}
          placeholder="Vote head, framework agreement, tender reference or internal approval note"
          value={value.budgetNote} onChange={(e) => patch({ budgetNote: e.target.value })}
        />
      </div>

      <div className="rounded-xl border border-border/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval chain</p>
        <ol className="mt-2 space-y-1 text-sm">
          {approvalChain(value).map((line, i) => (
            <li key={line} className="text-muted-foreground"><span className="font-medium text-foreground">{i + 1}.</span> {line}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export default EnterpriseProcurementPanel;
