/**
 * FLEET OWNER ONBOARDING — the single journey an independent Fleet Owner /
 * Transport Service Provider completes before its capacity can be matched.
 *
 * The page never decides eligibility itself: every verdict shown here is read
 * from the authoritative database functions (carrier_subject_eligibility,
 * carrier_matchability) that the live dispatch gate also uses.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listComplianceItems, listDeclarations, listSettlementDestinations,
  provisionCarrierRequirements, submitEvidence, acceptDeclaration,
  registerSettlementDestination, carrierMatchability, carrierLevelEligibility,
  type ComplianceItemRow, type CarrierDeclarationRow, type SettlementDestinationRow,
  type EligibilityVerdict,
} from "@/lib/logistics/carrier/onboarding";
import { FLEET_OWNER_INSTRUMENTS, instrumentText } from "@/lib/logistics/carrier/agreements";
import FleetOwnerAgreementDocument from "@/components/logistics/carrier/FleetOwnerAgreementDocument";
import { FACILITATOR_DISCLOSURE } from "@/lib/logistics/legal/responsibilityModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, ShieldAlert, Upload } from "lucide-react";

interface CarrierRow {
  id: string;
  partner_id: string | null;
  carrier_code: string;
  legal_entity_name: string;
  operating_status: string;
  contract_status: string;
}

const stateTone: Record<string, string> = {
  VERIFIED: "bg-status-success/10 text-status-success border-status-success/30",
  PENDING_REVIEW: "bg-status-warning/10 text-status-warning border-status-warning/30",
  MISSING: "bg-muted text-muted-foreground",
  REJECTED: "bg-destructive/10 text-destructive border-destructive/30",
  EXPIRED: "bg-destructive/10 text-destructive border-destructive/30",
  LEGAL_REVIEW_REQUIRED: "bg-accent/10 text-accent-foreground border-accent/30",
};

export default function FleetOwnerOnboarding() {
  const [carriers, setCarriers] = useState<CarrierRow[]>([]);
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [items, setItems] = useState<ComplianceItemRow[]>([]);
  const [declarations, setDeclarations] = useState<CarrierDeclarationRow[]>([]);
  const [destinations, setDestinations] = useState<SettlementDestinationRow[]>([]);
  const [matchability, setMatchability] = useState<EligibilityVerdict | null>(null);
  const [carrierVerdict, setCarrierVerdict] = useState<EligibilityVerdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const carrier = useMemo(() => carriers.find((c) => c.id === carrierId) ?? null, [carriers, carrierId]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("carrier_profiles")
        .select("id,partner_id,carrier_code,legal_entity_name,operating_status,contract_status")
        .order("legal_entity_name");
      if (error) toast({ title: "Could not load your Fleet Owner record", description: error.message, variant: "destructive" });
      const rows = (data ?? []) as unknown as CarrierRow[];
      setCarriers(rows);
      setCarrierId(rows[0]?.id ?? null);
      setLoading(false);
    })();
  }, []);

  const refresh = useCallback(async (id: string) => {
    const [i, d, s, m, cv] = await Promise.all([
      listComplianceItems(id), listDeclarations(id), listSettlementDestinations(id),
      carrierMatchability(id), carrierLevelEligibility(id),
    ]);
    setItems(i); setDeclarations(d); setDestinations(s); setMatchability(m); setCarrierVerdict(cv);
  }, []);

  useEffect(() => { if (carrierId) void refresh(carrierId); }, [carrierId, refresh]);

  const grouped = useMemo(() => ({
    CARRIER: items.filter((i) => i.responsibility_level === "CARRIER"),
    VEHICLE: items.filter((i) => i.responsibility_level === "VEHICLE"),
    DRIVER: items.filter((i) => i.responsibility_level === "DRIVER"),
  }), [items]);

  async function onProvision() {
    if (!carrierId) return;
    setBusy("provision");
    const res = await provisionCarrierRequirements(carrierId);
    setBusy(null);
    if (res?.error) return toast({ title: "Checklist not created", description: res.code, variant: "destructive" });
    toast({ title: "Requirement checklist ready" });
    await refresh(carrierId);
  }

  async function onUpload(item: ComplianceItemRow, file: File, form: HTMLFormElement) {
    if (!carrier?.partner_id) {
      return toast({ title: "No partner account linked", description: "Documents are stored against your partner account.", variant: "destructive" });
    }
    const fd = new FormData(form);
    setBusy(item.id);
    const res = await submitEvidence({
      itemId: item.id,
      partnerId: carrier.partner_id,
      carrierId: carrier.id,
      requirementCode: item.requirement_code,
      file,
      referenceNumber: String(fd.get("reference") ?? "") || undefined,
      issuingAuthority: String(fd.get("authority") ?? "") || undefined,
      issuedOn: String(fd.get("issued") ?? "") || undefined,
      expiresOn: String(fd.get("expires") ?? "") || undefined,
    });
    setBusy(null);
    if (res?.error) return toast({ title: "Document not submitted", description: res.code ?? res.message, variant: "destructive" });
    toast({ title: "Submitted for verification", description: item.requirement_label });
    form.reset();
    await refresh(carrier.id);
  }

  async function onAccept(code: (typeof FLEET_OWNER_INSTRUMENTS)[number]["code"], name: string, role: string) {
    if (!carrierId) return;
    const inst = FLEET_OWNER_INSTRUMENTS.find((i) => i.code === code)!;
    if (!name.trim()) return toast({ title: "Signatory name required", variant: "destructive" });
    setBusy(code);
    const res = await acceptDeclaration({
      carrierId, code, version: inst.version, title: inst.title,
      text: instrumentText(inst), acceptedByName: name, acceptedByRole: role,
    });
    setBusy(null);
    if (res?.error) return toast({ title: "Not recorded", description: res.code, variant: "destructive" });
    toast({ title: "Acceptance recorded", description: inst.title });
    await refresh(carrierId);
  }

  if (loading) {
    return <main className="container py-16"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></main>;
  }

  if (!carrier) {
    return (
      <main className="container max-w-3xl py-16">
        <h1 className="text-2xl font-semibold">Fleet Owner onboarding</h1>
        <Alert className="mt-6">
          <AlertTitle>No Fleet Owner record is linked to your account</AlertTitle>
          <AlertDescription>
            Fleet Owner onboarding starts from an approved partner account. Contact the TaxiD
            partnerships team to have your transport business registered, then return to this page.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const matchable = matchability?.matchable === true;

  return (
    <main className="container max-w-5xl py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Fleet Owner onboarding</h1>
        <p className="mt-2 text-sm text-muted-foreground">{FACILITATOR_DISCLOSURE}</p>
      </header>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{carrier.legal_entity_name}</CardTitle>
            <CardDescription>{carrier.carrier_code} · operating status {carrier.operating_status}</CardDescription>
          </div>
          <Badge variant="outline" className={matchable ? stateTone.VERIFIED : stateTone.REJECTED}>
            {matchable ? <ShieldCheck className="mr-1 h-3 w-3" aria-hidden /> : <ShieldAlert className="mr-1 h-3 w-3" aria-hidden />}
            {matchability?.state ?? "EVALUATING"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Your capacity becomes matchable only when every mandatory item below is verified, all
            instruments are accepted and your payout destination is verified. This verdict is the same
            one the dispatch engine applies to every candidate.
          </p>
          {(matchability?.blocking ?? []).length > 0 && (
            <ul className="space-y-1">
              {matchability!.blocking.map((b, idx) => (
                <li key={idx} className="text-destructive">
                  {b.code}{b.requirement ? ` — ${b.requirement}` : ""}
                </li>
              ))}
            </ul>
          )}
          {carrierVerdict?.state === "REQUIREMENTS_NOT_PROVISIONED" && (
            <Button onClick={onProvision} disabled={busy === "provision"}>
              {busy === "provision" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Create my requirement checklist
            </Button>
          )}
        </CardContent>
      </Card>

      {(["CARRIER", "VEHICLE", "DRIVER"] as const).map((level) => (
        grouped[level].length > 0 && (
          <Card key={level} className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">
                {level === "CARRIER" ? "Your business documents"
                  : level === "VEHICLE" ? "Vehicle documents" : "Driver documents"}
              </CardTitle>
              <CardDescription>
                {level === "CARRIER"
                  ? "Held in your business name as the independent transport service provider."
                  : level === "VEHICLE"
                    ? "Each vehicle is evidenced separately — one vehicle's document never covers another."
                    : "Each driver is evidenced separately — one driver's document never covers another."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {grouped[level].map((item) => (
                <div key={item.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {item.requirement_label}
                        {item.is_mandatory && <span className="ml-2 text-xs text-destructive">Mandatory</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.requirement_code}
                        {item.expires_on && ` · expires ${item.expires_on}`}
                        {item.reference_number && ` · ref ${item.reference_number}`}
                      </p>
                    </div>
                    <Badge variant="outline" className={stateTone[item.state]}>{item.state.replace(/_/g, " ")}</Badge>
                  </div>
                  {item.review_notes && (
                    <p className="mt-2 text-xs text-muted-foreground">Reviewer note: {item.review_notes}</p>
                  )}
                  {item.state !== "VERIFIED" && (
                    <form
                      className="mt-4 grid gap-3 md:grid-cols-5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const file = (form.elements.namedItem("file") as HTMLInputElement)?.files?.[0];
                        if (!file) return toast({ title: "Attach the document", variant: "destructive" });
                        void onUpload(item, file, form);
                      }}
                    >
                      <div className="md:col-span-2">
                        <Label htmlFor={`file-${item.id}`} className="text-xs">Document</Label>
                        <Input id={`file-${item.id}`} name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" required />
                      </div>
                      <div>
                        <Label htmlFor={`ref-${item.id}`} className="text-xs">Reference no.</Label>
                        <Input id={`ref-${item.id}`} name="reference" />
                      </div>
                      <div>
                        <Label htmlFor={`iss-${item.id}`} className="text-xs">Issued on</Label>
                        <Input id={`iss-${item.id}`} name="issued" type="date" />
                      </div>
                      <div>
                        <Label htmlFor={`exp-${item.id}`} className="text-xs">Expires on</Label>
                        <Input id={`exp-${item.id}`} name="expires" type="date" />
                      </div>
                      <div className="md:col-span-5">
                        <Button type="submit" size="sm" disabled={busy === item.id}>
                          {busy === item.id
                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                            : <Upload className="mr-2 h-4 w-4" aria-hidden />}
                          Submit for verification
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )
      ))}

      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Agreement, prohibited goods and indemnity</CardTitle>
              <CardDescription>
                The exact text you accept is hashed and stored, so the version you agreed to can always be proven.
              </CardDescription>
            </div>
            <FleetOwnerAgreementDocument
              fleetOwner={{
                legalEntityName: carrier.legal_entity_name,
                carrierCode: carrier.carrier_code,
                operatingStatus: carrier.operating_status,
                contractStatus: carrier.contract_status,
              }}
              declarations={declarations}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {FLEET_OWNER_INSTRUMENTS.map((inst) => {
            const accepted = declarations.find((d) => d.declaration_code === inst.code && d.accepted_at);
            return (
              <div key={inst.code} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{inst.title}</p>
                    <p className="text-xs text-muted-foreground">{inst.version} · {inst.summary}</p>
                  </div>
                  {accepted
                    ? <Badge variant="outline" className={stateTone.VERIFIED}>Accepted</Badge>
                    : <Badge variant="outline" className={stateTone.MISSING}>Not accepted</Badge>}
                </div>
                <ScrollArea className="mt-3 h-40 rounded-md border bg-muted/30 p-3">
                  <ol className="space-y-2 text-xs leading-relaxed">
                    {inst.clauses.map((c, i) => <li key={i}>{c}</li>)}
                  </ol>
                </ScrollArea>
                {!accepted && (
                  <form
                    className="mt-3 grid gap-3 md:grid-cols-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      void onAccept(inst.code, String(fd.get("name") ?? ""), String(fd.get("role") ?? ""));
                    }}
                  >
                    <div>
                      <Label htmlFor={`n-${inst.code}`} className="text-xs">Signatory full name</Label>
                      <Input id={`n-${inst.code}`} name="name" required />
                    </div>
                    <div>
                      <Label htmlFor={`r-${inst.code}`} className="text-xs">Position</Label>
                      <Input id={`r-${inst.code}`} name="role" placeholder="Director" />
                    </div>
                    <div className="flex items-end">
                      <Button type="submit" size="sm" disabled={busy === inst.code}>
                        {busy === inst.code && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                        I accept on behalf of the business
                      </Button>
                    </div>
                  </form>
                )}
                {accepted && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Accepted by {accepted.accepted_by_name ?? "—"} on {new Date(accepted.accepted_at!).toLocaleString()}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Where your earnings are paid</CardTitle>
          <CardDescription>
            TaxiD collects the Client's payment on your instruction and records your entitlement
            in your Fleet Owner wallet. Withdrawals are paid only to a destination verified by our finance team.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {destinations.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
              <div>
                <p className="font-medium">{d.destination_type === "MPESA" ? `M-Pesa ${d.msisdn}` : `${d.bank_name} ${d.bank_account_number}`}</p>
                <p className="text-xs text-muted-foreground">{d.account_name}</p>
              </div>
              <Badge variant="outline" className={d.verification_state === "VERIFIED" ? stateTone.VERIFIED : stateTone.PENDING_REVIEW}>
                {d.verification_state.replace(/_/g, " ")}
              </Badge>
            </div>
          ))}
          <Separator />
          <form
            className="grid gap-3 md:grid-cols-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const type = String(fd.get("type")) === "BANK" ? "BANK" as const : "MPESA" as const;
              setBusy("dest");
              const res = await registerSettlementDestination({
                carrierId: carrier.id,
                destinationType: type,
                accountName: String(fd.get("account_name") ?? ""),
                msisdn: type === "MPESA" ? String(fd.get("msisdn") ?? "") : undefined,
                bankName: type === "BANK" ? String(fd.get("bank_name") ?? "") : undefined,
                bankAccountNumber: type === "BANK" ? String(fd.get("bank_account") ?? "") : undefined,
                bankBranch: type === "BANK" ? String(fd.get("bank_branch") ?? "") : undefined,
              });
              setBusy(null);
              if (res?.error) return toast({ title: "Not saved", description: res.message ?? res.code, variant: "destructive" });
              toast({ title: "Submitted for verification" });
              form.reset();
              await refresh(carrier.id);
            }}
          >
            <div>
              <Label htmlFor="type" className="text-xs">Destination</Label>
              <select id="type" name="type" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="MPESA">M-Pesa</option>
                <option value="BANK">Bank account</option>
              </select>
            </div>
            <div>
              <Label htmlFor="account_name" className="text-xs">Account name</Label>
              <Input id="account_name" name="account_name" required />
            </div>
            <div>
              <Label htmlFor="msisdn" className="text-xs">M-Pesa number</Label>
              <Input id="msisdn" name="msisdn" placeholder="2547XXXXXXXX" />
            </div>
            <div>
              <Label htmlFor="bank_account" className="text-xs">Bank account no.</Label>
              <Input id="bank_account" name="bank_account" />
            </div>
            <div>
              <Label htmlFor="bank_name" className="text-xs">Bank</Label>
              <Input id="bank_name" name="bank_name" />
            </div>
            <div>
              <Label htmlFor="bank_branch" className="text-xs">Branch</Label>
              <Input id="bank_branch" name="bank_branch" />
            </div>
            <div className="flex items-end md:col-span-2">
              <Button type="submit" size="sm" disabled={busy === "dest"}>
                {busy === "dest" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Submit payout destination
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
