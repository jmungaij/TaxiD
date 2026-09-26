import { useState, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { titleise } from "@/lib/staff/org/types";

/** Labelled field used across every organisation form. */
export function Field({
  label, children, hint, className,
}: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TextField({
  label, value, onChange, placeholder, type = "text", hint, required,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; hint?: string; required?: boolean;
}) {
  return (
    <Field label={required ? `${label} *` : label} hint={hint}>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </Field>
  );
}

export function AreaField({
  label, value, onChange, placeholder, rows = 3,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <Field label={label}>
      <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </Field>
  );
}

export function SelectField({
  label, value, onChange, options, placeholder = "Select…", hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder?: string; hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Dialog wrapper that keeps every create/edit form consistent. */
export function FormDialog({
  trigger, title, description, onSubmit, children, submitLabel = "Save", open, onOpenChange, busy,
}: {
  trigger: ReactNode; title: string; description?: string;
  onSubmit: () => Promise<void> | void; children: ReactNode; submitLabel?: string;
  open?: boolean; onOpenChange?: (v: boolean) => void; busy?: boolean;
}) {
  const [internal, setInternal] = useState(false);
  const isOpen = open ?? internal;
  const setOpen = onOpenChange ?? setInternal;
  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              await onSubmit();
              setOpen(false);
            }}
          >
            {busy ? "Saving…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TONE: Record<string, string> = {
  active: "border-success/40 text-success",
  published: "border-success/40 text-success",
  verified: "border-success/40 text-success",
  achieved: "border-success/40 text-success",
  certified: "border-success/40 text-success",
  done: "border-success/40 text-success",
  closed: "border-muted-foreground/30 text-muted-foreground",
  draft: "border-muted-foreground/30 text-muted-foreground",
  inactive: "border-muted-foreground/30 text-muted-foreground",
  archived: "border-muted-foreground/30 text-muted-foreground",
  pending: "border-warning/40 text-warning",
  in_review: "border-warning/40 text-warning",
  at_risk: "border-warning/40 text-warning",
  open: "border-info/40 text-info",
  in_progress: "border-info/40 text-info",
  approved: "border-info/40 text-info",
  rejected: "border-destructive/40 text-destructive",
  missed: "border-destructive/40 text-destructive",
  critical: "border-destructive/40 text-destructive",
  high: "border-warning/40 text-warning",
  expired: "border-destructive/40 text-destructive",
};

export function StatusPill({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className={cn("text-[10px] tracking-wide", TONE[value] ?? "", className)}>
      {titleise(value)}
    </Badge>
  );
}

/** Marks whether a record is live or development seed data. Never lie about this. */
export function ProvenanceTag({ provenance }: { provenance: string | null | undefined }) {
  if (!provenance) return null;
  const seeded = provenance === "SEEDED";
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px]", seeded ? "border-warning/50 text-warning" : "border-primary/40 text-primary")}
    >
      {seeded ? "Seed data" : "Live"}
    </Badge>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <div className="text-sm font-medium">{title}</div>
      {hint && <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const money = (cents: number | null | undefined, currency = "KES") =>
  cents === null || cents === undefined
    ? "—"
    : new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);

export const dateText = (v: string | null | undefined) =>
  !v ? "—" : new Date(v).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
