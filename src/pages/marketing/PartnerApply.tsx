/**
 * TaxiD PARTNERS — public partner application.
 *
 * Submits to `partner_applications`, which anyone may write to and only TaxiD
 * staff may read. The reference returned is the applicant's only handle on the
 * submission; it is shown once, plainly, with no invented approval timeline.
 */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONTACT } from "@/config/contact";
import { findSegment } from "@/lib/partners/taxonomy";
import { findBring, findLevel } from "@/lib/partners/intent";
import { LIFECYCLE } from "@/lib/partners/workspaceLifecycle";
import { currentFrameVariant } from "@/lib/partners/abTest";
import { upsertIntentProfile } from "@/lib/partners/signals";
import { getSessionId } from "@/lib/cta";
import {
  COMMERCIAL_MODEL_LABEL, PARTNER_TYPE_LABEL, submitPartnerApplication, PartnerApplicationError,
  validatePartnerApplication, type CommercialModel, type PartnerApplicationInput,

  type PartnerType,
} from "@/lib/partners/api";

const COUNTRIES = [
  { code: "KE", label: "Kenya" },
  { code: "UG", label: "Uganda" },
  { code: "TZ", label: "Tanzania" },
  { code: "RW", label: "Rwanda" },
  { code: "ET", label: "Ethiopia" },
  { code: "OTHER", label: "Other" },
];

/**
 * The landing page routes each conversion path here with `?track=` (and
 * optionally `?model=`). The track only pre-selects sensible defaults and
 * labels the form — the applicant can still change every field, and nothing
 * unvalidated from the URL reaches the submission payload.
 */
const TRACKS = {
  distribution: {
    label: "Business partner — sell mobility to your customers",
    partner_type: "TOUR_OPERATOR" as PartnerType,
    commercial_model: "BOOK" as CommercialModel,
  },
  supply: {
    label: "Supply partner — provide vehicles, fleets or logistics capacity",
    partner_type: "LOGISTICS" as PartnerType,
    commercial_model: "ORCHESTRATE" as CommercialModel,
  },
  technology: {
    label: "Technology & enterprise partner — integrate TaxiD",
    partner_type: "TRAVEL_PLATFORM" as PartnerType,
    commercial_model: "API" as CommercialModel,
  },
} as const;

type TrackKey = keyof typeof TRACKS;

