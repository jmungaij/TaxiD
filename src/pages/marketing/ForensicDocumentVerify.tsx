/**
 * Public document authenticity check.
 *
 * Anyone holding a Yalla Mobility document can confirm it was genuinely issued
 * by entering the printed document number and verification code. The response
 * deliberately carries authenticity state only — never document content, never
 * personal data.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppButton } from "@/components/nav/AppButton";
import BrandLogo from "@/components/brand/BrandLogo";
import * as forensics from "@/lib/documents/forensics";
import type { PublicVerdict } from "@/lib/documents/forensics";
import { CONTACT } from "@/config/contact";

const TONE: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning-foreground border-warning/30",
  destructive: "bg-destructive/10 text-destructive border-destructive/30",
  muted: "bg-muted text-muted-foreground border-border",
};

export default function ForensicDocumentVerify() {
  const [params] = useSearchParams();
  const [docNumber, setDocNumber] = useState(params.get("doc") ?? "");
  const [code, setCode] = useState(params.get("code") ?? "");
  const [result, setResult] = useState<PublicVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async (doc: string, token: string) => {
    if (!doc.trim() || !token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // The service verifies the signature server-side and fails closed.
      setResult(await forensics.verifyDocumentAuthoritative(doc.trim(), token.trim()));
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  // Deep links from the printed control line verify immediately.
  useEffect(() => {
    const doc = params.get("doc");
    const token = params.get("code");
    if (doc && token) void check(doc, token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verdict = result ? forensics.forensicVerdict(result.state) : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <Helmet>
        <title>Verify a Yalla Mobility document | Authenticity check</title>
        <meta
          name="description"
          content="Confirm that a Yalla Mobility letter, contract or invoice was genuinely issued, using the printed document number and verification code."
        />
        <link rel="canonical" href="https://yalla.africa/verify/document" />
        <meta property="og:image" content="https://yalla-africa.lovable.app/og-yalla-mobility-1200x630.v3.png" />
        <meta name="twitter:image" content="https://yalla-africa.lovable.app/og-yalla-mobility-1200x630.v3.png" />
        <meta name="robots" content="noindex,follow" />
      </Helmet>

      <BrandLogo tone="ink" className="h-9" priority />
      <h1 className="mt-6 text-3xl font-bold tracking-tight">Verify a Yalla Mobility document</h1>
      <p className="mt-2 text-muted-foreground">
        Enter the document number and verification code printed in the control line at the foot of the
        document. We confirm authenticity only — no document content is ever shown here.
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Authenticity check
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="verify-doc">Document number</Label>
              <Input
                id="verify-doc"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                placeholder="YML-HR-INT-2026-000421"
              />
            </div>
            <div>
              <Label htmlFor="verify-code">Verification code</Label>
              <Input id="verify-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
          </div>
          <AppButton
            analytics="public_document_verify"
            action="submit"
            disabled={!docNumber.trim() || !code.trim() || busy}
            onClick={() => check(docNumber, code)}
          >
            {busy ? "Checking registry…" : "Verify this document"}
          </AppButton>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              We could not reach the document registry: {error}
            </p>
          )}

          {result && verdict && (
            <div className="space-y-3 rounded-lg border border-border p-4" role="status" aria-live="polite">
              <Badge variant="outline" className={TONE[verdict.tone]}>{verdict.label}</Badge>
              <p className="text-sm">{verdict.advice}</p>
              {result.doc_number && (
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Document</dt>
                    <dd className="font-mono text-xs">{result.doc_number}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Issued</dt>
                    <dd>{result.issued_at ? new Date(result.issued_at).toLocaleDateString("en-KE") : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Version</dt>
                    <dd>V{String(result.version ?? 1).padStart(2, "0")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Issuing organisation</dt>
                    <dd>{result.organisation ?? "Yalla Mobility"}</dd>
                  </div>
                </dl>
              )}

              {result.revoked_at && (
                <p className="text-sm text-destructive">
                  Authority withdrawn on {new Date(result.revoked_at).toLocaleDateString("en-KE")}.
                </p>
              )}

              <ul className="space-y-1 text-sm">
                {result.controls.map((c) => (
                  <li key={c.label} className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        c.status === "PASS"
                          ? "bg-success"
                          : c.status === "FAIL"
                            ? "bg-destructive"
                            : c.status === "WARNING"
                              ? "bg-warning"
                              : "bg-muted-foreground"
                      }`}
                      aria-hidden
                    />
                    <span>
                      <span className="font-medium">{c.label}</span>
                      <span className="ml-2 font-mono text-xs uppercase text-muted-foreground">{c.status}</span>
                      {c.detail ? <span className="block text-xs text-muted-foreground">{c.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>

              {result.material_withheld && (
                <p className="text-xs text-muted-foreground">
                  This document is classified. Signature material is withheld from public download; contact the
                  issuing team for an evidence package.
                </p>
              )}

              {result.signature_material ? (
                <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
                  <p className="text-sm font-medium">
                    Digitally signed by Yalla Mobility
                    <span className="ml-2 font-normal text-muted-foreground">
                      {result.signature_material.algorithm.toUpperCase()} · key {result.signature_material.key_id}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The signature and the public key below let you or your own auditors confirm this document
                    independently, without any access to Yalla Mobility systems.
                  </p>
                  <AppButton
                    analytics="public_document_signature_download"
                    action="submit"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const blob = new Blob(
                        [JSON.stringify({ document: result.doc_number, ...result.signature_material }, null, 2)],
                        { type: "application/json" },
                      );
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `signature-${result.doc_number}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download signature material
                  </AppButton>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  This document carries no cryptographic signature. Confirm it with the issuing team before
                  relying on it.
                </p>
              )}
            </div>
          )}


          <p className="text-xs text-muted-foreground">
            Suspect a forged document? Contact {CONTACT.supportEmail} or call {CONTACT.phoneDisplay}.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
