/**
 * Enterprise-grade charter lead capture.
 *
 * A three-step premium enquiry: the mission, the route, then the procurement
 * identity. Submissions go through the governed `contact-submission` edge
 * function, which emails the charter desk inbox and queues the lead in the
 * internal Lead Center for follow-up. On success the visitor is handed a
 * quote-lead deep link that pre-fills the Charter Business Portal.
 */
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ArrowRight, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import {
  composeLeadMessage, emptyLead, leadBlockers, leadHeadline, portalDeepLink, type CharterLead,
} from "@/lib/charter/charterLeads";
import { CHARTER_COLLECTIONS, recommendCharter } from "@/lib/charter/charterCollections";
import { APPROVER_TITLES } from "@/lib/charter/corporateApproval";
import { portalEntryHref } from "@/lib/charter/portalRoutes";
import { trackPortalLoginRedirect } from "@/lib/charter/portalAnalytics";

const MISSION_TYPES = [
  "Corporate conference or convention",
  "Executive / board movement",
  "Staff shuttle programme",
  "Government or diplomatic protocol",
  "Tourism or safari circuit",
  "School or university excursion",
  "Airport and hotel transfers",
  "Event or ceremony transport",
];

const STEPS = ["Mission", "Route & schedule", "Procurement contact"];

const money = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

interface Props {
  categorySlug: string;
  categoryLabel: string;
  defaultCollection?: string;
}