export default function PartnerApply() {
  const [params] = useSearchParams();
  const trackParam = params.get("track");
  const track: TrackKey | null =
    trackParam && trackParam in TRACKS ? (trackParam as TrackKey) : null;
  const modelParam = params.get("model");
  const model: CommercialModel | null =
    modelParam && modelParam in COMMERCIAL_MODEL_LABEL ? (modelParam as CommercialModel) : null;

  /**
   * `?type=` is the precise entry point: it names a segment from the partner
   * capability registry, so the category and model come from the taxonomy
   * rather than a three-way guess. Unknown slugs are ignored.
   */
  const segment = findSegment(params.get("type"));

  /**
   * The landing page also carries the visitor's routing answer (`?bring=`), the
   * maturity level they selected (`?level=`) and the lifecycle stage they were
   * reading (`?stage=`). The level decides the commercial model when no explicit
   * `?model=` was given; all three are echoed back so the applicant can see what
   * was carried over, and are summarised in the requirements note.
   */
  const bring = findBring(params.get("bring"));
  const level = findLevel(params.get("level"));
  const stage = LIFECYCLE.find((s) => s.id === params.get("stage"));

  const [form, setForm] = useState<PartnerApplicationInput>({
    organisation_name: "",
    partner_type: segment?.prefill?.partner_type ?? (track ? TRACKS[track].partner_type : "TOUR_OPERATOR"),
    commercial_model:
      model ?? segment?.prefill?.commercial_model ?? level?.model ?? (track ? TRACKS[track].commercial_model : "BOOK"),
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    country: "KE",
    city: "",
    website: "",
    monthly_volume_estimate: null,
    requirements: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [human, setHuman] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  const set = <K extends keyof PartnerApplicationInput>(key: K, value: PartnerApplicationInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = validatePartnerApplication(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast.error("Some required details are missing.");
      return;
    }
    setSubmitting(true);
    try {
      /**
       * The application carries the visitor's own selections, and the same
       * context creates or updates the partner intent profile keyed on the
       * contact email — so a returning applicant updates one profile rather
       * than accumulating disconnected submissions. The profile upsert is a
       * server-side routine; if it fails the application still stands and the
       * reference is still shown.
       */
      const context = {
        intent_bring: bring?.key ?? null,
        network_category: params.get("cat"),
        maturity_level: level?.id ?? null,
        lifecycle_stage: stage?.id ?? null,
        ab_variant: currentFrameVariant(),
        session_id: getSessionId(),
      };
      const { reference: ref, id } = await submitPartnerApplication(form, context);
      await upsertIntentProfile({
        contact_email: form.contact_email,
        organisation_name: form.organisation_name,
        contact_name: form.contact_name,
        contact_phone: form.contact_phone,
        country: form.country,
        city: form.city ?? null,
        partner_type: form.partner_type,
        commercial_model: form.commercial_model,
        intent_bring: context.intent_bring,
        network_category: context.network_category,
        maturity_level: context.maturity_level,
        lifecycle_stage: context.lifecycle_stage,
        application_id: id,
      });
      setReference(ref);
    } catch (err) {
      // Field-specific where the server named a field; never raw database text.
      if (err instanceof PartnerApplicationError) {
        if (err.field) setErrors((e) => ({ ...e, [err.field as string]: err.message }));
        toast.error(err.message);
      } else {
        console.error("[partner-apply] unexpected submission failure", err);
        toast.error("Your application could not be submitted. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }

  }

  if (reference) {
    return (
      <MarketingPage>
        <PageHero eyebrow="TaxiD Partners" title="Application received" subtitle="The partner desk reviews every application against company registration, tax and contact verification." />
        <section className="container mx-auto max-w-2xl px-4 py-20">
          <div className="rounded-2xl border border-border bg-card p-8">
            <CheckCircle2 className="mb-4 h-8 w-8 text-status-success" aria-hidden />
            <h2 className="mb-2 text-2xl font-bold">Your reference is {reference}</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Keep this reference. Quote it in any correspondence with the partner desk. We will contact{" "}
              <span className="font-medium text-foreground">{form.contact_email}</span> once the review is complete.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild><Link to="/partners">Back to TaxiD Partners</Link></Button>
              <Button variant="outline" asChild>
                <a href={`mailto:${CONTACT.salesEmail}?subject=Partner%20application%20${reference}`}>Email the partner desk</a>
              </Button>
            </div>
          </div>
        </section>
      </MarketingPage>
    );
  }

  return (
    <MarketingPage>
      <PageHero
        eyebrow="TaxiD Partners"
        title="Become a TaxiD Partner"
        subtitle="Tell us who you are, what you sell and how you want to work with TaxiD. Verification and commercial terms follow the review."
      />

      <section className="container mx-auto max-w-3xl px-4 py-16">
        <Link to="/partners" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to TaxiD Partners
        </Link>

        {segment ? (
          <p className="mb-8 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
            <span className="font-semibold text-primary">Applying as:</span>{" "}
            <span className="text-muted-foreground">{segment.label}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {segment.capability === "application_only"
                ? "This partnership is admitted through the partner desk — category and model are pre-selected, and commercial terms are agreed before go-live."
                : "Category and partnership model are pre-selected for this partner type — change them if another fits better."}
            </span>
          </p>
        ) : track ? (
          <p className="mb-8 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
            <span className="font-semibold text-primary">Selected track:</span>{" "}
            <span className="text-muted-foreground">{TRACKS[track].label}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Category and partnership model are pre-selected for this track — change them if another fits better.
            </span>
          </p>
        ) : null}

        {(bring || level || stage) && (
          <div className="mb-8 rounded-xl border border-border bg-muted/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Carried over from your visit
            </p>
            <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-3">
              {bring && (
                <div>
                  <dt className="text-xs text-muted-foreground">What you bring</dt>
                  <dd className="font-medium">{bring.answer}</dd>
                </div>
              )}
              {level && (
                <div>
                  <dt className="text-xs text-muted-foreground">Integration level</dt>
                  <dd className="font-medium">{level.label}</dd>
                </div>
              )}
              {stage && (
                <div>
                  <dt className="text-xs text-muted-foreground">Lifecycle stage of interest</dt>
                  <dd className="font-medium">{stage.label}</dd>
                </div>
              )}
            </dl>
          </div>
        )}







        <form onSubmit={onSubmit} className="space-y-8" noValidate>
          <fieldset className="rounded-2xl border border-border bg-card p-6">
            <legend className="px-2 text-sm font-semibold">Organisation</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="organisation_name">Registered organisation name *</Label>
                <Input id="organisation_name" value={form.organisation_name}
                  onChange={(e) => set("organisation_name", e.target.value)}
                  aria-invalid={Boolean(errors.organisation_name)} />
                {errors.organisation_name && <p className="mt-1 text-xs text-destructive">{errors.organisation_name}</p>}
              </div>
              <div>
                <Label htmlFor="partner_type">Partner category</Label>
                <Select value={form.partner_type} onValueChange={(v) => set("partner_type", v as PartnerType)}>
                  <SelectTrigger id="partner_type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PARTNER_TYPE_LABEL).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="commercial_model">Preferred partnership model</Label>
                <Select value={form.commercial_model} onValueChange={(v) => set("commercial_model", v as CommercialModel)}>
                  <SelectTrigger id="commercial_model"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(COMMERCIAL_MODEL_LABEL).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="country">Country</Label>
                <Select value={form.country} onValueChange={(v) => set("country", v)}>
                  <SelectTrigger id="country"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="city">City</Label>
                <Input id="city" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="website">Website</Label>
                <Input id="website" inputMode="url" placeholder="https://" value={form.website ?? ""}
                  onChange={(e) => set("website", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="volume">Estimated monthly bookings</Label>
                <Input id="volume" type="number" min={0} value={form.monthly_volume_estimate ?? ""}
                  onChange={(e) => set("monthly_volume_estimate", e.target.value === "" ? null : Number(e.target.value))} />
              </div>
            </div>
          </fieldset>

          <fieldset className="rounded-2xl border border-border bg-card p-6">
            <legend className="px-2 text-sm font-semibold">Primary contact</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="contact_name">Full name *</Label>
                <Input id="contact_name" value={form.contact_name}
                  onChange={(e) => set("contact_name", e.target.value)}
                  aria-invalid={Boolean(errors.contact_name)} />
                {errors.contact_name && <p className="mt-1 text-xs text-destructive">{errors.contact_name}</p>}
              </div>
              <div>
                <Label htmlFor="contact_email">Work email *</Label>
                <Input id="contact_email" type="email" value={form.contact_email}
                  onChange={(e) => set("contact_email", e.target.value)}
                  aria-invalid={Boolean(errors.contact_email)} />
                {errors.contact_email && <p className="mt-1 text-xs text-destructive">{errors.contact_email}</p>}
              </div>
              <div>
                <Label htmlFor="contact_phone">Phone *</Label>
                <Input id="contact_phone" inputMode="tel" placeholder="+254…" value={form.contact_phone}
                  onChange={(e) => set("contact_phone", e.target.value)}
                  aria-invalid={Boolean(errors.contact_phone)} />
                {errors.contact_phone && <p className="mt-1 text-xs text-destructive">{errors.contact_phone}</p>}
              </div>
            </div>
          </fieldset>

          <fieldset className="rounded-2xl border border-border bg-card p-6">
            <legend className="px-2 text-sm font-semibold">What do you need from TaxiD?</legend>
            <Label htmlFor="requirements" className="sr-only">Requirements</Label>
            <Textarea id="requirements" rows={5}
              placeholder="Services you sell, typical routes, group sizes, delivery volumes, integration needs…"
              value={form.requirements ?? ""} onChange={(e) => set("requirements", e.target.value)} />
          </fieldset>

          <div className="space-y-4">
            <label className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-border"
                checked={human}
                onChange={(e) => setHuman(e.target.checked)}
                aria-describedby="human-check-note"
              />
              <span>
                I confirm I am a person applying on behalf of {form.organisation_name.trim() || "my organisation"},
                and the details above are accurate.
                <span id="human-check-note" className="mt-1 block text-xs text-muted-foreground">
                  This keeps automated spam out of the partner desk.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit" size="lg" disabled={submitting || !human}>
                {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Submitting…</> : "Submit partner application"}
              </Button>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Reviewed by the TaxiD partner desk. Verification documents are requested after review.
              </p>
            </div>
          </div>

        </form>
      </section>
    </MarketingPage>
  );
}
