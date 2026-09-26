/**
 * CONTRACT LIFECYCLE CONTROLS.
 *
 * Creation, stage movement, customer acceptance and amendments. Every control
 * here calls the authoritative RPC that owns the rule: the client never edits an
 * activated contract directly and never computes a revenue figure — an amendment
 * posts only the difference the database calculates.
 */
import * as React from "react";
import { Loader2, PenLine, Plus, Stamp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  amendContract,
  createContract,
  fetchContractAccounts,
  formatContractValue,
  recordContractAcceptance,
  setContractStatus,
  CONTRACT_VALUE_TYPES,
  type ContractAccountOption,
  type ContractAmendment,
  type ContractRecord,
  type ContractValueType,
} from "@/lib/commercial/contractExecution";

/* ------------------------------------------------------------------ create */

export function CreateContractDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [accounts, setAccounts] = React.useState<ContractAccountOption[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    account_id: "",
    title: "",
    value_amount: "",
    currency: "KES",
    value_type: "one_time",
    term_start: "",
    term_end: "",
    payment_terms: "",
  });

  React.useEffect(() => {
    if (!open) return;
    void fetchContractAccounts().then(setAccounts);
  }, [open]);

  const submit = async () => {
    if (!form.account_id) {
      toast.error("Choose the customer account this contract belongs to");
      return;
    }
    setBusy(true);
    const res = await createContract({
      account_id: form.account_id,
      title: form.title || null,
      value_amount: form.value_amount ? Number(form.value_amount) : null,
      currency: form.currency || "KES",
      value_type: form.value_type,
      term_start: form.term_start || null,
      term_end: form.term_end || null,
      payment_terms: form.payment_terms || null,
    });
    setBusy(false);
    if (!res || res.ok === false) {
      toast.error(res && "error" in res ? String(res.error) : "Could not create the contract");
      return;
    }
    toast.success(`Contract ${res.contract_number ?? ""} created as a draft`);
    setOpen(false);
    setForm({ ...form, account_id: "", title: "", value_amount: "" });
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-3.5 w-3.5" /> New contract
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise a contract</DialogTitle>
          <DialogDescription>
            The contract starts as a draft in your name. Value and signatures can be recorded now or when they are
            agreed — nothing is counted as revenue until it is activated.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Customer account</Label>
            <Select value={form.account_id} onValueChange={(v) => setForm((f) => ({ ...f, account_id: v }))}>
              <SelectTrigger>
                <SelectValue placeholder={accounts.length ? "Choose an account" : "Loading accounts…"} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.legal_name ?? a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Mobility Service Contract"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Value (optional)</Label>
              <Input
                inputMode="decimal"
                value={form.value_amount}
                onChange={(e) => setForm((f) => ({ ...f, value_amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Currency</Label>
              <Input
                maxLength={3}
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Basis</Label>
              <Select value={form.value_type} onValueChange={(v) => setForm((f) => ({ ...f, value_type: v as ContractValueType }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_VALUE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Service start</Label>
              <Input
                type="date"
                value={form.term_start}
                onChange={(e) => setForm((f) => ({ ...f, term_start: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Service end</Label>
              <Input
                type="date"
                value={form.term_end}
                onChange={(e) => setForm((f) => ({ ...f, term_end: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Payment terms</Label>
            <Input
              value={form.payment_terms}
              onChange={(e) => setForm((f) => ({ ...f, payment_terms: e.target.value }))}
              placeholder="e.g. 14 days from invoice"
            />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Create draft contract
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------ stage moves */

const STAGE_MOVES: { value: string; label: string }[] = [
  { value: "internal_review", label: "Send for internal review" },
  { value: "approved", label: "Approved to send" },
  { value: "sent_to_customer", label: "Sent to customer" },
  { value: "under_negotiation", label: "In negotiation" },
  { value: "signature_pending", label: "Awaiting signature" },
  { value: "partially_signed", label: "Partly signed" },
  { value: "executed", label: "Signed by both parties" },
  { value: "declined", label: "Declined by customer" },
];

export function StageMover({ contract, onChanged }: { contract: ContractRecord; onChanged: () => void }) {
  const [next, setNext] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const move = async () => {
    if (!next) return;
    setBusy(true);
    const res = await setContractStatus(contract.contract_id, next);
    setBusy(false);
    if (!res || res.ok === false) {
      toast.error(res && "error" in res ? String(res.error) : "Could not move the contract");
      return;
    }
    toast.success("Contract stage updated");
    setNext("");
    onChanged();
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label className="text-xs">Move stage</Label>
        <Select value={next} onValueChange={setNext}>
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="Choose the next stage" />
          </SelectTrigger>
          <SelectContent>
            {STAGE_MOVES.filter((s) => s.value !== contract.status).map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" variant="outline" onClick={move} disabled={!next || busy}>
        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Update stage
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------- acceptance */

export function AcceptanceForm({ contract, onChanged }: { contract: ContractRecord; onChanged: () => void }) {
  const [form, setForm] = React.useState({
    acceptedOn: "",
    acceptedBy: "",
    channel: "email",
    reference: "",
    notes: "",
  });
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await recordContractAcceptance({ contractId: contract.contract_id, ...form });
    setBusy(false);
    if (!res || res.ok === false) {
      toast.error(
        res && "detail" in res && res.detail
          ? String(res.detail)
          : res && "error" in res
            ? String(res.error)
            : "Could not record the acceptance",
      );
      return;
    }
    toast.success("Customer acceptance recorded");
    setForm({ ...form, acceptedBy: "", reference: "", notes: "" });
    onChanged();
  };

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <Stamp className="h-3.5 w-3.5" /> Record customer acceptance
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Accepted on</Label>
          <Input
            type="date"
            value={form.acceptedOn}
            onChange={(e) => setForm((f) => ({ ...f, acceptedOn: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Accepted by</Label>
          <Input
            value={form.acceptedBy}
            onChange={(e) => setForm((f) => ({ ...f, acceptedBy: e.target.value }))}
            placeholder="Name and title"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">How it came</Label>
          <Select value={form.channel} onValueChange={(v) => setForm((f) => ({ ...f, channel: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="letter">Signed letter</SelectItem>
              <SelectItem value="purchase_order">Purchase order</SelectItem>
              <SelectItem value="portal">Customer portal</SelectItem>
              <SelectItem value="meeting_minute">Recorded meeting</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Evidence reference</Label>
          <Input
            value={form.reference}
            onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            placeholder="Email subject, PO number…"
          />
        </div>
      </div>
      <Textarea
        value={form.notes}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        placeholder="Anything the acceptance was conditional on"
      />
      <Button size="sm" onClick={submit} disabled={busy}>
        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Record acceptance
      </Button>
      <p className="text-[11px] text-muted-foreground">
        The date, the person who accepted and a reference to the evidence are all required — acceptance is never
        recorded on memory alone.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- amendments */

export function AmendmentHistory({ amendments }: { amendments: ContractAmendment[] }) {
  if (amendments.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <p className="text-xs font-semibold">Amendment history</p>
      {amendments.map((a) => (
        <div key={a.amendment_id} className="text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              #{a.amendment_no} {a.amendment_type.replace(/_/g, " ")}
            </Badge>
            <span className="text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</span>
            {a.value_delta != null && a.value_delta !== 0 && (
              <span className="font-medium">
                {a.value_delta > 0 ? "+" : ""}
                {formatContractValue(a.value_delta, a.currency)} to revenue ({a.revenue_period})
              </span>
            )}
          </div>
          <p className="mt-0.5 text-muted-foreground">
            {a.changed_fields.map((f) => f.replace(/_/g, " ")).join(", ")} — {a.reason}
          </p>
        </div>
      ))}
    </div>
  );
}

export function AmendmentForm({ contract, onChanged }: { contract: ContractRecord; onChanged: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    value_amount: contract.value_amount != null ? String(contract.value_amount) : "",
    value_type: contract.value_type,
    revenue_period: contract.revenue_period ?? "",
    term_start: contract.term_start ?? "",
    term_end: contract.term_end ?? "",
    payment_terms: contract.payment_terms ?? "",
    renewal_terms: contract.renewal_terms ?? "",
    billing_frequency: contract.billing_frequency ?? "",
    effective_date: "",
    reason: "",
  });

  const submit = async () => {
    if (form.reason.trim().length < 5) {
      toast.error("Explain what the customer agreed and why — an amendment is never recorded without a reason");
      return;
    }
    setBusy(true);
    const res = await amendContract(
      contract.contract_id,
      {
        value_amount: form.value_amount === "" ? null : Number(form.value_amount),
        value_type: form.value_type,
        revenue_period: form.revenue_period || null,
        term_start: form.term_start || null,
        term_end: form.term_end || null,
        payment_terms: form.payment_terms || null,
        renewal_terms: form.renewal_terms || null,
        billing_frequency: form.billing_frequency || null,
        effective_date: form.effective_date || null,
      },
      form.reason,
    );
    setBusy(false);
    if (!res || res.ok === false) {
      toast.error(
        res && "detail" in res && res.detail ? String(res.detail) : res && "error" in res ? String(res.error) : "Amendment failed",
      );
      return;
    }
    toast.success(
      res.value_delta && res.value_delta !== 0
        ? `Amendment ${res.amendment_no} recorded. ${formatContractValue(res.value_delta, res.currency ?? null)} ${
            res.value_delta > 0 ? "added to" : "taken off"
          } ${res.revenue_period}`
        : `Amendment ${res.amendment_no} recorded. The contract value is unchanged, so no revenue moved.`,
    );
    setForm((f) => ({ ...f, reason: "", effective_date: "" }));
    setOpen(false);
    onChanged();
  };

  return (
    <div className="space-y-3">
      <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
        <PenLine className="mr-1.5 h-3.5 w-3.5" /> {open ? "Cancel amendment" : "Amend this contract"}
      </Button>
      {open && (
        <div className="space-y-3 rounded-md border bg-background p-3">
          <p className="text-xs text-muted-foreground">
            Change the value, the dates or the commercial terms. The recorded revenue is corrected automatically —
            only the difference is posted, so this contract can never be counted twice.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Contract value</Label>
              <Input
                inputMode="decimal"
                value={form.value_amount}
                onChange={(e) => setForm((f) => ({ ...f, value_amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Basis</Label>
              <Select value={form.value_type} onValueChange={(v) => setForm((f) => ({ ...f, value_type: v as ContractValueType }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_VALUE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Revenue month for the change</Label>
              <Input
                type="month"
                value={form.revenue_period}
                onChange={(e) => setForm((f) => ({ ...f, revenue_period: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Service start</Label>
              <Input
                type="date"
                value={form.term_start}
                onChange={(e) => setForm((f) => ({ ...f, term_start: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Service end</Label>
              <Input
                type="date"
                value={form.term_end}
                onChange={(e) => setForm((f) => ({ ...f, term_end: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amendment effective from</Label>
              <Input
                type="date"
                value={form.effective_date}
                onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Billing frequency</Label>
              <Input
                value={form.billing_frequency}
                onChange={(e) => setForm((f) => ({ ...f, billing_frequency: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Payment terms</Label>
              <Input
                value={form.payment_terms}
                onChange={(e) => setForm((f) => ({ ...f, payment_terms: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Renewal terms</Label>
              <Input
                value={form.renewal_terms}
                onChange={(e) => setForm((f) => ({ ...f, renewal_terms: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">What was agreed, and with whom</Label>
            <Textarea
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. Two extra shuttles agreed with the operations director on 4 September"
            />
          </div>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Record amendment
          </Button>
        </div>
      )}
    </div>
  );
}
