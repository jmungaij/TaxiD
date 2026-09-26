/**
 * LODGE A BANK GUARANTEE.
 *
 * Uploads the guarantee document into the company's private document store and
 * records it as LODGED. Nothing here grants credit: the lifecycle (document
 * check → bank check → recorded independent bank confirmation → verify →
 * approve → activate) belongs to finance, and the credit limit SAFARID authorises
 * is a separate decision. The document hash is recorded so the file that was
 * verified can be proven later.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { lodgeGuarantee, sha256Hex, uploadGuaranteeDocument } from "@/lib/corporate/payments";

interface Props {
  corporateId: string;
  defaultEntityName?: string;
  onLodged?: () => void;
}

const ERROR_TEXT: Record<string, string> = {
  not_authorised: "Only a company manager or SAFARID finance may lodge a guarantee.",
  invalid_amount: "Enter the guaranteed amount in shillings.",
  document_required: "The guarantee document is required.",
  expiry_must_be_in_the_future: "The expiry date must be in the future.",
  invalid_validity_window: "The start date must be on or before the expiry date.",
};

export function LodgeGuaranteeForm({ corporateId, defaultEntityName, onLodged }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    guarantee_number: "",
    issuing_bank: "",
    legal_entity_name: defaultEntityName ?? "",
    amount_kes: "",
    issue_date: "",
    effective_date: "",
    expiry_date: "",
  });

  const submit = async () => {
    if (!file) {
      toast.error("Attach the guarantee document.");
      return;
    }
    const amount = Number(form.amount_kes);
    if (!form.guarantee_number.trim() || !form.issuing_bank.trim() || !form.legal_entity_name.trim()) {
      toast.error("Guarantee number, issuing bank and the guaranteed entity are all required.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter the guaranteed amount in shillings.");
      return;
    }
    if (!form.issue_date || !form.effective_date || !form.expiry_date) {
      toast.error("Issue, start and expiry dates are required.");
      return;
    }
    setBusy(true);
    try {
      const [path, hash] = await Promise.all([uploadGuaranteeDocument(corporateId, file), sha256Hex(file)]);
      const res = await lodgeGuarantee({
        corporateId,
        guaranteeNumber: form.guarantee_number.trim(),
        issuingBank: form.issuing_bank.trim(),
        legalEntityName: form.legal_entity_name.trim(),
        amountCents: Math.round(amount * 100),
        issueDate: form.issue_date,
        effectiveDate: form.effective_date,
        expiryDate: form.expiry_date,
        documentStoragePath: path,
        documentSha256: hash,
        documentReference: file.name,
      });
      if (!res.ok) {
        toast.error(ERROR_TEXT[res.error ?? ""] ?? res.error ?? "The guarantee could not be lodged.");
        return;
      }
      toast.success("Guarantee lodged. It must be verified, approved and activated before any credit exists.");
      setFile(null);
      setForm({
        guarantee_number: "",
        issuing_bank: "",
        legal_entity_name: defaultEntityName ?? "",
        amount_kes: "",
        issue_date: "",
        effective_date: "",
        expiry_date: "",
      });
      onLodged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-analytics-id="lodge-bank-guarantee">
      <CardHeader>
        <CardTitle className="text-base">Lodge a bank guarantee</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bg-number">Guarantee number</Label>
            <Input
              id="bg-number"
              value={form.guarantee_number}
              onChange={(e) => setForm({ ...form, guarantee_number: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bg-bank">Issuing bank</Label>
            <Input
              id="bg-bank"
              value={form.issuing_bank}
              onChange={(e) => setForm({ ...form, issuing_bank: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="bg-entity">Company the guarantee covers</Label>
            <Input
              id="bg-entity"
              value={form.legal_entity_name}
              onChange={(e) => setForm({ ...form, legal_entity_name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bg-amount">Guaranteed amount (KES)</Label>
            <Input
              id="bg-amount"
              inputMode="numeric"
              value={form.amount_kes}
              onChange={(e) => setForm({ ...form, amount_kes: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bg-issue">Issue date</Label>
            <Input
              id="bg-issue"
              type="date"
              value={form.issue_date}
              onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bg-effective">Valid from</Label>
            <Input
              id="bg-effective"
              type="date"
              value={form.effective_date}
              onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bg-expiry">Expires</Label>
            <Input
              id="bg-expiry"
              type="date"
              value={form.expiry_date}
              onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="bg-file">Guarantee document (PDF or scan)</Label>
            <Input
              id="bg-file"
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Lodge guarantee
          </Button>
          <p className="text-xs text-muted-foreground">
            Lodging a document does not create credit. SAFARID must verify it with the issuing bank, approve it, activate
            it and authorise a credit limit separately.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
