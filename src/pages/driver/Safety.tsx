import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Siren, ShieldCheck, Activity, Phone, Heart, Umbrella, ArrowRight } from "lucide-react";
import { SeoHead } from "@/components/seo/SeoHead";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { trackDriverEvent } from "@/lib/driverAnalytics";

export default function DriverSafety() {
  const { toast } = useToast();
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function triggerSOS() {
    const text = details.trim().slice(0, 1000);
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Sign in so we can route your SOS to the right responder.",
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }
    const { error } = await supabase.from("safety_events").insert({
      driver_id: user.id,
      event_type: "SOS",
      severity: "CRITICAL",
      details: { message: text || null, source: "driver_safety_page" },
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "Could not log SOS", description: error.message, variant: "destructive" });
      return;
    }
    trackDriverEvent("sos_triggered", { funnel_stage: "active_driver" });
    toast({ title: "SOS logged", description: "Our safety team has been notified and will contact you immediately." });
    setDetails("");
  }

  return (
    <MarketingPage>
      <SeoHead
        title="Driver Safety & SOS Support | Yalla Mobility"
        description="Yalla Mobility driver safety: one-tap SOS, 24/7 safety centre response, trip monitoring, insurance options and incident escalation for Kenyan drivers."
        path="/driver/safety"
      />
      <PageHero eyebrow="Safety Command Center" title="You drive. We have your back."
        subtitle="24/7 ops, in-app SOS, trip monitoring, and an independent safety board reviewing every serious incident.">
        <Button asChild size="lg" className="bg-ice text-primary hover:bg-ice/90">
          <Link to="/driver/onboarding">Become a Yalla driver <ArrowRight className="ml-2 h-4 w-4" /></Link>
        </Button>
      </PageHero>

      <section className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            { i: Siren,       t: "24/7 Emergency Support", d: "Live safety ops team on-call every second of every day." },
            { i: ShieldCheck, t: "SOS Button",             d: "One-tap escalation routed to the closest responder partner." },
            { i: Activity,    t: "Trip Monitoring",        d: "Anomaly detection on route, speed and geofence in real time." },
            { i: Phone,       t: "Incident Reporting",     d: "Structured incident reports with evidence attachments." },
            { i: Umbrella,    t: "Insurance Assistance",   d: "In-trip insurance + post-incident claim coordination." },
            { i: Heart,       t: "Driver Protection",      d: "Independent safety board reviews every serious incident." },
          ].map((c) => (
            <div key={c.t} className="p-6 rounded-xl bg-card border border-border hover:shadow-lg transition-shadow">
              <c.i className="h-7 w-7 text-primary mb-3" />
              <h3 className="font-semibold mb-2">{c.t}</h3>
              <p className="text-sm text-muted-foreground">{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-secondary/40 py-16">
        <div className="container mx-auto px-4 max-w-2xl">
          <div className="p-8 rounded-2xl bg-card border border-status-danger/30 dark:border-status-danger/30 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-full bg-status-danger/10 dark:bg-status-danger flex items-center justify-center">
                <Siren className="h-6 w-6 text-status-danger" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Emergency SOS</h2>
                <p className="text-sm text-muted-foreground">Logs an immediate alert to the Yalla safety ops team.</p>
              </div>
            </div>
            <Label htmlFor="sos-details">What's happening? (optional)</Label>
            <Textarea
              id="sos-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Brief description so responders can help faster…"
              maxLength={1000}
              rows={4}
              className="mt-1.5 mb-4"
            />
            <Button
              onClick={triggerSOS}
              disabled={submitting}
              className="w-full bg-status-danger hover:bg-status-danger text-ice"
              size="lg"
            >
              <Siren className="h-5 w-5 mr-2" /> {submitting ? "Sending…" : "Trigger SOS now"}
            </Button>
            <p className="text-xs text-muted-foreground mt-3 text-center">
              For life-threatening emergencies always also call <a className="underline" href="tel:999">999</a> or local emergency services.
            </p>
          </div>
        </div>
      </section>
    </MarketingPage>
  );
}
