/**
 * Legal compliance alerts — the non-blocking legal control surface.
 *
 * Business decision (owner, 2026-08-31): no legal gate enforces. Booking and
 * dispatch run to finality for every family — logistics, charter, rentals,
 * riders and drivers. When a transaction proceeds while an LG determination or a
 * regulatory requirement is unresolved, the gate raises an alert here instead of
 * refusing traffic, and an authorised person decides the compliance level.
 *
 * This surface never approves a determination. Acknowledging or resolving an
 * alert records a human judgement about the operational risk; the LG dossier
 * approval workflow remains the only route to an effective determination.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, ShieldCheck, ShieldAlert } from "lucide-react";

interface AlertRow {
  id: string;
  gate_stage: string;
  requirement_code: string;
  reason_code: string;
  decision: string;
  title: string;
  detail: string | null;
  service_family: string | null;
  required_action: string | null;
  owner_role: string;
  severity: string;
  status: string;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  acknowledgement_note: string | null;
  resolution_note: string | null;
}

const severityVariant = (severity: string): "destructive" | "secondary" | "outline" =>
  severity === "critical" ? "destructive" : severity === "high" ? "secondary" : "outline";

const statusVariant = (status: string): "destructive" | "secondary" | "outline" =>
  status === "open" ? "destructive" : status === "acknowledged" ? "secondary" : "outline";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });

export function LegalComplianceAlertsPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AlertRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("legal_compliance_alerts")
      .select(
        "id,gate_stage,requirement_code,reason_code,decision,title,detail,service_family,required_action,owner_role,severity,status,occurrences,first_seen_at,last_seen_at,acknowledgement_note,resolution_note",
      )
      .order("status", { ascending: true })
      .order("last_seen_at", { ascending: false })
      .limit(200)
      .returns<AlertRow[]>();
    if (err) {
      setError(err.message);
      setRows([]);
      return;
    }
    setError(null);
    setRows(data ?? []);
  }, []);

  useEffect(() => {
    void load();
    // Live: a new transaction against an unresolved control must surface without
    // a manual refresh.
    const channel = supabase
      .channel("legal-compliance-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "legal_compliance_alerts" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const triage = async (id: string, action: "acknowledge" | "resolve") => {
    const note = (notes[id] ?? "").trim();
    if (note.length < 20) {
      toast({
        title: "A written basis is required",
        description: "Record at least 20 characters explaining the compliance judgement.",
        variant: "destructive",
      });
      return;
    }
    setBusy(id);
    const { error: err } = await supabase.rpc("legal_triage_compliance_alert", {
      _alert_id: id,
      _action: action,
      _note: note,
    });
    setBusy(null);
    if (err) {
      toast({ title: "Not recorded", description: err.message, variant: "destructive" });
      return;
    }
    setNotes((n) => ({ ...n, [id]: "" }));
    toast({
      title: action === "acknowledge" ? "Acknowledged" : "Resolved",
      description: "The judgement and its basis are recorded against the alert.",
    });
    void load();
  };

  const open = useMemo(() => (rows ?? []).filter((r) => r.status !== "resolved"), [rows]);

  return (
    <div className="space-y-4">
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Legal gate is advisory, not blocking</AlertTitle>
        <AlertDescription>
          Bookings and dispatch complete for logistics, charter, rentals, riders and drivers regardless of legal state.
          Every transaction that runs against an unresolved control is recorded in the append-only legal compliance log
          and raised here for an authorised decision. Acknowledging an alert is not an approval — an LG determination
          only becomes effective through the dossier approval workflow.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Outstanding compliance alerts
            <Badge variant={open.length ? "destructive" : "outline"}>{open.length}</Badge>
          </CardTitle>
          <CardDescription>
            Grouped by stage, control and reason. Repeat transactions increase the occurrence count rather than creating
            duplicates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows === null && <Skeleton className="h-24 w-full" />}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Alerts could not be read</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {rows !== null && rows.length === 0 && !error && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              No transaction has run against an unresolved legal control yet.
            </p>
          )}

          {(rows ?? []).map((r) => (
            <div key={r.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                <Badge variant={severityVariant(r.severity)}>{r.severity}</Badge>
                <Badge variant="outline">{r.requirement_code}</Badge>
                <Badge variant="outline">{r.gate_stage}</Badge>
                {r.service_family && <Badge variant="outline">{r.service_family}</Badge>}
                <span className="text-xs text-muted-foreground">
                  {r.occurrences} transaction{r.occurrences === 1 ? "" : "s"} · first {when(r.first_seen_at)} · last{" "}
                  {when(r.last_seen_at)}
                </span>
              </div>

              <div>
                <p className="font-medium">{r.title}</p>
                {r.detail && <p className="text-sm text-muted-foreground">{r.detail}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  Reason <span className="font-mono">{r.reason_code}</span> · owner {r.owner_role}
                  {r.required_action ? ` · required: ${r.required_action}` : ""}
                </p>
              </div>

              {r.acknowledgement_note && (
                <p className="text-xs text-muted-foreground">Acknowledged basis: {r.acknowledgement_note}</p>
              )}
              {r.resolution_note && (
                <p className="text-xs text-muted-foreground">Resolution basis: {r.resolution_note}</p>
              )}

              {r.status !== "resolved" && (
                <div className="space-y-2">
                  <Textarea
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    placeholder="Record the compliance judgement and its basis (minimum 20 characters)."
                    rows={2}
                  />
                  <div className="flex gap-2">
                    {r.status === "open" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === r.id}
                        onClick={() => void triage(r.id, "acknowledge")}
                      >
                        Acknowledge
                      </Button>
                    )}
                    <Button size="sm" disabled={busy === r.id} onClick={() => void triage(r.id, "resolve")}>
                      Resolve
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default LegalComplianceAlertsPanel;
