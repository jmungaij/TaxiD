import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Check, Banknote, Info, Upload } from "lucide-react";
import { toast } from "sonner";

interface Props {
  corporateId: string | null;
  corporateName?: string;
  balanceCents: number;
}

const PAYBILL = "4573823";
const BUSINESS = "Yalla Beena Limited";

/**
 * Cash pre-funding via M-Pesa Paybill. Persistent CORP-xxxxxxxx reference is read
 * from corporate_accounts.paybill_reference. Members can submit a payment proof
 * (M-Pesa code + screenshot) which an admin reviews and posts into the Cash Ledger.
 */
export function CorporatePaybillCard({ corporateId, corporateName, balanceCents }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [accountRef, setAccountRef] = useState<string>("—");
  const [showProof, setShowProof] = useState(false);

  useEffect(() => {
    if (!corporateId) { setAccountRef("—"); return; }
    (async () => {
      const { data } = await supabase.from("corporate_accounts")
        .select("paybill_reference").eq("id", corporateId).maybeSingle();
      setAccountRef(data?.paybill_reference ?? `CORP-${corporateId.slice(0, 8).toUpperCase()}`);
    })();
  }, [corporateId]);

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    toast.success(`${label} copied`);
    setTimeout(() => setCopied(null), 1500);
  }

  // Proof submission form state
  const [mpesaCode, setMpesaCode] = useState("");
  const [amount, setAmount] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitProof() {
    if (!corporateId || !user) return;
    if (!mpesaCode || !amount) { toast.error("M-Pesa code and amount are required"); return; }
    setSubmitting(true);
    try {
      let proofPath: string | null = null;
      if (file) {
        const path = `${corporateId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const up = await supabase.storage.from("paybill-proofs").upload(path, file, { upsert: false });
        if (up.error) throw up.error;
        proofPath = path;
      }
      const cents = Math.round(parseFloat(amount) * 100);
      const { error } = await supabase.from("corporate_paybill_proofs").insert({
        corporate_id: corporateId,
        mpesa_code: mpesaCode.trim().toUpperCase(),
        amount_cents: cents,
        payer_phone: payerPhone || null,
        paid_at: paidAt ? new Date(paidAt).toISOString() : null,
        proof_file_path: proofPath,
        paybill_reference: accountRef,
        submitted_by: user.id,
      });
      if (error) throw error;
      toast.success("Proof submitted — awaiting admin review");
      setMpesaCode(""); setAmount(""); setPayerPhone(""); setPaidAt(""); setFile(null);
      setShowProof(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSubmitting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Banknote className="h-4 w-4" />Pay via M-Pesa Paybill</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Banknote className="h-5 w-5 text-primary" />Cash Top-Up — M-Pesa Paybill</DialogTitle>
          <DialogDescription>
            TaxiD corporates fund their wallet via <b>M-Pesa Paybill</b>. After paying, submit your M-Pesa confirmation
            below so an admin can verify and post the top-up into your Cash Ledger.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Row label="Business" value={BUSINESS} onCopy={copy} copied={copied} />
          <Row label="Paybill" value={PAYBILL} onCopy={copy} copied={copied} highlight />
          <Row label="Account Reference" value={accountRef} onCopy={copy} copied={copied} highlight />
          {corporateName && <Row label="Corporate" value={corporateName} onCopy={copy} copied={copied} />}
          <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground flex gap-2">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <div>Current balance: <b>KES {(balanceCents / 100).toLocaleString()}</b>. The top-up will post to your Cash Ledger after admin verification (usually minutes).</div>

          </div>

          {!showProof ? (
            <Button variant="outline" className="w-full gap-2" onClick={() => setShowProof(true)}>
              <Upload className="h-4 w-4" />Submit M-Pesa payment proof
            </Button>
          ) : (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">M-Pesa code *</Label>
                  <Input value={mpesaCode} onChange={e => setMpesaCode(e.target.value)} placeholder="QXY1ABC23D" /></div>
                <div><Label className="text-xs">Amount (KES) *</Label>
                  <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="50000" /></div>
                <div><Label className="text-xs">Payer phone</Label>
                  <Input value={payerPhone} onChange={e => setPayerPhone(e.target.value)} placeholder="2547..." /></div>
                <div><Label className="text-xs">Paid at</Label>
                  <Input type="datetime-local" value={paidAt} onChange={e => setPaidAt(e.target.value)} /></div>
              </div>
              <div>
                <Label className="text-xs">Screenshot / receipt (optional)</Label>
                <Input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <DialogFooter className="!flex-row !justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => setShowProof(false)}>Cancel</Button>
                <Button size="sm" onClick={submitProof} disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit for review"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, onCopy, copied, highlight }: {
  label: string; value: string;
  onCopy: (l: string, v: string) => void; copied: string | null; highlight?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${highlight ? "bg-primary/5 border-primary/30" : ""}`}>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-mono text-sm font-semibold">{value}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={() => onCopy(label, value)} className="gap-1">
        {copied === label ? <Check className="h-4 w-4 text-status-success" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}
