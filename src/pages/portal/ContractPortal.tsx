/**
 * CLIENT CONTRACT PORTAL — token-bearing page where the customer uploads their
 * signed copy and confirms acceptance. The link token is the credential; the
 * database records acceptance, files the signed copy and opens onboarding, so no
 * administrator has to close the contract by hand.
 */
import * as React from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, FileSignature, Loader2, ShieldCheck, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import BrandLogo from "@/components/brand/BrandLogo";
import { CONTACT } from "@/config/contact";
import {
  openPortalContract,
  submitPortalAcceptance,
  PORTAL_ERROR_COPY,
  formatKes,
  type PortalContractView,
} from "@/lib/commercial/clientPortal";

function errorCopy(code?: string): string {
  if (!code) return "Something went wrong. Please try again.";
  return PORTAL_ERROR_COPY[code] ?? code;
}

export default function ContractPortal() {
  const { token = "" } = useParams();
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState<PortalContractView | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [signedOn, setSignedOn] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    document.title = "Confirm your contract | SAFARID";
    let live = true;
    void (async () => {
      const res = (await openPortalContract(token)) as PortalContractView;
      if (!live) return;
      setView(res);
      if (res?.ok) {
        setName(res.recipient_name ?? "");
        setDone(Boolean(res.completed));
      }
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [token]);

  async function submit() {
    if (!view?.ok || !view.upload_prefix) return;
    if (!file) {
      toast.error("Attach your signed copy first");
      return;
    }
    if (name.trim().length < 3) {
      toast.error("Enter the full name of the person signing");
      return;
    }
    setBusy(true);
    const res = await submitPortalAcceptance({
      token,
      uploadPrefix: view.upload_prefix,
      uploadBucket: view.upload_bucket,
      file,
      acceptedBy: name.trim(),
      acceptedTitle: title.trim(),
      signedOn,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(errorCopy(res.error));
      return;
    }
    setDone(true);
    toast.success("Thank you — your signed contract is recorded");
  }

  const c = view?.contract;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-[hsl(var(--nav-bg))] px-6 py-4">
        <BrandLogo tone="light" className="h-8" />
      </header>

      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening your contract…
          </div>
        )}

        {!loading && !view?.ok && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="py-10 text-center">
              <p className="text-base font-semibold">We could not open this contract</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{errorCopy(view?.error)}</p>
              <p className="mt-4 text-sm text-muted-foreground">
                Contact us on {CONTACT.phoneDisplay} or {CONTACT.salesEmail}.
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && view?.ok && c && (
          <div className="space-y-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Contract acceptance
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                {c.title ?? "Mobility service contract"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {c.customer ?? "Your organisation"}
                {c.contract_number ? ` · ${c.contract_number}` : ""}
              </p>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileSignature className="h-4 w-4" /> What you are confirming
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Contract value</p>
                  <p className="text-sm font-semibold">{formatKes(c.value_amount, c.currency ?? "KES")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payment terms</p>
                  <p className="text-sm font-semibold">{c.payment_terms ?? "As stated in the contract"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Service period</p>
                  <p className="text-sm font-semibold">
                    {c.term_start ? new Date(c.term_start).toLocaleDateString() : "From activation"}
                    {c.term_end ? ` – ${new Date(c.term_end).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Signed for SAFARID by</p>
                  <p className="text-sm font-semibold">{c.company_signatory ?? "SAFARID"}</p>
                </div>
              </CardContent>
            </Card>

            {done ? (
              <Card className="border-primary/40 bg-primary/5">
                <CardContent className="py-10 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
                  <p className="mt-3 text-base font-semibold">Your signed contract is recorded</p>
                  <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                    We have your signed copy and your confirmation of acceptance. Your SAFARID account manager now
                    starts onboarding — you do not need to do anything else here.
                  </p>
                  <Badge variant="outline" className="mt-4">
                    Acceptance confirmed
                  </Badge>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Upload className="h-4 w-4" /> Upload your signed copy
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="portal-name">Full name of signatory</Label>
                      <Input id="portal-name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="portal-title">Position held</Label>
                      <Input
                        id="portal-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Managing Director"
                      />
                    </div>
                    <div>
                      <Label htmlFor="portal-date">Date signed</Label>
                      <Input
                        id="portal-date"
                        type="date"
                        value={signedOn}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setSignedOn(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="portal-file">Signed contract (PDF or scan)</Label>
                      <Input
                        id="portal-file"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="portal-notes">Anything we should note (optional)</Label>
                    <Textarea
                      id="portal-notes"
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Billing contact, purchase order number, preferred start date…"
                    />
                  </div>

                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    By confirming you accept the contract shown above on behalf of your organisation. Your upload is
                    stored privately and is visible only to the SAFARID team handling your account.
                  </p>

                  <Button onClick={submit} disabled={busy} className="w-full sm:w-auto">
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirm acceptance and send signed copy
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
