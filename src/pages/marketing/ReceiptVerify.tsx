/**
 * Public receipt / itinerary verification.
 *
 * Every forensic PDF SAFARID Air issues is stamped with a control number, a
 * document fingerprint and the PDF template version. This page resolves a
 * control number against the issuance registry and confirms that the
 * fingerprint, template version and booking reference printed on the page
 * match what was recorded at issue time.
 */
import { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useSearchParams } from "react-router-dom";
import { charterApi } from "@/lib/charter/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert, Loader2, Search } from "lucide-react";

type VerifyResult = Awaited<ReturnType<typeof charterApi.verifyDocument>>;

const CheckRow = ({ label, state, expected }: { label: string; state: boolean | null; expected?: string }) => (
  <div className="flex items-center justify-between gap-3 border-b border-border/50 py-2 text-sm last:border-0">
    <span className="text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2">
      {expected && <span className="font-mono text-xs break-all">{expected}</span>}
      <Badge variant={state === true ? "default" : state === false ? "destructive" : "outline"}>
        {state === true ? "Match" : state === false ? "Mismatch" : "Not checked"}
      </Badge>
    </div>
  </div>
);

export default function ReceiptVerify() {
  const [searchParams] = useSearchParams();
  const [control, setControl] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [templateVersion, setTemplateVersion] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runVerification = async (fields: {
    control: string;
    fingerprint?: string;
    templateVersion?: string;
    reference?: string;
  }) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await charterApi.verifyDocument({
        control_number: fields.control.trim(),
        fingerprint: fields.fingerprint?.trim() || undefined,
        template_version: fields.templateVersion?.trim() || undefined,
        reference: fields.reference?.trim() || undefined,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  const verify = () =>
    runVerification({ control, fingerprint, templateVersion, reference });

  // External-entry contract: the QR seal printed on every issued receipt or
  // itinerary encodes /verify?control=<control-number>. Honour the deep link —
  // prefill the form and run the check immediately so the scanner lands on a
  // verdict, not on an empty form. Runs once per arrival.
  const autoVerified = useRef(false);
  useEffect(() => {
    if (autoVerified.current) return;
    const c = searchParams.get("control")?.trim();
    if (!c) return;
    autoVerified.current = true;
    const fp = searchParams.get("fingerprint")?.trim() ?? "";
    const tv = searchParams.get("template")?.trim() ?? "";
    const ref = searchParams.get("ref")?.trim() ?? "";
    setControl(c);
    setFingerprint(fp);
    setTemplateVersion(tv);
    setReference(ref);
    void runVerification({ control: c, fingerprint: fp, templateVersion: tv, reference: ref });
     
  }, [searchParams]);

  const authentic = result?.found && result.authentic;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <Helmet>
        <title>Verify a SAFARID Air receipt | Document authenticity check</title>
        <meta
          name="description"
          content="Enter the control number printed on a SAFARID Air receipt or itinerary to confirm its fingerprint, template version and booking reference are authentic."
        />
        <link rel="canonical" href="https://www.yalla.africa/verify" />
        <meta property="og:image" content="https://yalla-africa.lovable.app/og-yalla-mobility-1200x630.v3.png" />
        <meta name="twitter:image" content="https://yalla-africa.lovable.app/og-yalla-mobility-1200x630.v3.png" />
      </Helmet>

      <header className="mb-8 space-y-2">
        <Badge variant="outline">Forensic document check</Badge>
        <h1 className="text-3xl font-bold tracking-tight">Verify a SAFARID Air document</h1>
        <p className="text-muted-foreground">
          Every receipt and itinerary carries a control number, a document fingerprint and a template
          version in its forensic footer. Enter them here to confirm the document was genuinely issued
          and has not been altered.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" /> Document details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="control">Control number *</Label>
              <Input id="control" value={control} onChange={(e) => setControl(e.target.value)} placeholder="YA-XXXX-XXXX" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reference">Booking reference</Label>
              <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="CHB-XXXXXX" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fingerprint">Document fingerprint</Label>
              <Input id="fingerprint" value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} placeholder="fp_…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl">Template version</Label>
              <Input id="tpl" value={templateVersion} onChange={(e) => setTemplateVersion(e.target.value)} placeholder="v1" />
            </div>
          </div>
          <Button onClick={() => void verify()} disabled={busy || !control.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Verify document
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {result && !result.found && (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" />
              <div>
                <p className="text-sm font-semibold">No matching document</p>
                <p className="text-xs text-muted-foreground">
                  {result.message ?? "That control number was never issued by SAFARID Air."}
                </p>
              </div>
            </div>
          )}

          {result?.found && result.document && (
            <div
              className={`rounded-xl border p-4 ${authentic ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/10"}`}
            >
              <div className="mb-3 flex items-center gap-3">
                {authentic ? (
                  <ShieldCheck className="h-5 w-5 text-primary" />
                ) : (
                  <ShieldAlert className="h-5 w-5 text-destructive" />
                )}
                <div>
                  <p className="text-sm font-semibold">
                    {authentic ? "Authentic document" : "Details do not match the issued document"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {result.document.document_kind} · issued {new Date(result.document.issued_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <CheckRow label="Booking reference" state={result.checks?.reference ?? null} expected={result.document.reference} />
              <CheckRow label="Document fingerprint" state={result.checks?.fingerprint ?? null} expected={result.document.fingerprint} />
              <CheckRow label="Template version" state={result.checks?.template_version ?? null} expected={result.document.template_version} />
              {result.document.file_name && (
                <p className="pt-2 text-xs text-muted-foreground font-mono break-all">{result.document.file_name}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
