/**
 * FLEET OWNER — DELIVERY EVIDENCE (Proof of Delivery submission)
 *
 * The Fleet Owner is the carrier-side obligated party: it submits the delivery
 * evidence for a completed movement. SAFARID only facilitates. Nothing is
 * accepted here — the database decides whether the leg is complete, whether
 * evidence is sufficient, and (after staff approval) what is payable.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listCompletedLegs, listPodSubmissions, listPayableLines, submitPod,
  uploadPodEvidence, refusalCopy,
  type CompletedLegRow, type CarrierPodSubmissionRow, type CarrierPayableLineRow,
  type PodEvidenceRef,
} from "@/lib/logistics/carrier/pod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import { Loader2, PackageCheck, ShieldCheck, Upload } from "lucide-react";

interface CarrierRow { id: string; carrier_code: string; legal_entity_name: string }

const tone: Record<string, string> = {
  SUBMITTED: "bg-status-warning/10 text-status-warning border-status-warning/30",
  APPROVED: "bg-status-success/10 text-status-success border-status-success/30",
  REJECTED: "bg-destructive/10 text-destructive border-destructive/30",
  ACCRUED: "bg-status-info/10 text-status-info border-status-info/30",
  RELEASED: "bg-status-success/10 text-status-success border-status-success/30",
};

const money = (n: number, c = "KES") =>
  `${c} ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FleetOwnerDeliveryEvidence() {
  const [carriers, setCarriers] = useState<CarrierRow[]>([]);
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [legs, setLegs] = useState<CompletedLegRow[]>([]);
  const [legId, setLegId] = useState<string>("");
  const [submissions, setSubmissions] = useState<CarrierPodSubmissionRow[]>([]);
  const [payables, setPayables] = useState<CarrierPayableLineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [recipientName, setRecipientName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [idRef, setIdRef] = useState("");
  const [phone, setPhone] = useState("");
  const [deliveredAt, setDeliveredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const carrier = useMemo(() => carriers.find((c) => c.id === carrierId) ?? null, [carriers, carrierId]);

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([listPodSubmissions(), listPayableLines()]);
      setSubmissions(s);
      setPayables(p);
    } catch (e) {
      toast({ title: "Could not load evidence records", description: (e as Error).message, variant: "destructive" });
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("carrier_profiles")
        .select("id,carrier_code,legal_entity_name")
        .order("legal_entity_name");
      if (error) toast({ title: "Could not load your Fleet Owner record", description: error.message, variant: "destructive" });
      const rows = (data ?? []) as unknown as CarrierRow[];
      setCarriers(rows);
      const first = rows[0]?.id ?? null;
      setCarrierId(first);
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  useEffect(() => {
    setLegId("");
    if (!carrierId) { setLegs([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const rows = await listCompletedLegs(carrierId);
        if (!cancelled) setLegs(rows);
      } catch (e) {
        if (!cancelled) {
          setLegs([]);
          toast({ title: "Could not load completed movements", description: (e as Error).message, variant: "destructive" });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [carrierId]);

  const openLegs = useMemo(() => {
    const taken = new Set(submissions.filter((s) => s.state !== "REJECTED").map((s) => s.leg_id));
    return legs.filter((l) => !taken.has(l.id));
  }, [legs, submissions]);

  const onSubmit = async () => {
    if (!carrierId || !legId) {
      toast({ title: "Select a completed movement first", variant: "destructive" });
      return;
    }
    if (files.length === 0) {
      toast({ title: "Attach at least one evidence file", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const evidence: PodEvidenceRef[] = [];
      for (const f of files) {
        evidence.push(await uploadPodEvidence(carrierId, legId, "delivery_evidence", f));
      }
      const res = await submitPod({
        carrierId,
        legId,
        recipientName,
        recipientRelationship: relationship || undefined,
        recipientIdReference: idRef || undefined,
        recipientPhone: phone || undefined,
        deliveredAt: new Date(deliveredAt).toISOString(),
        notes: notes || undefined,
        evidence,
        idempotencyKey: `cpod:${legId}:${evidence.map((e) => e.content_hash).join(":").slice(0, 40)}`,
      });
      if (res.error) {
        toast({ title: "Submission refused", description: refusalCopy(res.code), variant: "destructive" });
      } else {
        toast({
          title: res.replay ? "Already submitted" : "Delivery evidence submitted",
          description: `Reference ${String(res.reference ?? "")} — awaiting SAFARID review.`,
        });
        setRecipientName(""); setRelationship(""); setIdRef(""); setPhone(""); setNotes("");
        setFiles([]); setLegId("");
        await refresh();
      }
    } catch (e) {
      toast({ title: "Submission failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <main className="container mx-auto max-w-5xl space-y-6 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Delivery evidence</h1>
        <p className="max-w-2xl text-muted-foreground">
          As Fleet Owner you are the carrier-side obligated party for this consignment. Submit the
          proof of delivery here. SAFARID reviews the evidence and, once approved, releases your
          settlement into your wallet.
        </p>
        {carrier && (
          <Badge variant="outline" className="font-mono">
            {carrier.carrier_code} — {carrier.legal_entity_name}
          </Badge>
        )}
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" /> Submit proof of delivery
          </CardTitle>
          <CardDescription>
            Only movements whose transport leg is recorded as completed can be evidenced.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {openLegs.length === 0 ? (
            <Alert>
              <AlertTitle>No completed movement awaiting evidence</AlertTitle>
              <AlertDescription>
                A movement appears here after the driver has recorded unloading and completion.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="leg">Completed movement</Label>
                <select
                  id="leg"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={legId}
                  onChange={(e) => setLegId(e.target.value)}
                >
                  <option value="">Select a movement…</option>
                  {openLegs.map((l) => (
                    <option key={l.id} value={l.id}>
                      Leg {l.leg_no} · {l.origin_label} → {l.destination_label}
                      {l.actual_arrival ? ` · arrived ${new Date(l.actual_arrival).toLocaleString()}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="recipient">Recipient name</Label>
                  <Input id="recipient" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="relationship">Relationship to consignee</Label>
                  <Input id="relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="Store manager, security, self…" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="idref">Recipient ID reference</Label>
                  <Input id="idref" value={idRef} onChange={(e) => setIdRef(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Recipient phone</Label>
                  <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="2547…" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delivered">Delivered at</Label>
                  <Input id="delivered" type="datetime-local" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="evidence">Evidence files</Label>
                  <Input
                    id="evidence"
                    type="file"
                    multiple
                    onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Delivery notes</Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </div>

              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Evidence is sealed on submission</AlertTitle>
                <AlertDescription>
                  Each file is fingerprinted before upload. Once submitted, the evidence and its
                  fingerprint cannot be changed — only SAFARID's review decision is added.
                </AlertDescription>
              </Alert>

              <Button onClick={onSubmit} disabled={busy || !legId}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Submit delivery evidence
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your submissions</CardTitle>
          <CardDescription>Review status recorded by SAFARID operations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No delivery evidence submitted yet.</p>
          ) : (
            submissions.map((s) => (
              <div key={s.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm">{s.submission_reference}</span>
                  <Badge variant="outline" className={tone[s.state]}>{s.state}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {s.recipient_name} · delivered {new Date(s.delivered_at).toLocaleString()} ·{" "}
                  {(s.evidence ?? []).length} file(s)
                </p>
                {s.rejection_reason && (
                  <p className="mt-1 text-sm text-destructive">Rejected: {s.rejection_reason}</p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settlement lines</CardTitle>
          <CardDescription>
            Created only when SAFARID approves your delivery evidence. Released amounts are withdrawable
            from your wallet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {payables.length === 0 ? (
            <p className="text-sm text-muted-foreground">No settlement lines yet.</p>
          ) : (
            payables.map((l) => (
              <div key={l.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm">{l.line_reference}</span>
                  <Badge variant="outline" className={tone[l.state]}>{l.state}</Badge>
                </div>
                <Separator className="my-2" />
                <dl className="grid gap-1 text-sm sm:grid-cols-3">
                  <div><dt className="text-muted-foreground">Gross</dt><dd>{money(l.gross_amount, l.currency)}</dd></div>
                  <div><dt className="text-muted-foreground">Platform fee ({l.commission_pct}%)</dt><dd>{money(l.platform_fee, l.currency)}</dd></div>
                  <div><dt className="text-muted-foreground">Net to you</dt><dd className="font-medium">{money(l.net_payable, l.currency)}</dd></div>
                </dl>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}
