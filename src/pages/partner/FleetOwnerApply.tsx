/**
 * FLEET OWNER APPLICATION — the entry point for an independent transport
 * business that wants its capacity matched on the SAFARID marketplace.
 *
 * The form only records an application. Nothing here approves a Fleet Owner,
 * creates a carrier record or implies compliance: the staff decision function
 * does that, and only after review.
 */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  submitCarrierApplication, carrierApplicationStatus,
  CARRIER_SERVICE_CATEGORIES, CARRIER_VEHICLE_TYPES,
  type CarrierApplicationStatus,
} from "@/lib/logistics/carrier/applications";
import { FACILITATOR_DISCLOSURE } from "@/lib/logistics/legal/responsibilityModel";
import { FLEET_OWNER_INSTRUMENTS } from "@/lib/logistics/carrier/agreements";
import { KENYA_COUNTIES } from "@/pages/corporate/register/data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, Search } from "lucide-react";

const STATUS_COPY: Record<CarrierApplicationStatus, string> = {
  SUBMITTED: "Received — waiting for a reviewer",
  UNDER_REVIEW: "Under review by our compliance team",
  INFO_REQUESTED: "More information needed from you",
  APPROVED: "Approved — continue to document upload and agreement signing",
  REJECTED: "Not accepted",
  WITHDRAWN: "Withdrawn",
};

