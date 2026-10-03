/**
 * DRIVER APPLICATION — the entry point for a professional driver who wants to
 * join the TaxiD network.
 *
 * The form records an application and a document checklist. Nothing here
 * approves a driver or marks a document verified: the staff decision functions
 * do that, and approval is refused until every mandatory document is verified.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, Search, Upload, ShieldCheck, IdCard, FileCheck2, CarFront, ArrowRight, Camera, Clock3 } from "lucide-react";
import driverPhoto from "@/assets/driver-onboarding.jpg";
import {
  submitDriverApplication, driverApplicationStatus, attachDriverDocument,
  myDriverApplications,
  DRIVER_SERVICE_CATEGORIES, DRIVER_LICENCE_CLASSES,
  type DriverApplicationStatus, type DriverApplicationDocumentRow,
  type DriverApplicationRow,
} from "@/lib/drivers/applications";
import { KENYA_COUNTIES } from "@/pages/corporate/register/data";
import { SeoHead } from "@/components/seo/SeoHead";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";

const STATUS_COPY: Record<DriverApplicationStatus, string> = {
  SUBMITTED: "Received — waiting for a reviewer",
  UNDER_REVIEW: "Under review by our driver compliance team",
  INFO_REQUESTED: "More information or a corrected document is needed from you",
  APPROVED: "Approved — your driver record has been created",
  REJECTED: "Not accepted",
  WITHDRAWN: "Withdrawn",
};

const stateTone: Record<string, string> = {
  VERIFIED: "bg-status-success/10 text-status-success border-status-success/30",
  PENDING_REVIEW: "bg-status-warning/10 text-status-warning border-status-warning/30",
  MISSING: "bg-muted text-muted-foreground",
  REJECTED: "bg-destructive/10 text-destructive border-destructive/30",
  EXPIRED: "bg-destructive/10 text-destructive border-destructive/30",
};

const NO_EXPIRY_CODES = ["KRA_PIN", "NATIONAL_ID", "FULL_PHOTO"];
const IDENTITY_CODES = ["NATIONAL_ID", "PASSPORT"];
const DOCUMENT_ORDER = ["NATIONAL_ID", "PASSPORT", "KRA_PIN", "FULL_PHOTO", "DRIVING_LICENCE", "PSV_BADGE", "GOOD_CONDUCT", "VEHICLE_LOGBOOK", "INSURANCE_STICKER"];
const DOCUMENT_HINTS: Record<string, string> = {
  NATIONAL_ID: "Photograph both sides clearly and upload them together as one PDF or image.",
  PASSPORT: "Upload the biodata page. The issue and expiry dates are required.",
  KRA_PIN: "The name and PIN must be readable.",
  FULL_PHOTO: "Use a clear, full-size photograph of yourself, not a cropped passport-size image.",
  DRIVING_LICENCE: "Include the licence number, class and both dates.",
  PSV_BADGE: "Include the badge number and validity dates.",
  GOOD_CONDUCT: "Upload your current certificate of good conduct.",
  VEHICLE_LOGBOOK: "The vehicle registration and owner details must be readable.",
  INSURANCE_STICKER: "Upload the matching PSV comprehensive insurance sticker.",
};

export default function DriverApply() {
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [ownership, setOwnership] = useState<"NONE" | "OWNER" | "FLEET_ASSIGNED">("NONE");
  const [receipt, setReceipt] = useState<{ reference: string; token: string } | null>(null);
  const [lookup, setLookup] = useState<{
    id: string; reference: string; status: DriverApplicationStatus; name: string; notes: string | null;
  } | null>(null);
  const [documents, setDocuments] = useState<DriverApplicationDocumentRow[]>([]);
  const [mine, setMine] = useState<DriverApplicationRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [identity, setIdentity] = useState<"NATIONAL_ID" | "PASSPORT">("NATIONAL_ID");
  const [selectedFiles, setSelectedFiles] = useState<Record<string, string>>({});

  const refParam = params.get("ref") ?? "";
  const tokenParam = params.get("token") ?? "";

  const loadStatus = useCallback(async (reference: string, token: string) => {
    setChecking(true);
    const res = await driverApplicationStatus(reference, token);
    setChecking(false);
    if (res?.error || !res.status) {
      toast({
        title: "We could not find that application",
        description: "Check the reference and the private link code.",
        variant: "destructive",
      });
      return;
    }
    setLookup({
      id: String(res.application_id ?? ""),
      reference,
      status: res.status as DriverApplicationStatus,
      name: String(res.applicant_name ?? ""),
      notes: (res.review_notes as string | null) ?? null,
    });
    setDocuments((res.documents ?? []) as unknown as DriverApplicationDocumentRow[]);
    const rows = (res.documents ?? []) as unknown as DriverApplicationDocumentRow[];
    if (rows.find((d) => d.doc_code === "PASSPORT" && d.state !== "MISSING") && !rows.find((d) => d.doc_code === "NATIONAL_ID" && d.state !== "MISSING")) setIdentity("PASSPORT");
  }, []);

  useEffect(() => {
    if (refParam && tokenParam) void loadStatus(refParam, tokenParam);
  }, [refParam, tokenParam, loadStatus]);

  useEffect(() => { void myDriverApplications().then(setMine); }, []);

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const str = (k: string) => String(fd.get(k) ?? "").trim();
    setBusy(true);
    const res = await submitDriverApplication({
      first_name: str("first_name"),
      middle_name: str("middle_name") || undefined,
      last_name: str("last_name"),
      gender: str("gender") || undefined,
      date_of_birth: str("date_of_birth") || undefined,
      national_id: str("national_id"),
      kra_pin: str("kra_pin") || undefined,
      contact_email: str("contact_email"),
      contact_phone: str("contact_phone"),
      county: str("county") || undefined,
      town: str("town") || undefined,
      licence_number: str("licence_number"),
      licence_classes: classes,
      licence_expiry: str("licence_expiry") || undefined,
      psv_badge_number: str("psv_badge_number") || undefined,
      years_experience: Number(fd.get("years_experience")) || undefined,
      vehicle_ownership: ownership,
      vehicle_registration: str("vehicle_registration") || undefined,
      vehicle_make_model: str("vehicle_make_model") || undefined,
      service_categories: services,
      preferred_city: str("preferred_city") || undefined,
      notes: str("notes") || undefined,
    });
    setBusy(false);
    if (res?.error || !res.application_reference || !res.claim_token) {
      return toast({
        title: "Application not submitted",
        description: (res.code ?? res.message ?? "Please check your details and try again.").replace(/_/g, " ").toLowerCase(),
        variant: "destructive",
      });
    }
    setReceipt({ reference: String(res.application_reference), token: String(res.claim_token) });
    if (res.duplicate) {
      toast({ title: "You already have an open application", description: String(res.application_reference) });
    } else {
      toast({ title: "Application received", description: String(res.application_reference) });
      form.reset();
      setServices([]); setClasses([]); setOwnership("NONE");
    }
  }

  async function onUpload(doc: DriverApplicationDocumentRow, file: File, form: HTMLFormElement) {
    if (!lookup) return;
    const fd = new FormData(form);
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024) {
      return toast({ title: "Choose a JPG, PNG, WebP or PDF under 15 MB", variant: "destructive" });
    }
    const issued = String(fd.get("issued") ?? "");
    const expires = String(fd.get("expires") ?? "");
    const today = new Date().toISOString().slice(0, 10);
    if (!issued || issued > today || (!NO_EXPIRY_CODES.includes(doc.doc_code) && (!expires || expires <= today || expires <= issued))) {
      return toast({ title: "Check the document dates", description: "Enter a valid date of issue and, where required, a future expiry date.", variant: "destructive" });
    }
    setUploading(doc.id);
    const res = await attachDriverDocument({
      documentId: doc.id,
      applicationReference: lookup.reference,
      docCode: doc.doc_code,
      file,
      documentNumber: String(fd.get("number") ?? "") || undefined,
      issuingAuthority: String(fd.get("authority") ?? "") || undefined,
      issuedOn: String(fd.get("issued") ?? "") || undefined,
      expiresOn: String(fd.get("expires") ?? "") || undefined,
    });
    setUploading(null);
    if (res?.error) {
      return toast({
        title: "Document not submitted",
        description: (res.code ?? res.message ?? "").replace(/_/g, " ").toLowerCase(),
        variant: "destructive",
      });
    }
    toast({ title: "Sent for verification", description: `${doc.doc_label} is now with our compliance team.` });
    form.reset();
    setSelectedFiles((files) => ({ ...files, [doc.id]: "" }));
    await loadStatus(lookup.reference, tokenParam);
  }

  const sortedDocuments = [...documents].sort((a, b) => DOCUMENT_ORDER.indexOf(a.doc_code) - DOCUMENT_ORDER.indexOf(b.doc_code));
  const activeDocuments = sortedDocuments.filter((d) => !IDENTITY_CODES.includes(d.doc_code) || d.doc_code === identity);
  const completedCount = activeDocuments.filter((d) => d.state === "VERIFIED").length;
  const submittedCount = activeDocuments.filter((d) => d.state === "VERIFIED" || d.state === "PENDING_REVIEW").length;

  if (receipt) {
    const statusUrl = `/driver/apply?ref=${receipt.reference}&token=${receipt.token}`;
    return (
      <main className="container max-w-2xl py-16">
        <Card>
          <CardHeader>
            <Badge variant="outline" className="mb-2 w-fit border-status-success/30 bg-status-success/10 text-status-success">
              <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden /> Application received
            </Badge>
            <CardTitle>Reference {receipt.reference}</CardTitle>
            <CardDescription>
              Next: upload your National ID or Passport, driving licence, PSV badge, good conduct certificate, KRA PIN, full-size photograph, logbook and PSV insurance certificate with sticker.
              A reviewer verifies each document before your driver record is created.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Alert>
              <AlertTitle>Save this private link</AlertTitle>
              <AlertDescription className="break-all">
                {typeof window !== "undefined" ? window.location.origin : ""}{statusUrl}
                <br />
                It is how you upload documents and check progress.
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => {
                const r = receipt;
                setReceipt(null);
                setParams({ ref: r.reference, token: r.token });
                void loadStatus(r.reference, r.token);
              }}>Upload my documents</Button>
              <Button variant="outline" onClick={() => setReceipt(null)}>Back to the form</Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container max-w-4xl py-12">
      <SeoHead
        path="/driver/apply"
        title="Drive with TaxiD — Driver Application"
        description="Apply to join the TaxiD professional driver network in Kenya: submit your licence, ID and good conduct certificate and track your approval."
      />
      <header className="mb-8 overflow-hidden rounded-md bg-foreground text-background md:grid md:grid-cols-2">
        <div className="flex flex-col justify-center px-6 py-9 md:px-10 md:py-12">
          <img src="/taxid-lockup.png" alt="TaxiD" className="mb-7 h-10 w-auto max-w-40 object-contain object-left" />
          <p className="mb-3 text-xs font-semibold uppercase text-gold">DRIVE WITH TAXID</p>
          <h1 className="text-3xl font-semibold leading-tight md:text-4xl">Your next journey starts here.</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-background/80">
            Join the TaxiD driver network. Send your details and documents, follow each review, and get ready for work once approved.
          </p>
          <div className="mt-7 flex flex-wrap gap-4 text-xs text-background/80">
            <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-gold" /> Verified network</span>
            <span className="flex items-center gap-2"><CarFront className="h-4 w-4 text-gold" /> One driver account</span>
          </div>
        </div>
        <img src={driverPhoto} alt="Professional TaxiD driver in a car in Nairobi" width={1024} height={768} className="h-56 w-full object-cover md:h-full md:min-h-80" />
      </header>

      {lookup ? (
        <>
          <div className="mb-8 grid gap-4 border-y py-6 sm:grid-cols-3">
            <div><p className="flex items-center gap-2 text-sm font-medium"><IdCard className="h-4 w-4 text-primary" /> 01 / Identity</p><p className="mt-1 text-xs text-muted-foreground">ID or passport comes first</p></div>
            <div><p className="flex items-center gap-2 text-sm font-medium"><FileCheck2 className="h-4 w-4 text-primary" /> 02 / Documents</p><p className="mt-1 text-xs text-muted-foreground">Upload and track each item</p></div>
            <div><p className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-primary" /> 03 / Review</p><p className="mt-1 text-xs text-muted-foreground">Staff verify before activation</p></div>
          </div>
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-lg">{lookup.name || lookup.reference}</CardTitle>
              <CardDescription>Reference {lookup.reference}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="font-medium">{STATUS_COPY[lookup.status]}</p>
              {lookup.notes && <p className="text-muted-foreground">Reviewer note: {lookup.notes}</p>}
              {lookup.status === "APPROVED" && (
                <Button asChild><Link to="/driver/onboarding">Continue driver onboarding</Link></Button>
              )}
              <div className="pt-3">
                <div className="mb-2 flex items-center justify-between text-xs"><span>Document progress</span><span>{completedCount} verified · {submittedCount} sent / {activeDocuments.length}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Documents sent for review" aria-valuenow={submittedCount} aria-valuemin={0} aria-valuemax={activeDocuments.length}>
                  <div className="h-full bg-primary transition-all" style={{ width: `${activeDocuments.length ? submittedCount / activeDocuments.length * 100 : 0}%` }} />
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setLookup(null); setDocuments([]); setParams({}); }}>
                Start a new application
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your documents</CardTitle>
              <CardDescription>
                Sign in with the email on your application to upload. Every document marked * is required.
                For identity, upload <strong>either</strong> your National ID <strong>or</strong> your Passport.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-b pb-5">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><IdCard className="h-4 w-4 text-primary" /> 01 / Choose your identity document *</p>
                <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Choose National ID or Passport">
                  {IDENTITY_CODES.map((code) => {
                    const row = documents.find((d) => d.doc_code === code);
                    return <Button key={code} type="button" variant={identity === code ? "default" : "outline"} className="h-auto min-h-12 justify-start whitespace-normal text-left" onClick={() => setIdentity(code as typeof identity)}>
                      <IdCard className="mr-2 h-4 w-4 shrink-0" /> {code === "NATIONAL_ID" ? "National Identity card" : "Passport"}{row?.state === "VERIFIED" ? " · Verified" : row?.state === "PENDING_REVIEW" ? " · Awaiting review" : ""}
                    </Button>;
                  })}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">A passport needs both its issue and expiry dates. A National ID does not expire.</p>
              </div>
              {documents.length === 0 && <p className="text-sm text-muted-foreground">No checklist items found.</p>}
              {activeDocuments.map((d, index) => (
                <div key={d.id} className="rounded-md border p-4 md:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground">{index === 0 ? "01 / Identity" : `02 / Document ${index} of ${activeDocuments.length - 1}`}</p>
                      <p className="mt-1 text-sm font-semibold">
                        {d.doc_label}{d.is_mandatory ? " *" : ""}
                        {IDENTITY_CODES.includes(d.doc_code) && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">One of National ID or Passport *</span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{DOCUMENT_HINTS[d.doc_code]}</p>
                      {d.review_notes && <p className="text-xs text-muted-foreground">Reviewer: {d.review_notes}</p>}
                    </div>
                    <Badge variant="outline" className={stateTone[d.state]}>{d.state.replace(/_/g, " ")}</Badge>
                  </div>
                  {d.state !== "VERIFIED" && (
                    <form
                      className="mt-4 space-y-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const input = form.elements.namedItem("file") as HTMLInputElement;
                        const file = input?.files?.[0];
                        if (!file) return toast({ title: "Choose a file first", variant: "destructive" });
                        void onUpload(d, file, form);
                      }}
                    >
                      <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-primary/40 bg-accent/40 px-4 py-4 text-center transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-ring">
                        <Camera className="h-5 w-5 text-primary" aria-hidden />
                        <span className="break-all text-sm font-medium">{selectedFiles[d.id] || "Choose a clear photo or PDF"}</span>
                        <span className="text-xs text-muted-foreground">JPG, PNG, WebP or PDF · up to 15 MB</span>
                        <Input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="sr-only" onChange={(e) => setSelectedFiles((files) => ({ ...files, [d.id]: e.target.files?.[0]?.name ?? "" }))} />
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <div><Label className="text-xs" htmlFor={`number-${d.id}`}>Document number</Label><Input id={`number-${d.id}`} name="number" placeholder="As printed on document" maxLength={80} /></div>
                        <div><Label className="text-xs" htmlFor={`issued-${d.id}`}>Date of issue *</Label><Input id={`issued-${d.id}`} name="issued" type="date" required max={new Date().toISOString().slice(0, 10)} /></div>
                        <div><Label className="text-xs" htmlFor={`expires-${d.id}`}>Expiry date{NO_EXPIRY_CODES.includes(d.doc_code) ? "" : " *"}</Label>
                          {NO_EXPIRY_CODES.includes(d.doc_code) ? <p className="flex h-10 items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-4 w-4" /> Does not expire</p> : <Input id={`expires-${d.id}`} name="expires" type="date" required min={new Date().toISOString().slice(0, 10)} />}
                        </div>
                      </div>
                      <div>
                        <Button type="submit" size="sm" disabled={uploading === d.id}>
                          {uploading === d.id
                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                            : <Upload className="mr-2 h-4 w-4" aria-hidden />}
                          Send for verification <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <div className="mb-8 grid gap-4 border-y py-6 text-sm md:grid-cols-4">
            {[
              ["01 / Apply", "Your details and the work you want."],
              ["02 / Upload", "Identity first, then your driving and vehicle documents."],
              ["03 / Review", "A reviewer checks each submitted document."],
              ["04 / Drive", "You can go live only after approval."],
            ].map(([t, d]) => (
              <div key={t}><p className="font-semibold text-primary">{t}</p><p className="mt-1 text-xs text-muted-foreground">{d}</p></div>
            ))}
          </div>

          {mine.length > 0 && (
            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="text-lg">Your applications</CardTitle>
                <CardDescription>Open one to upload documents or check progress.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {mine.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                    <span className="font-medium">{a.application_reference}</span>
                    <Badge variant="outline">{a.status.replace(/_/g, " ")}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your application</CardTitle>
              <CardDescription>Fields marked * are needed before we can review.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-5 md:grid-cols-2" onSubmit={onSubmit}>
                <div>
                  <Label htmlFor="first_name">First name *</Label>
                  <Input id="first_name" name="first_name" required minLength={2} maxLength={80} />
                </div>
                <div>
                  <Label htmlFor="middle_name">Middle name</Label>
                  <Input id="middle_name" name="middle_name" maxLength={80} />
                </div>
                <div>
                  <Label htmlFor="last_name">Last name *</Label>
                  <Input id="last_name" name="last_name" required minLength={2} maxLength={80} />
                </div>
                <div>
                  <Label htmlFor="gender">Gender</Label>
                  <select id="gender" name="gender" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Prefer not to say</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="date_of_birth">Date of birth</Label>
                  <Input id="date_of_birth" name="date_of_birth" type="date" />
                </div>
                <div className="md:col-span-2 space-y-2">
                  <Label>Identity document *</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant={identity === "NATIONAL_ID" ? "default" : "outline"} onClick={() => setIdentity("NATIONAL_ID")}>National Identity card</Button>
                    <Button type="button" variant={identity === "PASSPORT" ? "default" : "outline"} onClick={() => setIdentity("PASSPORT")}>Passport</Button>
                  </div>
                </div>
                <div>
                  <Label htmlFor="national_id">{identity === "PASSPORT" ? "Passport number" : "National ID number"} *</Label>
                  <Input id="national_id" name="national_id" required minLength={5} maxLength={20} />
                  {identity === "PASSPORT" && <p className="mt-1 text-xs text-muted-foreground">You will add the passport's issue and expiry dates when uploading it.</p>}
                </div>
                <div>
                  <Label htmlFor="kra_pin">KRA PIN</Label>
                  <Input id="kra_pin" name="kra_pin" maxLength={40} />
                </div>
                <div>
                  <Label htmlFor="contact_email">Email *</Label>
                  <Input id="contact_email" name="contact_email" type="email" required maxLength={200} />
                </div>
                <div>
                  <Label htmlFor="contact_phone">Phone *</Label>
                  <Input id="contact_phone" name="contact_phone" required placeholder="+254 7XX XXX XXX" />
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
                <div>
                  <Label htmlFor="preferred_city">Where you want to work</Label>
                  <Input id="preferred_city" name="preferred_city" placeholder="Nairobi" maxLength={120} />
                </div>

                <div className="md:col-span-2 border-t pt-4">
                  <p className="text-sm font-medium">Your licence</p>
                </div>
                <div>
                  <Label htmlFor="licence_number">Driving licence number *</Label>
                  <Input id="licence_number" name="licence_number" required minLength={4} maxLength={40} />
                </div>
                <div>
                  <Label htmlFor="licence_expiry">Licence expiry</Label>
                  <Input id="licence_expiry" name="licence_expiry" type="date" />
                </div>
                <div>
                  <Label htmlFor="psv_badge_number">PSV badge number</Label>
                  <Input id="psv_badge_number" name="psv_badge_number" maxLength={60} />
                </div>
                <div>
                  <Label htmlFor="years_experience">Years driving professionally</Label>
                  <Input id="years_experience" name="years_experience" type="number" min={0} max={60} />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-sm">Licence classes</Label>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {DRIVER_LICENCE_CLASSES.map((c) => (
                      <label key={c} className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
                        <Checkbox checked={classes.includes(c)} onCheckedChange={() => toggle(classes, setClasses, c)} />
                        {c}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-2 border-t pt-4">
                  <p className="text-sm font-medium">Vehicle</p>
                </div>
                <div>
                  <Label htmlFor="vehicle_ownership">Do you have a vehicle? *</Label>
                  <select
                    id="vehicle_ownership"
                    name="vehicle_ownership"
                    value={ownership}
                    onChange={(e) => setOwnership(e.target.value as typeof ownership)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="NONE">No — I want to drive a partner vehicle</option>
                    <option value="OWNER">Yes — I own my vehicle</option>
                    <option value="FLEET_ASSIGNED">I already drive for a fleet owner</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="vehicle_registration">Registration plate</Label>
                  <Input id="vehicle_registration" name="vehicle_registration" maxLength={20} placeholder="KDA 123A" />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="vehicle_make_model">Make and model</Label>
                  <Input id="vehicle_make_model" name="vehicle_make_model" maxLength={120} placeholder="Toyota Premio 2016" />
                </div>

                <div className="md:col-span-2">
                  <Label className="text-sm">Work you want</Label>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {DRIVER_SERVICE_CATEGORIES.map((s) => (
                      <label key={s} className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
                        <Checkbox checked={services.includes(s)} onCheckedChange={() => toggle(services, setServices, s)} />
                        {s.replace(/_/g, " ").toLowerCase()}
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
                    Submitting does not approve you. Every mandatory document must be verified first.
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-lg">Already applied?</CardTitle>
              <CardDescription>Enter your reference and the private link code from your confirmation.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-3 md:grid-cols-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const ref = String(fd.get("ref") ?? "").trim();
                  const token = String(fd.get("token") ?? "").trim();
                  if (!ref || !token) return;
                  setParams({ ref, token });
                }}
              >
                <Input name="ref" placeholder="DRV-YYYYMM-XXXXXX" aria-label="Application reference" />
                <Input name="token" placeholder="Private link code" aria-label="Private link code" />
                <Button type="submit" variant="outline" disabled={checking}>
                  {checking
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    : <Search className="mr-2 h-4 w-4" aria-hidden />}
                  Check status
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
