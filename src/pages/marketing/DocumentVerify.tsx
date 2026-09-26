/**
 * Online document verification.
 *
 * Accepts a control number plus a one-time validation token (typed, or carried
 * in the QR link), re-derives the digital signature server-side, checks the
 * blockchain-ready SHA-256 fingerprint against the issuance registry, and
 * reports a weighted fraud-confidence score with the procurement approval chain
 * and tamper-evident audit trail.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { charterApi } from "@/lib/charter/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

type VerifyResult = Awaited<ReturnType<typeof charterApi.verifyDocument>>;

const CHECK_LABELS: Record<string, string> = {
  fingerprint: "SHA-256 content fingerprint",
  template_version: "Document template version",
  reference: "Booking reference",
  signature: "Digital signature",
  qr_payload: "Encrypted QR payload",
  validation_token: "One-time validation token",
  token_unused: "Token not previously redeemed",
};

export default function DocumentVerify() {
  const [params] = useSearchParams();
  const [control, setControl] = useState(params.get("control") ?? "");
  const [token, setToken] = useState(params.get("token") ?? "");
  const [payload, setPayload] = useState(params.get("d") ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = async (c = control, t = token, p = payload) => {
    if (!c.trim()) {
      setError("Enter the control number printed on the document.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await charterApi.verifyDocument({
        control_number: c.trim(),
        token: t.trim() || undefined,
        qr_payload: p.trim() || undefined,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  // A scanned QR lands here with everything already in the URL — verify at once.
  useEffect(() => {
    const c = params.get("control");
    if (c) void verify(c, params.get("token") ?? "", params.get("d") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const score = result?.fraud_confidence ?? 0;
  const verdict = result?.found ? result.verdict ?? "review" : null;
  const Icon = verdict === "authentic" ? ShieldCheck : verdict === "tampered" ? ShieldAlert : ShieldQuestion;
  const tone =
    verdict === "authentic" ? "text-primary" : verdict === "tampered" ? "text-destructive" : "text-muted-foreground";

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <Helmet>
        <title>Verify a SAFARID travel document</title>
        <meta
          name="description"
          content="Validate a SAFARID charter dossier: one-time token, digital signature, SHA-256 fingerprint and fraud confidence score."
        />
        <link rel="canonical" href="https://yalla-africa.lovable.app/verify-document" />
        <meta property="og:title" content="Verify a SAFARID travel document" />
        <meta property="og:description" content="Validate a SAFARID charter dossier: one-time token, digital signature, SHA-256 fingerprint and fraud confidence score." />
        <meta property="og:image" content="https://yalla-africa.lovable.app/og-safarid-1200x630.v1.png" />
        <meta name="twitter:image" content="https://yalla-africa.lovable.app/og-safarid-1200x630.v1.png" />
      </Helmet>

      <header className="mb-8 space-y-2">
        <Badge variant="outline">Forensic document authority</Badge>
        <h1 className="text-3xl font-bold tracking-tight">Verify a travel document</h1>
        <p className="text-muted-foreground">
          Scan the QR seal or enter the control number and validation token printed on the dossier.
        </p>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">Document credentials</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="verify-control">Control number</Label>
              <Input id="verify-control" value={control} onChange={(e) => setControl(e.target.value)} placeholder="YM-XXXX-XXXX" />
            </div>
            <div>
              <Label htmlFor="verify-token">Validation token</Label>
              <Input id="verify-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="One-time token" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="verify-payload">Encrypted QR payload (optional)</Label>
              <Input id="verify-payload" value={payload} onChange={(e) => setPayload(e.target.value)} placeholder="Paste the scanned QR value" />
            </div>
          </div>
          <Button onClick={() => void verify()} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Verify document
          </Button>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </CardContent>
      </Card>

      {result && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 text-base ${tone}`}>
              <Icon className="h-5 w-5" aria-hidden="true" />
              {!result.found
                ? "No document issued with that control number"
                : verdict === "authentic"
                  ? "Authentic document"
                  : verdict === "tampered"
                    ? "Tamper detected — do not accept"
                    : "Needs manual review"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {result.found && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Fraud confidence score</span>
                  <span className="font-semibold">{score}/100</span>
                </div>
                <Progress value={score} aria-label={`Fraud confidence ${score} out of 100`} />
              </div>
            )}

            {result.checks && (
              <dl className="text-sm">
                {Object.entries(result.checks).map(([key, state]) => (
                  <div key={key} className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0">
                    <dt className="text-muted-foreground">{CHECK_LABELS[key] ?? key}</dt>
                    <dd>
                      <Badge variant={state === true ? "default" : state === false ? "destructive" : "outline"}>
                        {state === true ? "Verified" : state === false ? "Mismatch" : "Not supplied"}
                      </Badge>
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {result.document && (
              <dl className="grid gap-2 rounded-xl bg-secondary/50 p-4 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Reference</dt><dd className="font-mono">{result.document.reference}</dd></div>
                <div><dt className="text-muted-foreground">Document</dt><dd>{result.document.document_kind}</dd></div>
                <div><dt className="text-muted-foreground">Issued</dt><dd>{new Date(result.document.issued_at).toLocaleString("en-KE")}</dd></div>
                <div><dt className="text-muted-foreground">Amount</dt><dd>{result.document.amount_kes ? `KSh ${Number(result.document.amount_kes).toLocaleString("en-KE")}` : "—"}</dd></div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Fingerprint</dt>
                  <dd className="break-all font-mono text-xs">{result.document.fingerprint}</dd>
                </div>
              </dl>
            )}

            {result.procurement && Object.keys(result.procurement).length > 0 && (
              <div className="text-sm">
                <p className="font-medium">Procurement &amp; approval</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {Object.entries(result.procurement).map(([k, v]) => (
                    <li key={k}>{k.replace(/_/g, " ")}: {String(v ?? "—")}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.audit_chain && result.audit_chain.length > 0 && (
              <div className="text-sm">
                <p className="font-medium">Tamper-evident audit trail</p>
                <ol className="mt-1 space-y-1 text-muted-foreground">
                  {result.audit_chain.map((entry) => (
                    <li key={entry.entry_hash} className="break-all">
                      {new Date(entry.at).toLocaleString("en-KE")} · {entry.action}
                      {entry.approver_name ? ` · ${entry.approver_name}` : ""}
                      {entry.approver_title ? ` (${entry.approver_title})` : ""}
                      <span className="block font-mono text-xs">{entry.entry_hash.slice(0, 32)}…</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
