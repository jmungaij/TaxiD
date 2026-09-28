import { Link } from "react-router-dom";
import { Headphones, MessageSquare, Phone, Shield, Activity, Lock, BookOpen, LifeBuoy } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { ContactForm } from "@/components/marketing/ContactForm";
import { SeoHead } from "@/components/seo/SeoHead";

const channels = [
  { icon: MessageSquare, title: "24/7 in-app chat", desc: "Tap Help inside the TaxiD app. Average first-response under 90 seconds." },
  { icon: Phone, title: "Phone support", desc: "Call our safety line for any active trip or emergency — answered immediately." },
  { icon: Headphones, title: "Enterprise CSM", desc: "Corporate, fleet and partner accounts get a named CSM and shared Slack/Teams channel." },
  { icon: BookOpen, title: "Help center", desc: "Self-serve guides for riders, drivers, corporates, and developers." },
];

const trust = [
  { icon: Shield, title: "Security Center", desc: "Verify a domain, report phishing, review controls.", to: "/security-center" },
  { icon: Activity, title: "Status page", desc: "Live platform health and incident history.", to: "/security-center" },
  { icon: Lock, title: "Privacy & data rights", desc: "Your data, your rights, our policies.", to: "/legal/privacy" },
];

export default function Support() {
  return (
    <MarketingPage>
      <SeoHead
        title="Support & help center | TaxiD"
        description="24/7 in-app chat, phone support for active trips, enterprise CSMs, and a self-serve help center. Contact the TaxiD support team."
        path="/support"
      />
      <PageHero
        eyebrow="Support"
        title="Help, exactly when you need it"
        subtitle="Safety-first support for riders and drivers, dedicated CSMs for corporate and fleet partners, and a help center that answers most questions in seconds."
      >
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="bg-ice text-primary hover:bg-ice/90">
            <a href="#contact">Contact support</a>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-ice/70 text-ice hover:bg-ice/20">
            <Link to="/security-center">Security center</Link>
          </Button>
        </div>
      </PageHero>

      <section>
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-3xl mb-10">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Channels</span>
            <h2 className="text-3xl font-bold mt-2 mb-3">How to reach us</h2>
            <p className="text-muted-foreground text-lg">Pick the channel that matches your urgency.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {channels.map((c) => (
              <div key={c.title} className="p-6 rounded-xl bg-card border border-border">
                <c.icon className="h-7 w-7 text-primary mb-3" />
                <h3 className="font-semibold mb-2">{c.title}</h3>
                <p className="text-sm text-muted-foreground">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-secondary/30">
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-3xl mb-10">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Trust resources</span>
            <h2 className="text-3xl font-bold mt-2 mb-3">Need security or compliance information?</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {trust.map((t) => (
              <Link key={t.title} to={t.to} className="p-6 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors group">
                <t.icon className="h-7 w-7 text-primary mb-3" />
                <h3 className="font-semibold mb-2 group-hover:text-primary">{t.title}</h3>
                <p className="text-sm text-muted-foreground">{t.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="contact">
        <div className="container mx-auto px-4 py-16 grid lg:grid-cols-2 gap-10">
          <div>
            <LifeBuoy className="h-10 w-10 text-primary mb-4" />
            <h2 className="text-3xl font-bold mb-3">Send us a message</h2>
            <p className="text-muted-foreground mb-6">
              Not an emergency? Use the form and we'll route you to the right team. Include trip IDs, order numbers, or screenshots where you can.
            </p>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Safety emergency:</strong> use SOS inside the app — connected to our safety center in under 60 seconds.</p>
              <p><strong className="text-foreground">Lost item:</strong> message us with the trip ID; we contact the driver on your behalf.</p>
              <p><strong className="text-foreground">Press & media:</strong> support@taxid.us</p>
            </div>
          </div>
          <ContactForm
            type="support"
            sourcePage="/support"
            submitLabel="Send to support"
            heading="Contact the team"
            subheading="We respond within one business day. For safety issues, use the in-app SOS."
          />
        </div>
      </section>
    </MarketingPage>
  );
}
