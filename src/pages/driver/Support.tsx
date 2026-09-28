import { Link } from "react-router-dom";
import { Mail, Phone, MessageSquare, BookOpen, Headphones, ArrowRight } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";

export default function DriverSupport() {
  return (
    <MarketingPage>
      <PageHero eyebrow="Driver Support" title="Help, whenever you need it"
        subtitle="In-app chat, phone support and a help centre staffed by people who know the platform inside out.">
        <Button asChild size="lg" className="bg-ice text-primary hover:bg-ice/90">
          <Link to="/dashboard/driver/support">Open in-app support <ArrowRight className="ml-2 h-4 w-4" /></Link>
        </Button>
      </PageHero>

      <section className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-3 gap-5 mb-12">
          {[
            { i: MessageSquare, t: "In-app chat",   d: "Average first response under 2 minutes.", cta: "Open chat",   href: "/dashboard/driver/support" },
            { i: Phone,         t: "Phone support", d: "+254 142 970050 · 24/7 driver hotline.",  cta: "Call now",    href: "tel:+254142970050" },
            { i: Mail,          t: "Email",         d: "support@taxid.us · replies under 4 hours.", cta: "Email us", href: "mailto:support@taxid.us" },
          ].map((c) => (
            <div key={c.t} className="p-6 rounded-xl bg-card border border-border">
              <c.i className="h-7 w-7 text-primary mb-3" />
              <h3 className="font-semibold mb-1">{c.t}</h3>
              <p className="text-sm text-muted-foreground mb-4">{c.d}</p>
              <Button asChild variant="outline" size="sm"><a href={c.href}>{c.cta}</a></Button>
            </div>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          <div className="p-6 rounded-xl bg-card border border-border">
            <BookOpen className="h-7 w-7 text-primary mb-3" />
            <h3 className="font-semibold mb-2">Help Center & FAQ</h3>
            <p className="text-sm text-muted-foreground mb-4">Search hundreds of articles on payouts, tax, ratings and more.</p>
            <Button asChild variant="outline"><Link to="/faq">Open Help Center</Link></Button>
          </div>
          <div className="p-6 rounded-xl bg-card border border-border">
            <Headphones className="h-7 w-7 text-primary mb-3" />
            <h3 className="font-semibold mb-2">Driver community</h3>
            <p className="text-sm text-muted-foreground mb-4">Join WhatsApp communities and in-person Driver Hub meetups in every city.</p>
            <Button asChild variant="outline"><Link to="/contact">Get the invite</Link></Button>
          </div>
        </div>
      </section>
    </MarketingPage>
  );
}
