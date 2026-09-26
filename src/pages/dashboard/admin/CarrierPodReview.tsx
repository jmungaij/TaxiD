/**
 * ADMIN — CARRIER DELIVERY EVIDENCE REVIEW & SETTLEMENT RELEASE
 *
 * Staff approve or reject Fleet Owner proof of delivery. Approval accrues the
 * carrier payable line in the database (never here), and a separate finance
 * action releases the net amount into the Fleet Owner wallet. The person who
 * submitted the evidence can never approve it, and the reviewer cannot be the
 * releaser — both rules are enforced server-side.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listPodSubmissions, listPayableLines, reviewPod, releasePayable, refusalCopy,
  type CarrierPodSubmissionRow, type CarrierPayableLineRow,
} from "@/lib/logistics/carrier/pod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import { Loader2, BadgeCheck, Ban, Banknote } from "lucide-react";

const tone: Record<string, string> = {
  SUBMITTED: "bg-status-warning/10 text-status-warning border-status-warning/30",
  APPROVED: "bg-status-success/10 text-status-success border-status-success/30",
  REJECTED: "bg-destructive/10 text-destructive border-destructive/30",
  ACCRUED: "bg-status-info/10 text-status-info border-status-info/30",
  RELEASED: "bg-status-success/10 text-status-success border-status-success/30",
};

const money = (n: number, c = "KES") =>
  `${c} ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CarrierPodReview() {
  const [subs, setSubs] = useState<CarrierPodSubmissionRow[]>([]);
  const [lines, setLines] = useState<CarrierPayableLineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Server refusals are kept on the card: a toast alone disappears and the
  // reviewer is left looking at an unchanged record with no explanation.
  const [refusals, setRefusals] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([listPodSubmissions(), listPayableLines()]);
      setSubs(s);
      setLines(l);
    } catch (e) {
      toast({ title: "Could not load review queue", description: (e as Error).message, variant: "destructive" });
    }
  }, []);

  useEffect(() => { void refresh().finally(() => setLoading(false)); }, [refresh]);

  const pending = useMemo(() => subs.filter((s) => s.state === "SUBMITTED"), [subs]);
  const decided = useMemo(() => subs.filter((s) => s.state !== "SUBMITTED"), [subs]);
  const accrued = useMemo(() => lines.filter((l) => l.state === "ACCRUED"), [lines]);
  const released = useMemo(() => lines.filter((l) => l.state === "RELEASED"), [lines]);

  const decide = async (id: string, decision: "APPROVED" | "REJECTED") => {
    const note = (notes[id] ?? "").trim();
    if (decision === "REJECTED" && note.length < 10) {
      toast({ title: "A rejection reason of at least 10 characters is required", variant: "destructive" });
      return;
    }
    setBusy(id);
    try {
      const res = await reviewPod({
        submissionId: id,
        decision,
        reviewNotes: note || undefined,
        rejectionReason: decision === "REJECTED" ? note : undefined,
      });
      if (res.error) {
        const why = refusalCopy(res.code);
        setRefusals((r) => ({ ...r, [id]: why }));
        toast({ title: "Refused", description: why, variant: "destructive" });
      } else {
        setRefusals((r) => { const n = { ...r }; delete n[id]; return n; });
        toast({
          title: decision === "APPROVED" ? "Evidence approved" : "Evidence rejected",
          description: decision === "APPROVED"
            ? `Payable ${String(res.line_reference ?? "")} accrued — net ${money(Number(res.net_payable ?? 0))}.`
            : "The Fleet Owner has been asked to resubmit.",
        });
        await refresh();
      }
    } catch (e) {
      setRefusals((r) => ({ ...r, [id]: (e as Error).message }));
      toast({ title: "Review failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const release = async (id: string) => {
    setBusy(id);
    try {
      const res = await releasePayable(id);
      if (res.error) {
        toast({ title: "Release refused", description: refusalCopy(res.code), variant: "destructive" });
      } else {
        toast({
          title: res.replay ? "Already released" : "Settlement released",
          description: `${money(Number(res.net_payable ?? 0))} credited to the Fleet Owner wallet.`,
        });
        await refresh();
      }
    } catch (e) {
      toast({ title: "Release failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
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
    <main className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Carrier delivery evidence & settlement</h1>
        <p className="text-muted-foreground">
          Approve Fleet Owner proof of delivery, then release the settled amount into their wallet.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Awaiting review ({pending.length})</CardTitle>
          <CardDescription>Approval derives the payable from the order total and the configured platform commission.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing awaiting review.</p>
          ) : (
            pending.map((s) => (
              <div key={s.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm">{s.submission_reference}</span>
                  <Badge variant="outline" className={tone[s.state]}>{s.state}</Badge>
                </div>
                <dl className="grid gap-1 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Recipient</dt><dd>{s.recipient_name}{s.recipient_relationship ? ` (${s.recipient_relationship})` : ""}</dd></div>
                  <div><dt className="text-muted-foreground">Delivered at</dt><dd>{new Date(s.delivered_at).toLocaleString()}</dd></div>
                  <div><dt className="text-muted-foreground">Evidence files</dt><dd>{(s.evidence ?? []).length}</dd></div>
                  <div><dt className="text-muted-foreground">Evidence fingerprint</dt><dd className="truncate font-mono text-xs">{s.integrity_hash}</dd></div>
                </dl>
                {(s.evidence ?? []).length > 0 && (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {s.evidence.map((e) => (
                      <li key={e.content_hash} className="font-mono">{e.kind} · {e.object_ref}</li>
                    ))}
                  </ul>
                )}
                {s.notes && <p className="text-sm">{s.notes}</p>}
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor={`note-${s.id}`}>Review note (required to reject)</Label>
                  <Textarea
                    id={`note-${s.id}`}
                    rows={2}
                    value={notes[s.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))}
                  />
                </div>
                {refusals[s.id] && (
                  <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {refusals[s.id]}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => decide(s.id, "APPROVED")} disabled={busy === s.id}>
                    {busy === s.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}
                    Approve & accrue payable
                  </Button>
                  <Button variant="destructive" onClick={() => decide(s.id, "REJECTED")} disabled={busy === s.id}>
                    <Ban className="mr-2 h-4 w-4" /> Reject
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accrued payables ({accrued.length})</CardTitle>
          <CardDescription>Releasing posts a single idempotent credit to the Fleet Owner wallet ledger.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {accrued.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accrued payables awaiting release.</p>
          ) : (
            accrued.map((l) => (
              <div key={l.id} className="space-y-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm">{l.line_reference}</span>
                  <Badge variant="outline" className={tone[l.state]}>{l.state}</Badge>
                </div>
                <dl className="grid gap-1 text-sm sm:grid-cols-3">
                  <div><dt className="text-muted-foreground">Gross</dt><dd>{money(l.gross_amount, l.currency)}</dd></div>
                  <div><dt className="text-muted-foreground">Platform fee ({l.commission_pct}%)</dt><dd>{money(l.platform_fee, l.currency)}</dd></div>
                  <div><dt className="text-muted-foreground">Net payable</dt><dd className="font-medium">{money(l.net_payable, l.currency)}</dd></div>
                </dl>
                <Button onClick={() => release(l.id)} disabled={busy === l.id}>
                  {busy === l.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />}
                  Release to Fleet Owner wallet
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {(released.length > 0 || decided.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Released settlements and closed reviews.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {released.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <span className="font-mono">{l.line_reference}</span>
                <span>{money(l.net_payable, l.currency)}</span>
                <Badge variant="outline" className={tone[l.state]}>{l.state}</Badge>
              </div>
            ))}
            {decided.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <span className="font-mono">{s.submission_reference}</span>
                <span className="text-muted-foreground">{s.rejection_reason ?? s.review_notes ?? "—"}</span>
                <Badge variant="outline" className={tone[s.state]}>{s.state}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Alert>
        <AlertTitle>Commission source</AlertTitle>
        <AlertDescription>
          The platform fee percentage is read from the finance-owned configuration entry. Until the
          owner sets it, approval refuses rather than guessing a rate.
        </AlertDescription>
      </Alert>
    </main>
  );
}