export function CharterLeadForm({ categorySlug, categoryLabel, defaultCollection = "executive" }: Props) {
  const [lead, setLead] = useState<CharterLead>(() => emptyLead(categorySlug, defaultCollection));
  const [step, setStep] = useState(1);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedLink, setSubmittedLink] = useState<string | null>(null);
  const mountedAt = useRef(Date.now());
  const honeypot = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  /**
   * Signed-out visitors are corporate buyers, not platform admins: send them to
   * the corporate login surface with the pre-filled portal deep link preserved
   * as the post-login destination (never the admin /auth portal).
   */
  const continueHref = (portalLink: string) => portalEntryHref(portalLink, !!user);
  const trackContinue = (portalLink: string) => () => {
    if (!user) trackPortalLoginRedirect("lead_form_continue", portalLink);
  };

  const set = <K extends keyof CharterLead>(key: K, value: CharterLead[K]) =>
    setLead((prev) => ({ ...prev, [key]: value }));

  const stepErrors = useMemo(() => leadBlockers(lead, step), [lead, step]);
  const allErrors = useMemo(() => leadBlockers(lead), [lead]);
  const err = (field: string) => (attempted ? stepErrors[field] : undefined);

  const recommendation = useMemo(
    () => (lead.passengers > 0 ? recommendCharter({ passengers: lead.passengers, days: lead.days, intent: `${lead.missionType} ${lead.collection}` }) : null),
    [lead.passengers, lead.days, lead.missionType, lead.collection],
  );

  const next = () => {
    setAttempted(true);
    if (Object.keys(stepErrors).length > 0) return;
    setAttempted(false);
    setStep((s) => Math.min(STEPS.length, s + 1));
  };

  const submit = async () => {
    setAttempted(true);
    if (Object.keys(allErrors).length > 0) {
      toast({ title: "A few details are still missing", description: Object.values(allErrors)[0], variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("contact-submission", {
        body: {
          name: lead.name,
          email: lead.email,
          phone: lead.phone || undefined,
          company: lead.company,
          type: "sales",
          subject: `Charter enquiry — ${lead.missionType} (${lead.origin} → ${lead.destination})`,
          message: composeLeadMessage(lead),
          source_page: `/charter/${categorySlug}`,
          elapsed_ms: Date.now() - mountedAt.current,
          website: honeypot.current?.value ?? "",
        },
      });
      const code = (data as { error?: string } | null)?.error;
      if (error || code) {
        toast({
          title: code === "rate_limited" ? "Too many enquiries" : "Could not send the enquiry",
          description: code === "rate_limited" ? "Please try again in a few minutes." : "Please try again in a moment.",
          variant: "destructive",
        });
        return;
      }
      setSubmittedLink(portalDeepLink(lead));
      toast({ title: "Enquiry received", description: "A charter specialist responds within one business day." });
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedLink) {
    return (
      <div className="rounded-3xl border border-border/60 bg-card/70 p-8 text-center shadow-elegant backdrop-blur-xl">
        <CheckCircle2 className="mx-auto mb-4 h-11 w-11 text-status-success" aria-hidden="true" />
        <h3 className="text-xl font-semibold">Your mission is logged.</h3>
        <p className="mt-2 text-sm text-muted-foreground">{leadHeadline(lead)}</p>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          A dedicated mobility consultant is preparing your formal quotation. You can continue straight into the
          charter portal — the mission, sector details and procurement contact are already pre-filled.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link to={continueHref(submittedLink)} onClick={trackContinue(submittedLink)}>Continue in the charter portal<ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
          <Button
            variant="ghost"
            onClick={() => { setSubmittedLink(null); setStep(1); setLead(emptyLead(categorySlug, defaultCollection)); }}
          >
            Plan another journey
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-border/60 bg-card/70 p-6 shadow-elegant backdrop-blur-xl md:p-8">
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="charter-hp">Website</label>
        <input id="charter-hp" ref={honeypot} type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Plan my journey</p>
          <h3 className="mt-1 text-xl font-semibold">{categoryLabel} enquiry</h3>
        </div>
        <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
          Step {step} of {STEPS.length}
        </Badge>
      </div>

      <ol className="mt-4 flex gap-2" aria-label="Enquiry progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <div className={`h-1.5 rounded-full ${i < step ? "bg-primary" : "bg-muted"}`} />
            <span className={`mt-2 block text-[11px] ${i + 1 === step ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              {label}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-6 space-y-5">
        {step === 1 && (
          <>
            <div>
              <Label htmlFor="lead-mission">What does this journey need to achieve?</Label>
              <Select value={lead.missionType} onValueChange={(v) => set("missionType", v)}>
                <SelectTrigger id="lead-mission" className="mt-2" aria-invalid={!!err("missionType")}>
                  <SelectValue placeholder="Select the mission" />
                </SelectTrigger>
                <SelectContent>
                  {MISSION_TYPES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              {err("missionType") && <p className="mt-1 text-xs text-destructive">{err("missionType")}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="lead-pax">Travellers</Label>
                <Input
                  id="lead-pax" type="number" min={1} className="mt-2"
                  value={lead.passengers || ""}
                  onChange={(e) => set("passengers", Number(e.target.value) || 0)}
                  aria-invalid={!!err("passengers")}
                  placeholder="48"
                />
                {err("passengers") && <p className="mt-1 text-xs text-destructive">{err("passengers")}</p>}
              </div>
              <div>
                <Label htmlFor="lead-collection">Experience collection</Label>
                <Select value={lead.collection} onValueChange={(v) => set("collection", v)}>
                  <SelectTrigger id="lead-collection" className="mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CHARTER_COLLECTIONS.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {recommendation && (
              <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Recommended for you
                </p>
                <p className="mt-2 text-sm font-semibold">
                  {recommendation.vehicle.label} {recommendation.vehicle.seats}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{recommendation.reason}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Indicative {money(recommendation.indicativeFromKes)} – {money(recommendation.indicativeToKes)} for {recommendation.days} day
                  {recommendation.days > 1 ? "s" : ""}.
                </p>
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="lead-from">Pickup city or venue</Label>
                <Input id="lead-from" className="mt-2" value={lead.origin} onChange={(e) => set("origin", e.target.value)} aria-invalid={!!err("origin")} placeholder="Nairobi CBD" />
                {err("origin") && <p className="mt-1 text-xs text-destructive">{err("origin")}</p>}
              </div>
              <div>
                <Label htmlFor="lead-to">Destination</Label>
                <Input id="lead-to" className="mt-2" value={lead.destination} onChange={(e) => set("destination", e.target.value)} aria-invalid={!!err("destination")} placeholder="Naivasha" />
                {err("destination") && <p className="mt-1 text-xs text-destructive">{err("destination")}</p>}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="lead-date">Departure date</Label>
                <Input id="lead-date" type="date" className="mt-2" value={lead.startDate} onChange={(e) => set("startDate", e.target.value)} aria-invalid={!!err("startDate")} />
                {err("startDate") && <p className="mt-1 text-xs text-destructive">{err("startDate")}</p>}
              </div>
              <div>
                <Label htmlFor="lead-time">Preferred time</Label>
                <Input id="lead-time" type="time" className="mt-2" value={lead.departureTime} onChange={(e) => set("departureTime", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="lead-days">Operating days</Label>
                <Input id="lead-days" type="number" min={1} className="mt-2" value={lead.days || ""} onChange={(e) => set("days", Number(e.target.value) || 0)} aria-invalid={!!err("days")} />
                {err("days") && <p className="mt-1 text-xs text-destructive">{err("days")}</p>}
              </div>
            </div>
            <div>
              <Label htmlFor="lead-budget">Indicative budget (KES, optional)</Label>
              <Input id="lead-budget" type="number" min={0} className="mt-2" value={lead.budgetKes || ""} onChange={(e) => set("budgetKes", Number(e.target.value) || 0)} placeholder="450000" />
            </div>
            <div>
              <Label htmlFor="lead-notes">Special requirements or concierge requests</Label>
              <Textarea
                id="lead-notes" rows={3} className="mt-2"
                value={lead.requirements}
                onChange={(e) => set("requirements", e.target.value)}
                placeholder="Onboard Wi-Fi, branded livery, hostess, protocol escort, refreshments…"
              />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="lead-name">Full name</Label>
                <Input id="lead-name" autoComplete="name" className="mt-2" value={lead.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!err("name")} />
                {err("name") && <p className="mt-1 text-xs text-destructive">{err("name")}</p>}
              </div>
              <div>
                <Label htmlFor="lead-email">Work email</Label>
                <Input id="lead-email" type="email" autoComplete="email" className="mt-2" value={lead.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!err("email")} />
                {err("email") && <p className="mt-1 text-xs text-destructive">{err("email")}</p>}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="lead-org">Organisation</Label>
                <Input id="lead-org" autoComplete="organization" className="mt-2" value={lead.company} onChange={(e) => set("company", e.target.value)} aria-invalid={!!err("company")} />
                {err("company") && <p className="mt-1 text-xs text-destructive">{err("company")}</p>}
              </div>
              <div>
                <Label htmlFor="lead-phone">Phone</Label>
                <Input id="lead-phone" type="tel" autoComplete="tel" className="mt-2" value={lead.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="lead-cc">Cost centre (optional)</Label>
                <Input id="lead-cc" className="mt-2" value={lead.costCenter} onChange={(e) => set("costCenter", e.target.value)} placeholder="OPS-2026" />
              </div>
              <div>
                <Label htmlFor="lead-title">Approving authority title (optional)</Label>
                <Select value={lead.approverTitle} onValueChange={(v) => set("approverTitle", v)}>
                  <SelectTrigger id="lead-title" className="mt-2"><SelectValue placeholder="Select a title" /></SelectTrigger>
                  <SelectContent>
                    {APPROVER_TITLES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              We use these procurement details to pre-configure your portal workspace. By submitting you agree to our{" "}
              <a href="/legal/privacy" className="underline">Privacy Policy</a>.
            </p>
          </>
        )}
      </div>

      {attempted && Object.keys(stepErrors).length > 0 && (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {Object.values(stepErrors)[0]}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {step > 1 && (
          <Button variant="ghost" onClick={() => { setAttempted(false); setStep((s) => s - 1); }}>Back</Button>
        )}
        {step < STEPS.length ? (
          <Button size="lg" onClick={next}>Continue<ArrowRight className="ml-2 h-4 w-4" /></Button>
        ) : (
          <Button size="lg" onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Request my quotation
          </Button>
        )}
      </div>
    </div>
  );
}

export default CharterLeadForm;