export default function FleetOwnerApply() {
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [services, setServices] = useState<string[]>([]);
  const [vehicles, setVehicles] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<{ reference: string; token: string } | null>(null);
  const [lookup, setLookup] = useState<{ status: CarrierApplicationStatus; name: string; notes: string | null } | null>(null);
  const [checking, setChecking] = useState(false);

  const refParam = params.get("ref") ?? "";
  const tokenParam = params.get("token") ?? "";

  useEffect(() => {
    if (!refParam || !tokenParam) return;
    (async () => {
      setChecking(true);
      const res = await carrierApplicationStatus(refParam, tokenParam);
      setChecking(false);
      if (res?.error || !res.status) {
        return toast({ title: "We could not find that application", description: "Check the reference and link code.", variant: "destructive" });
      }
      setLookup({ status: res.status, name: res.legal_entity_name ?? "", notes: res.review_notes ?? null });
    })();
  }, [refParam, tokenParam]);

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    const res = await submitCarrierApplication({
      legal_entity_name: String(fd.get("legal_entity_name") ?? ""),
      trading_name: String(fd.get("trading_name") ?? "") || undefined,
      registration_number: String(fd.get("registration_number") ?? "") || undefined,
      tax_identifier: String(fd.get("tax_identifier") ?? "") || undefined,
      county: String(fd.get("county") ?? "") || undefined,
      town: String(fd.get("town") ?? "") || undefined,
      contact_name: String(fd.get("contact_name") ?? ""),
      contact_position: String(fd.get("contact_position") ?? "") || undefined,
      contact_email: String(fd.get("contact_email") ?? ""),
      contact_phone: String(fd.get("contact_phone") ?? ""),
      fleet_size: Number(fd.get("fleet_size")) || undefined,
      vehicle_types: vehicles,
      service_categories: services,
      notes: String(fd.get("notes") ?? "") || undefined,
    });
    setBusy(false);
    if (res?.error || !res.application_reference || !res.claim_token) {
      return toast({
        title: "Application not submitted",
        description: (res.code ?? res.message ?? "Please check the details and try again.").replace(/_/g, " ").toLowerCase(),
        variant: "destructive",
      });
    }
    setReceipt({ reference: res.application_reference, token: res.claim_token });
    if (res.duplicate) {
      toast({ title: "You already have an open application", description: res.application_reference });
    } else {
      toast({ title: "Application received", description: res.application_reference });
      form.reset();
      setServices([]); setVehicles([]);
    }
  }

  if (receipt) {
    const statusUrl = `/partner/fleet-owner/apply?ref=${receipt.reference}&token=${receipt.token}`;
    return (
      <main className="container max-w-2xl py-16">
        <Card>
          <CardHeader>
            <Badge variant="outline" className="mb-2 w-fit border-status-success/30 bg-status-success/10 text-status-success">
              <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden /> Application received
            </Badge>
            <CardTitle>Reference {receipt.reference}</CardTitle>
            <CardDescription>
              Our compliance team reviews your business details, then invites you to upload your licences,
              insurance and vehicle documents and to sign the partner agreement.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Alert>
              <AlertTitle>Save this private link</AlertTitle>
              <AlertDescription className="break-all">
                {typeof window !== "undefined" ? window.location.origin : ""}{statusUrl}
                <br />
                It is the only way to check your application without an account.
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-3">
              <Button asChild><Link to={statusUrl}>Check my status</Link></Button>
              <Button variant="outline" onClick={() => setReceipt(null)}>Submit another business</Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container max-w-4xl py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Become a SAFARID Fleet Owner</h1>
        <p className="mt-2 text-sm text-muted-foreground">{FACILITATOR_DISCLOSURE}</p>
      </header>

      {lookup && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-lg">{lookup.name || refParam}</CardTitle>
            <CardDescription>Reference {refParam}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="font-medium">{STATUS_COPY[lookup.status]}</p>
            {lookup.notes && <p className="text-muted-foreground">Reviewer note: {lookup.notes}</p>}
            {lookup.status === "APPROVED" && (
              <div className="flex flex-wrap gap-2">
                <Button asChild><Link to="/partner/fleet-owner/onboarding">Continue onboarding</Link></Button>
                <Button asChild variant="outline"><Link to="/partner/fleet-owner">Open fleet owner portal</Link></Button>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={() => { setLookup(null); setParams({}); }}>
              Start a new application
            </Button>
          </CardContent>
        </Card>
      )}

      {!lookup && (
        <>
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-lg">What happens after you apply</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm md:grid-cols-4">
              {[
                ["1. Apply", "Tell us about your transport business and fleet."],
                ["2. Documents", "Upload your operating licences, insurance and vehicle papers."],
                ["3. Agreement", "Sign the partner agreement, prohibited goods undertaking and indemnity."],
                ["4. Go live", "Once verified with a confirmed payout account, your capacity is matched."],
              ].map(([t, d]) => (
                <div key={t} className="rounded-lg border p-3">
                  <p className="font-medium">{t}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{d}</p>
                </div>
              ))}
              <p className="text-xs text-muted-foreground md:col-span-4">
                You will be asked to accept: {FLEET_OWNER_INSTRUMENTS.map((i) => i.title).join(" · ")}.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your application</CardTitle>
              <CardDescription>All fields marked required are needed before we can review.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-5 md:grid-cols-2" onSubmit={onSubmit}>
                <div>
                  <Label htmlFor="legal_entity_name">Registered business name *</Label>
                  <Input id="legal_entity_name" name="legal_entity_name" required minLength={3} maxLength={200} />
                </div>
                <div>
                  <Label htmlFor="trading_name">Trading name</Label>
                  <Input id="trading_name" name="trading_name" maxLength={200} />
                </div>
                <div>
                  <Label htmlFor="registration_number">Registration / incorporation no.</Label>
                  <Input id="registration_number" name="registration_number" maxLength={60} />
                </div>
                <div>
                  <Label htmlFor="tax_identifier">KRA PIN</Label>
                  <Input id="tax_identifier" name="tax_identifier" maxLength={40} />
                </div>
                <div>
                  <Label htmlFor="county">County</Label>
                  <select id="county" name="county" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Select…</option>
                    {KENYA_COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="town">Town / area</Label>
                  <Input id="town" name="town" maxLength={120} />
                </div>

                <div className="md:col-span-2 border-t pt-4">
                  <p className="text-sm font-medium">Person we should speak to</p>
                </div>
                <div>
                  <Label htmlFor="contact_name">Full name *</Label>
                  <Input id="contact_name" name="contact_name" required minLength={3} maxLength={120} />
                </div>
                <div>
                  <Label htmlFor="contact_position">Position</Label>
                  <Input id="contact_position" name="contact_position" placeholder="Director" maxLength={120} />
                </div>
                <div>
                  <Label htmlFor="contact_email">Email *</Label>
                  <Input id="contact_email" name="contact_email" type="email" required maxLength={200} />
                </div>
                <div>
                  <Label htmlFor="contact_phone">Phone *</Label>
                  <Input id="contact_phone" name="contact_phone" required placeholder="+254 7XX XXX XXX" />
                </div>

                <div className="md:col-span-2 border-t pt-4">
                  <p className="text-sm font-medium">Your fleet</p>
                </div>
                <div>
                  <Label htmlFor="fleet_size">Number of vehicles</Label>
                  <Input id="fleet_size" name="fleet_size" type="number" min={1} max={10000} />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-sm">Vehicle types</Label>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {CARRIER_VEHICLE_TYPES.map((v) => (
                      <label key={v} className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
                        <Checkbox checked={vehicles.includes(v)} onCheckedChange={() => toggle(vehicles, setVehicles, v)} />
                        {v.replace(/_/g, " ")}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <Label className="text-sm">Services you can carry</Label>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {CARRIER_SERVICE_CATEGORIES.map((s) => (
                      <label key={s} className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
                        <Checkbox checked={services.includes(s)} onCheckedChange={() => toggle(services, setServices, s)} />
                        {s.replace(/_/g, " ")}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="notes">Anything else we should know</Label>
                  <Textarea id="notes" name="notes" rows={4} maxLength={4000} />
                </div>

                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <Button type="submit" disabled={busy}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                    Submit application
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Submitting does not create an agreement. Signing happens after your documents are verified.
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-lg">Already applied?</CardTitle>
              <CardDescription>Enter your reference and the link code from your confirmation.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-3 md:grid-cols-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  setParams({ ref: String(fd.get("ref") ?? ""), token: String(fd.get("token") ?? "") });
                }}
              >
                <div>
                  <Label htmlFor="ref" className="text-xs">Reference</Label>
                  <Input id="ref" name="ref" placeholder="FOA-202609-ABC123" required />
                </div>
                <div>
                  <Label htmlFor="token" className="text-xs">Link code</Label>
                  <Input id="token" name="token" required />
                </div>
                <div className="flex items-end">
                  <Button type="submit" variant="outline" size="sm" disabled={checking}>
                    {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Search className="mr-2 h-4 w-4" aria-hidden />}
                    Check status
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
