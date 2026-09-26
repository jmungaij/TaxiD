/**
 * EDIT A LEAD'S DETAILS.
 *
 * Staff who own the lead (or hold CRM management) can correct the organisation,
 * the contact person, email, telephone, service and trip details. The database
 * decides who may write, validates email and telephone formats, and records
 * every changed field in an append-only history shown here.
 */
import * as React from "react";
import { Pencil, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { untypedDb } from "@/integrations/supabase/untyped";
import { contactPerson } from "@/lib/sales/leadContact";

type Fields = {
  organisation_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  service_interest: string;
  origin_label: string;
  destination_label: string;
  service_date: string;
  estimated_value_kes: string;
  notes: string;
};

const EMPTY: Fields = {
  organisation_name: "", contact_name: "", contact_email: "", contact_phone: "", service_interest: "",
  origin_label: "", destination_label: "", service_date: "", estimated_value_kes: "", notes: "",
};

const FIELD_LABEL: Record<string, string> = {
  organisation_name: "Organisation", contact_name: "Contact person", contact_email: "Email",
  contact_phone: "Telephone", service_interest: "Service", origin_label: "From", destination_label: "To",
  service_date: "Service date", estimated_value_kes: "Estimated value (KES)", notes: "Notes",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

interface Change { id: string; field: string; old_value: string | null; new_value: string | null; changed_at: string }

export function validateLeadFields(f: Fields): string | null {
  if (f.organisation_name.trim().length < 2) return "Enter the organisation name.";
  if (f.contact_name.trim() && contactPerson(f.contact_name) === null) return "Enter a real contact name rather than a placeholder.";
  if (f.contact_email.trim() && !EMAIL_RE.test(f.contact_email.trim())) return "Enter a valid email address.";
  if (f.contact_phone.trim() && !PHONE_RE.test(f.contact_phone.trim())) return "Enter a valid telephone number, e.g. +254 712 345678.";
  if (f.estimated_value_kes.trim() && !(Number(f.estimated_value_kes) >= 0)) return "Estimated value must be a positive number.";
  return null;
}

export function LeadDetailsDialog({ leadId, onSaved }: { leadId: string; onSaved?: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState<Fields>(EMPTY);
  const [orig, setOrig] = React.useState<Fields>(EMPTY);
  const [history, setHistory] = React.useState<Change[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const [{ data, error }, { data: changes }] = await Promise.all([
      untypedDb.from("sales_leads").select(Object.keys(EMPTY).join(",")).eq("id", leadId).maybeSingle(),
      untypedDb.from("sales_lead_changes").select("id, field, old_value, new_value, changed_at")
        .eq("lead_id", leadId).order("changed_at", { ascending: false }).limit(20),
    ]);
    if (error || !data) {
      toast({ title: "Could not open this lead", description: error?.message ?? "You may not have access.", variant: "destructive" });
      setOpen(false);
    } else {
      const row = data as Record<string, unknown>;
      const next = { ...EMPTY };
      (Object.keys(EMPTY) as (keyof Fields)[]).forEach((k) => {
        const v = row[k];
        next[k] = v == null ? "" : k === "contact_name" ? contactPerson(String(v)) ?? "" : String(v);
      });
      setF(next);
      setOrig(next);
      setHistory((changes as Change[]) ?? []);
    }
    setLoading(false);
  }, [leadId, toast]);

  React.useEffect(() => { if (open) void load(); }, [open, load]);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const dirty = (Object.keys(EMPTY) as (keyof Fields)[]).filter((k) => f[k].trim() !== orig[k].trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateLeadFields(f);
    if (problem) { toast({ title: "Check the details", description: problem, variant: "destructive" }); return; }
    if (!dirty.length) { setOpen(false); return; }
    const patch: Record<string, string | number | null> = {};
    for (const k of dirty) {
      const v = f[k].trim();
      patch[k] = k === "estimated_value_kes" ? (v ? Number(v) : null)
        : k === "contact_email" ? (v ? v.toLowerCase() : null)
        : v || null;
    }
    setSaving(true);
    const { error } = await untypedDb.from("sales_leads").update(patch).eq("id", leadId);
    setSaving(false);
    if (error) {
      toast({ title: "Not saved", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Lead updated", description: `${dirty.length} detail${dirty.length === 1 ? "" : "s"} changed for ${f.organisation_name}.` });
    setOpen(false);
    onSaved?.();
  };

  const field = (k: keyof Fields, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`lead-${k}`}>{FIELD_LABEL[k]}</Label>
      <Input id={`lead-${k}`} value={f[k]} onChange={set(k)} disabled={loading} {...props} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Edit details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit lead details</DialogTitle>
          <DialogDescription>Correct anything the client told you. Every change is recorded with your name and the time.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            {field("organisation_name", { required: true, maxLength: 200 })}
            {field("contact_name", { placeholder: "Full name as the client gave it", maxLength: 120 })}
            {field("contact_email", { type: "email", placeholder: "name@company.com", maxLength: 254 })}
            {field("contact_phone", { type: "tel", placeholder: "+254 712 345678", maxLength: 20 })}
            {field("service_interest", { maxLength: 120 })}
            {field("service_date", { type: "date" })}
            {field("origin_label", { maxLength: 160 })}
            {field("destination_label", { maxLength: 160 })}
            {field("estimated_value_kes", { type: "number", min: 0, step: "1" })}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-notes">Notes</Label>
            <Textarea id="lead-notes" value={f.notes} onChange={set("notes")} rows={3} maxLength={4000} disabled={loading} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || loading || !dirty.length}>
              {saving ? "Saving…" : dirty.length ? `Save ${dirty.length} change${dirty.length === 1 ? "" : "s"}` : "No changes"}
            </Button>
          </DialogFooter>
        </form>
        {history.length > 0 && (
          <div className="mt-2 border-t pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <History className="h-3.5 w-3.5" aria-hidden /> Recent changes
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {history.map((h) => (
                <li key={h.id}>
                  {new Date(h.changed_at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {" · "}<span className="font-medium text-foreground">{FIELD_LABEL[h.field] ?? h.field}</span>
                  {": "}{h.old_value || "blank"} → {h.new_value || "blank"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default LeadDetailsDialog;
