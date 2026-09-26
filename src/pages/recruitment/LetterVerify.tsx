/**
 * Public letter verification — /verify/letter
 *
 * Proves that a SAFARID recruitment letter reference plus its printed
 * verification code was genuinely issued. It deliberately returns no candidate
 * personal data: only issuance facts, the document fingerprint and whether the
 * letter has since been superseded by a later revision.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { verifyLetter, type LetterVerification } from "@/lib/recruitment/lettersPublic";
import { COMM_TYPE_LABEL } from "@/lib/recruitment/letters";
import { CONTACT } from "@/config/contact";

const REASON_COPY: Record<string, string> = {
  not_found: "No letter matches this reference and verification code.",
  code_mismatch: "The verification code does not match this letter reference.",
  cancelled: "This letter was cancelled and is no longer valid.",
  superseded: "This letter has been replaced by a later revision.",
};

export default function LetterVerify() {
  const [params] = useSearchParams();
  const [reference, setReference] = useState(params.get("ref") ?? "");
  const [code, setCode] = useState(params.get("code") ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LetterVerification | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (ref = reference, c = code) => {
    if (!ref.trim() || !c.trim()) {
      setError("Enter both the letter reference and the verification code printed on the document.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await verifyLetter(ref.trim(), c.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification is unavailable right now.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const ref = params.get("ref");
    const c = params.get("code");
    if (ref && c) void run(ref, c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-background px-4 py-16">
      <Helmet>
        <title>Verify a SAFARID recruitment letter</title>
        <meta
          name="description"
          content="Confirm that a SAFARID recruitment letter was officially issued using its reference and printed verification code."
        />
        <link rel="canonical" href="https://yalla.africa/verify/letter" />
        <meta name="robots" content="noindex,follow" />
      </Helmet>

      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          SAFARID · Recruitment
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Letter verification</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the reference shown in the footer of the letter (for example YLM/R360/INT/2026/000001)
          together with the verification code printed beside it.
        </p>

        <Card className="mt-8">
          <CardHeader><CardTitle className="text-base">Document details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="letter-ref">Letter reference</Label>
              <Input
                id="letter-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="YLM/R360/INT/2026/000001"
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="letter-code">Verification code</Label>
              <Input
                id="letter-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="8-character code"
                autoComplete="off"
              />
            </div>
            <Button onClick={() => void run()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {busy ? "Checking the issuance registry…" : "Verify this letter"}
            </Button>

            <div aria-live="polite" role="status" className="space-y-3">
              {error && (
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {error}
                </p>
              )}

              {result && !result.valid && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
                  <p className="flex items-center gap-2 font-semibold text-destructive">
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    Not verified
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {REASON_COPY[result.reason ?? ""] ?? "This letter could not be verified."}
                  </p>
                </div>
              )}

              {result?.valid && (
                <div className="rounded-md border border-success/40 bg-success/5 p-4">
                  <p className="flex items-center gap-2 font-semibold text-success">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    Officially issued by SAFARID
                  </p>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Reference</dt>
                      <dd className="font-medium">{result.document_ref}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Letter type</dt>
                      <dd className="font-medium">
                        {COMM_TYPE_LABEL[result.comm_type ?? ""] ?? result.comm_type ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Issued</dt>
                      <dd className="font-medium">
                        {result.issued_at ? new Date(result.issued_at).toLocaleString() : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Lifecycle state</dt>
                      <dd className="font-medium capitalize">
                        {(result.lifecycle_state ?? "issued").replace(/_/g, " ")}
                        {result.superseded ? (
                          <Badge variant="outline" className="ml-2 text-[10px]">Superseded</Badge>
                        ) : null}
                      </dd>
                    </div>
                    {result.fingerprint && (
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">Content fingerprint (SHA-256)</dt>
                        <dd className="break-all font-mono text-xs">{result.fingerprint}</dd>
                      </div>
                    )}
                  </dl>
                  {result.superseded && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      A later revision of this letter has been issued. Please rely on the most recent
                      letter you received, or contact us to confirm which revision applies.
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 text-xs text-muted-foreground">
          Questions about a letter? Contact {CONTACT.supportEmail} or call {CONTACT.phoneDisplay}.
        </p>
      </div>
    </main>
  );
}
