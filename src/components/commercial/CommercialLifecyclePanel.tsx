/**
 * Commercial lifecycle panel — the quote-to-cash ladder for one enquiry.
 *
 * Shows where the record stands, what the next step needs, which documents are
 * missing, and whether the value counts as revenue yet. Advancing is a
 * controlled action: the engine refuses a step without its paperwork, and an
 * override demands a written reason and manager authority.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, ArrowRight, Check, CircleDot, FileCheck2, Lock } from "lucide-react";
import {
  DOCUMENT_LABEL,
  KES,
  advanceErrorMessage,
  advanceLifecycle,
  fetchLifecycle,
  recordEvidence,
  type LifecycleDetail,
} from "@/lib/commercial/lifecycle";

interface Props {
  leadId: string;
  leadRef?: string | null;
  /** Called after a state change so the parent list can refresh. */
  onChanged?: () => void;
}

export default function CommercialLifecyclePanel({ leadId, leadRef, onChanged }: Props) {
  const qc = useQueryClient();
  const key = ["commercial-lifecycle", leadId];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => fetchLifecycle(leadId) });

  const [reason, setReason] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [docType, setDocType] = React.useState("");
  const [docRef, setDocRef] = React.useState("");

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: key });
    onChanged?.();
  };

  const advance = useMutation({
    mutationFn: async (asOverride: boolean) => {
      if (!data?.next_state) throw new Error("NO_NEXT_STEP");
      return advanceLifecycle({
        leadId,
        toState: data.next_state,
        amountKes: amount.trim() ? Number(amount) : null,
        reason: reason.trim() || null,
        override: asOverride,
      });
    },
    onSuccess: async (res) => {
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: advanceErrorMessage(res.error),
          description: res.missing?.length
            ? `Still needed: ${res.missing.map((m) => m.label).join(", ")}`
            : undefined,
        });
        return;
      }
      toast({
        title: `Moved to ${res.state?.replace(/_/g, " ").toLowerCase()}`,
        description:
          res.revenue_treatment === "qualifying"
            ? "This value now counts towards the monthly target."
            : "This value does not count as revenue yet.",
      });
      setReason("");
      setAmount("");
      await refresh();
    },
    onError: (e: unknown) =>
      toast({ variant: "destructive", title: advanceErrorMessage(String((e as Error)?.message ?? "")) }),
  });

  const addEvidence = useMutation({
    mutationFn: () =>
      recordEvidence({ leadId, documentType: docType, reference: docRef.trim() || null }),
    onSuccess: async () => {
      toast({ title: "Document recorded" });
      setDocType("");
      setDocRef("");
      await refresh();
    },
    onError: (e: unknown) =>
      toast({ variant: "destructive", title: advanceErrorMessage(String((e as Error)?.message ?? "")) }),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!data?.exists) {
    return (
      <p className="text-xs text-muted-foreground">
        No commercial lifecycle record for this enquiry yet.
      </p>
    );
  }

  const d = data as LifecycleDetail;
  const nextMissing = d.next_missing ?? [];
  const blocked = nextMissing.length > 0;

  return (
    <div className="space-y-4" data-testid="commercial-lifecycle">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Commercial lifecycle {leadRef ? `· ${leadRef}` : ""}
          </p>
          <p className="text-sm font-semibold">{d.current_label}</p>
        </div>
        <Badge variant={d.is_revenue ? "default" : "secondary"}>
          {d.is_revenue ? "Counts as revenue" : "Not revenue yet"}
        </Badge>
      </div>

      {/* Ladder */}
      <ol className="space-y-1">
        {(d.states ?? []).map((s) => (
          <li
            key={s.state}
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
              s.position === "current" ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <span className="mt-0.5">
              {s.position === "complete" ? (
                <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
              ) : s.position === "current" ? (
                <CircleDot className="h-3.5 w-3.5 text-primary" aria-hidden />
              ) : (
                <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{s.label}</span>
              {s.revenue_treatment === "qualifying" && (
                <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                  Revenue
                </Badge>
              )}
              <span className="block text-muted-foreground">
                {s.position === "pending" ? s.entry_condition : s.exit_condition}
              </span>
              {s.position !== "complete" && s.missing.length > 0 && (
                <span className="mt-1 block text-muted-foreground">
                  Needs: {s.missing.map((m) => m.label).join(", ")}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      {/* Values recorded at each stage */}
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ["Contracted", d.values?.contracted_kes],
          ["Delivered", d.values?.delivered_kes],
          ["Invoiced", d.values?.invoiced_kes],
          ["Recognised", d.values?.recognised_kes],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-md border p-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums">{KES(value as number | null)}</dd>
          </div>
        ))}
      </dl>

      {d.blocked_reason && (
        <p className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-hidden />
          {d.blocked_reason}
        </p>
      )}

      {/* Record a document */}
      <div className="rounded-md border p-3">
        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <FileCheck2 className="h-3.5 w-3.5" aria-hidden /> Record a document
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Select value={docType} onValueChange={setDocType}>
            <SelectTrigger aria-label="Document">
              <SelectValue placeholder="Document" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DOCUMENT_LABEL).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={docRef}
            onChange={(e) => setDocRef(e.target.value)}
            placeholder="Reference or number"
            aria-label="Document reference"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!docType || addEvidence.isPending}
            onClick={() => addEvidence.mutate()}
          >
            Record
          </Button>
        </div>
        {(d.evidence ?? []).length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {(d.evidence ?? []).slice(0, 6).map((e) => (
              <li key={`${e.document_type}-${e.recorded_at}`}>
                {DOCUMENT_LABEL[e.document_type] ?? e.document_type}
                {e.reference ? ` · ${e.reference}` : ""} · {new Date(e.recorded_at).toLocaleDateString("en-KE")}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Advance */}
      {d.next_state && (
        <div className="rounded-md border p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Next step
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor={`amt-${leadId}`} className="text-xs">
                Value at this step (KES, optional)
              </Label>
              <Input
                id={`amt-${leadId}`}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Leave blank to carry the agreed value"
              />
            </div>
            <div>
              <Label htmlFor={`rsn-${leadId}`} className="text-xs">
                Note (required when overriding)
              </Label>
              <Textarea
                id={`rsn-${leadId}`}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What happened"
              />
            </div>
          </div>

          {blocked && (
            <p className="mt-2 text-xs text-muted-foreground">
              Missing before this step: {nextMissing.map((m) => m.label).join(", ")}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate(false)}>
              <ArrowRight className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Move to {d.next_state.replace(/_/g, " ").toLowerCase()}
            </Button>
            {blocked && (
              <Button
                size="sm"
                variant="outline"
                disabled={advance.isPending || !reason.trim()}
                onClick={() => advance.mutate(true)}
              >
                Override with a reason
              </Button>
            )}
          </div>
        </div>
      )}

      {(d.history ?? []).length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {(d.history ?? []).slice(0, 5).map((h) => (
            <li key={`${h.to_state}-${h.at}`}>
              {new Date(h.at).toLocaleDateString("en-KE")} · {h.from_state ?? "opened"} → {h.to_state}
              {h.is_override ? " · overridden" : ""}
              {h.reason ? ` · ${h.reason}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
