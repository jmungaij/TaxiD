/**
 * STAFF — Fleet Owner document review desk.
 *
 * Reviewers open the actual uploaded document (time-limited signed link), record
 * a decision with a reason, and the authoritative database function
 * carrier_evidence_review enforces permission, evidence presence and state.
 * Nothing here can mark a requirement satisfied without a stored document.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listComplianceItems, reviewEvidence, carrierMatchability,
  type ComplianceItemRow, type EligibilityVerdict,
} from "@/lib/logistics/carrier/onboarding";
import { evidenceDocumentUrl, listMyFleetOwners, type FleetOwnerCarrier } from "@/lib/logistics/carrier/portal";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import { Loader2, ExternalLink } from "lucide-react";

/** The documents compliance must clear before market access is possible. */
const FOCUS_CODES = ["FO-BUSINESS-REG", "FO-KRA-PIN", "FO-MOTOR-INSURANCE", "FO-SETTLEMENT-DESTINATION"];

const tone = (s: string) =>
  s === "VERIFIED" ? "bg-status-success/10 text-status-success border-status-success/30"
    : ["REJECTED", "EXPIRED"].includes(s) ? "bg-destructive/10 text-destructive border-destructive/30"
      : "bg-status-warning/10 text-status-warning border-status-warning/30";

export default function FleetOwnerDocumentReview() {
  const [carriers, setCarriers] = useState<FleetOwnerCarrier[]>([]);
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [items, setItems] = useState<ComplianceItemRow[]>([]);
  const [verdict, setVerdict] = useState<EligibilityVerdict | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const rows = await listMyFleetOwners();
        setCarriers(rows);
        setCarrierId(rows[0]?.id ?? null);
      } catch (e) {
        toast({ title: "Could not load Fleet Owners", description: (e as Error).message, variant: "destructive" });
      } finally { setLoading(false); }
    })();
  }, []);

  const refresh = useCallback(async (id: string) => {
    const [i, v] = await Promise.all([listComplianceItems(id), carrierMatchability(id)]);
    setItems(i); setVerdict(v);
  }, []);

  useEffect(() => { if (carrierId) void refresh(carrierId); }, [carrierId, refresh]);

  const visible = useMemo(
    () => items.filter((i) => showAll || FOCUS_CODES.includes(i.requirement_code)),
    [items, showAll],
  );

  async function open(path: string | null) {
    const url = await evidenceDocumentUrl(path);
    if (!url) {
      return toast({ title: "No document to open", description: "This requirement has no stored evidence yet.", variant: "destructive" });
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function decide(item: ComplianceItemRow, decision: "VERIFY" | "REJECT" | "LEGAL_REVIEW") {
    const note = (notes[item.id] ?? "").trim();
    if (decision !== "VERIFY" && note.length < 5) {
      return toast({ title: "A reason is required", description: "Record why the document was not accepted.", variant: "destructive" });
    }
    setBusy(item.id);
    const res = await reviewEvidence({ itemId: item.id, decision, notes: note || undefined });
    setBusy(null);
    if (res?.error) {
      setRefusals((p) => ({ ...p, [item.id]: `${res.code ?? "ERROR"}${res.message ? ` — ${res.message}` : ""}` }));
      return;
    }
    setRefusals((p) => { const n = { ...p }; delete n[item.id]; return n; });
    toast({ title: decision === "VERIFY" ? "Document verified" : "Decision recorded" });
    if (carrierId) await refresh(carrierId);
  }

  if (loading) return <main className="p-8"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></main>;

  return (
    <main className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fleet Owner document review</h1>
          <p className="text-sm text-muted-foreground">
            Business registration, KRA PIN, insurance and payout evidence — read the document, then record a decision with a reason.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={carrierId ?? ""}
            onChange={(e) => setCarrierId(e.target.value)}
            aria-label="Select Fleet Owner"
          >
            {carriers.map((c) => <option key={c.id} value={c.id}>{c.legal_entity_name}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show key documents" : "Show whole checklist"}
          </Button>
        </div>
      </header>

      {verdict && (
        <Alert variant={verdict.matchable ? "default" : "destructive"}>
          <AlertTitle>Market access: {verdict.state ?? "UNKNOWN"}</AlertTitle>
          <AlertDescription>
            {(verdict.blocking ?? []).length === 0
              ? "No outstanding blocker on the authoritative verdict."
              : (verdict.blocking ?? []).map((b, i) => (
                <span key={i} className="block text-xs">{String(b.code)}{b.requirement ? ` — ${String(b.requirement)}` : ""}</span>
              ))}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Documents</CardTitle>
          <CardDescription>Verification is refused by the database if no document is stored against the requirement.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {visible.length === 0 && <p className="text-sm text-muted-foreground">No requirement to review for this Fleet Owner.</p>}
          {visible.map((i) => (
            <div key={i.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{i.requirement_label}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.requirement_code} · {i.responsibility_level}
                    {i.reference_number && ` · ref ${i.reference_number}`}
                    {i.issuing_authority && ` · ${i.issuing_authority}`}
                    {i.issued_on && ` · issued ${i.issued_on}`}
                    {i.expires_on && ` · expires ${i.expires_on}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {i.evidence_storage_path ? i.evidence_storage_path.split("/").pop() : "No document submitted"}
                  </p>
                </div>
                <Badge variant="outline" className={tone(i.state)}>{i.state.replace(/_/g, " ")}</Badge>
              </div>

              {refusals[i.id] && <p className="text-xs text-destructive">Refused: {refusals[i.id]}</p>}

              <Textarea
                rows={2}
                placeholder="Reviewer note — required when rejecting or escalating"
                value={notes[i.id] ?? ""}
                onChange={(e) => setNotes((p) => ({ ...p, [i.id]: e.target.value }))}
              />

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!i.evidence_storage_path} onClick={() => void open(i.evidence_storage_path)}>
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden />Open document
                </Button>
                <Button size="sm" disabled={busy === i.id || !i.evidence_storage_path} onClick={() => void decide(i, "VERIFY")}>Verify</Button>
                <Button size="sm" variant="outline" disabled={busy === i.id} onClick={() => void decide(i, "REJECT")}>Reject</Button>
                <Button size="sm" variant="outline" disabled={busy === i.id} onClick={() => void decide(i, "LEGAL_REVIEW")}>Send to legal review</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
