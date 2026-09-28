/**
 * Public document acknowledgement — /recruitment/acknowledge?token=…
 *
 * The candidate signs an appointment letter, offer or onboarding pack using a
 * single-use token that exists only as a hash in the database. The token is
 * inspected first so the candidate sees exactly what they are signing, and the
 * signature itself is recorded by a governed database routine which enforces
 * expiry, single use, and appends a hash-chained audit event.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { CheckCircle2, FileSignature, Loader2, ShieldCheck, XCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  acknowledgeDocument,
  inspectAcknowledgement,
  type AcknowledgementContext,
} from "@/lib/recruitment/deliveryTracking";
import { CONTACT } from "@/config/contact";

const INVALID_COPY: Record<string, string> = {
  not_found: "This signing link is not recognised. It may have been replaced by a newer document.",
  expired: "This signing link has expired. Please contact us and we will re-issue your document.",
  token_not_found: "This signing link is not recognised. It may have been replaced by a newer document.",
  token_expired: "This signing link has expired. Please contact us and we will re-issue your document.",
  signature_not_required: "This document does not require a signature.",
};

const KIND_LABEL: Record<string, string> = {
  appointment_letter: "Appointment letter",
  offer_letter: "Offer letter",
  onboarding_pack: "Onboarding documents",
};

export default function DocumentAcknowledge() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [context, setContext] = useState<AcknowledgementContext | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const ctx = await inspectAcknowledgement(token);
      setContext(ctx);
      if (ctx.candidate_name) setSignerName((current) => current || ctx.candidate_name!);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not open this document.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!signerName.trim()) {
      setError("Please type your full name to sign.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await acknowledgeDocument(token, signerName.trim(), note.trim() || undefined);
      setSigned(true);
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Your signature could not be recorded.";
      setError(INVALID_COPY[message] ?? message);
    } finally {
      setBusy(false);
    }
  };

  const done = signed || Boolean(context?.already_signed);
  const kindLabel = KIND_LABEL[context?.kind ?? ""] ?? "Official document";

  return (
    <main className="min-h-screen bg-background py-12">
      <Helmet>
        <title>Acknowledge your document | TaxiD</title>
        <meta name="description" content="Acknowledge and sign your TaxiD appointment letter or onboarding documents securely." />
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <div className="container max-w-2xl">
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <FileSignature className="h-5 w-5 text-primary" aria-hidden="true" />
              Acknowledge your document
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {!token && (
              <p className="text-sm text-muted-foreground">
                This page needs the secure link from your email. Please open the link we sent you,
                or contact us at {CONTACT.hrEmail}.
              </p>
            )}

            {loading && <div className="space-y-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /></div>}

            {!loading && context && !context.valid && (
              <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
                <XCircle className="mt-0.5 h-5 w-5 text-destructive" aria-hidden="true" />
                <p className="text-sm text-foreground">
                  {INVALID_COPY[context.reason ?? ""] ?? "This link is no longer active."}{" "}
                  Please contact {CONTACT.hrEmail}.
                </p>
              </div>
            )}

            {!loading && context?.valid && (
              <>
                <dl className="grid gap-3 rounded-md border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Document</dt>
                    <dd className="font-medium text-foreground">{kindLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Reference</dt>
                    <dd className="font-mono text-xs text-foreground">{context.document_ref ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Issued to</dt>
                    <dd className="font-medium text-foreground">{context.candidate_name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>
                      <Badge variant="outline" className={done ? "border-success/50 text-success" : "border-primary/30 text-primary"}>
                        {done ? "Signed" : "Awaiting your signature"}
                      </Badge>
                    </dd>
                  </div>
                </dl>

                {done ? (
                  <div className="flex items-start gap-3 rounded-md border border-success/40 bg-success/5 p-4">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" aria-hidden="true" />
                    <p className="text-sm text-foreground">
                      Thank you — your signature has been recorded against this document
                      {context.signed_at ? ` on ${new Date(context.signed_at).toLocaleString()}` : ""}.
                      The recruitment team has been notified.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signer-name">Your full name (this is your signature)</Label>
                      <Input
                        id="signer-name"
                        value={signerName}
                        onChange={(e) => setSignerName(e.target.value)}
                        placeholder="As it appears on your ID"
                        autoComplete="name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signer-note">Anything you would like to add (optional)</Label>
                      <Textarea
                        id="signer-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={3}
                        placeholder="For example, a question about your start date"
                      />
                    </div>
                    <Button onClick={submit} disabled={busy} className="w-full sm:w-auto">
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                      Sign and acknowledge
                    </Button>
                  </div>
                )}
              </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <p className="flex items-start gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Your signature is recorded against an append-only, hash-chained audit trail. This link
              is single-use and tied only to your document — it carries no personal data.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
