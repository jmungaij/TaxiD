/**
 * FLAG A SERVICE ISSUE.
 *
 * Raises a customer-facing exception against an account from the field, with the
 * evidence the person actually has. It is written to the shared signal register,
 * so it appears in the exception centre, in the next best action queue and on the
 * account's health reading — one record, every surface.
 */
import * as React from "react";
import { AlertTriangle } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { emitSignal, type SignalSeverity, type SignalType, type SignalUrgency } from "@/lib/intelligence/signals";

const KINDS: { value: SignalType; label: string; severity: SignalSeverity; urgency: SignalUrgency }[] = [
  { value: "service_exception", label: "Service did not run as promised", severity: "high", urgency: "today" },
  { value: "customer_complaint", label: "Customer complained", severity: "high", urgency: "now" },
  { value: "customer_requested_information", label: "Customer is waiting on information from us", severity: "medium", urgency: "today" },
  { value: "sla_risk", label: "We are about to miss a committed time", severity: "high", urgency: "now" },
  { value: "payment_overdue", label: "Payment is overdue", severity: "medium", urgency: "normal" },
];

export function FlagServiceIssueDialog({
  customers,
  onRaised,
}: {
  /** Accounts the employee can raise against; free text is allowed for a client not yet on an account. */
  customers: { id: string | null; label: string }[];
  onRaised?: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<SignalType>("service_exception");
  const [customer, setCustomer] = React.useState<string>(customers[0]?.label ?? "");
  const [what, setWhat] = React.useState("");
  const [whenAt, setWhenAt] = React.useState("");
  const [effect, setEffect] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const chosen = KINDS.find((k) => k.value === kind)!;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const account = customers.find((c) => c.label === customer);
      const id = await emitSignal({
        signalKey: `field_raised:${kind}:${customer.trim().toLowerCase()}:${what.trim().toLowerCase().slice(0, 40)}`,
        type: kind,
        source: "field_raised",
        entityType: "account",
        entityId: account?.id ?? null,
        accountId: account?.id ?? null,
        customerLabel: customer.trim() || null,
        severity: chosen.severity,
        urgency: chosen.urgency,
        headline: `${customer.trim() || "Customer not named"} — ${what.trim()}`,
        customerImpact: effect.trim() || null,
        evidence: [
          { label: "What happened", value: what.trim() },
          { label: "When", value: whenAt.trim() || "not stated" },
          { label: "Effect on the customer", value: effect.trim() || "not stated" },
          { label: "Raised by", value: "the person handling the account, from the field" },
        ],
        recommendedAction: "Contact the customer, fix the cause in its own system of record, then close this off.",
      });
      if (!id) throw new Error("The issue could not be recorded.");
      toast({ title: "Service issue raised", description: `${customer.trim()} — now visible in the exception centre.` });
      setOpen(false);
      setWhat("");
      setWhenAt("");
      setEffect("");
      onRaised?.();
    } catch (err) {
      toast({
        title: "Not raised",
        description: err instanceof Error ? err.message : "The issue could not be recorded.",
        variant: "destructive",
      });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <AlertTriangle className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Flag a service issue
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Flag a service issue</DialogTitle>
          <DialogDescription>
            Raise what the customer is actually experiencing. It joins your exceptions and your recommended actions
            immediately, and stays open until it is resolved.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="issue-kind">What kind of issue</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as SignalType)}>
              <SelectTrigger id="issue-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-customer">Customer</Label>
            {customers.length > 0 ? (
              <Select value={customer} onValueChange={setCustomer}>
                <SelectTrigger id="issue-customer">
                  <SelectValue placeholder="Choose the customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.label} value={c.label}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="issue-customer"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="Name the customer as they are known"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-what">What happened</Label>
            <Textarea
              id="issue-what"
              value={what}
              onChange={(e) => setWhat(e.target.value)}
              placeholder="State only what you know happened"
              rows={3}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="issue-when">When</Label>
              <Input
                id="issue-when"
                value={whenAt}
                onChange={(e) => setWhenAt(e.target.value)}
                placeholder="e.g. this morning's airport run"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="issue-effect">Effect on the customer</Label>
              <Input
                id="issue-effect"
                value={effect}
                onChange={(e) => setEffect(e.target.value)}
                placeholder="e.g. their director missed a flight"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving || what.trim().length < 4 || customer.trim().length < 2}>
              {saving ? "Raising…" : "Raise the issue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default FlagServiceIssueDialog;
