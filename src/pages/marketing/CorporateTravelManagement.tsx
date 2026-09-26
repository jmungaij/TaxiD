/**
 * Corporate travel management (Kenya) — search landing page.
 *
 * Targets Kenyan corporate travel management demand. Every claim on this page
 * describes a capability that exists in the product today (policy limits,
 * approval routing, cost centres, eTIMS tax invoices, tenant-separated records);
 * no certifications, client names or performance figures are asserted here.
 * CTAs route into the live corporate registration and contact desk.
 */
import { Link } from "react-router-dom";
import {
  ArrowRight, Building2, ClipboardCheck, CreditCard, FileSpreadsheet,
  Layers, Plane, Receipt, Send, ShieldCheck, Users, Wallet,
} from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CrossLinks } from "@/components/marketing/CrossLinks";
import { ContactForm } from "@/components/marketing/ContactForm";
import { SeoHead } from "@/components/seo/SeoHead";
const SITE_URL = "https://yalla-africa.lovable.app";

const PATH = "/corporate-travel-management";

const capabilities = [
  { icon: ClipboardCheck, t: "Travel policy you set", d: "Spend limits, permitted trip types, travel hours and vehicle classes are recorded as versioned rules — every booking is checked against the version in force." },
  { icon: Users, t: "Approval routing", d: "Bookings above a limit go to the named approver. Approvals, declines and reasons are recorded against the trip." },
  { icon: Layers, t: "Cost centres and departments", d: "Every journey carries a department, cost centre and trip reason, so month-end reporting matches your chart of accounts." },
  { icon: Wallet, t: "Budgets and credit control", d: "Company budgets with credit limit, outstanding and available balance. A booking beyond the available balance is held, not silently approved." },
  { icon: Receipt, t: "eTIMS tax invoices", d: "Kenyan tax invoices for corporate travel, issued against your KRA PIN and reconciled to payments." },
  { icon: ShieldCheck, t: "Separated company records", d: "Your organisation's staff, trips and invoices are separated from every other organisation and enforced in the database, not just in the app." },
];

const useCases = [
  { icon: Users, t: "Staff transport", d: "Daily and shift movement for teams, with manifests per route." },
  { icon: Plane, t: "Airport transfers", d: "Arrival and departure transfers booked against a cost centre." },
  { icon: Building2, t: "Executive travel", d: "Chauffeured travel for leadership, approved inside your rules." },
  { icon: CreditCard, t: "Guest and client travel", d: "Move visitors and clients on the company account, not petty cash." },
];

const steps = [
  { t: "Open a corporate account", d: "Register your organisation with its certificate, KRA PIN and letter of authority." },
  { t: "Wait for verification", d: "A Yalla manager reviews the documents. The account is created only once it is approved." },
  { t: "Set your rules", d: "Spend limits, approvers, departments, cost centres and sign-in settings." },
  { t: "Add your people", d: "Invite staff, assign departments and approvers." },
  { t: "Book, approve, report", d: "Staff book, approvers decide, finance reconciles from one statement." },
];

export default function CorporateTravelManagement() {
  return (
    <MarketingPage>
      <SeoHead
        title="Corporate Travel Management in Kenya | Yalla"
        description="Manage corporate travel in Kenya on one account: travel policy limits, approval routing, cost centres, budgets and eTIMS tax invoices for staff, executive and airport travel."
        path={PATH}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: "Corporate travel management",
          serviceType: "Corporate travel management",
          areaServed: { "@type": "Country", name: "Kenya" },
          provider: { "@type": "Organization", name: "Yalla Mobility", url: SITE_URL },
          description:
            "Corporate travel management for organisations in Kenya: policy limits, approval routing, cost centres, budgets and eTIMS tax invoices.",
          url: `${SITE_URL}${PATH}`,
        }}
      />

      <PageHero
        eyebrow="Corporate travel management"
        title="Corporate travel management for organisations in Kenya"
        subtitle="One company account for staff transport, executive travel and airport transfers — with your own spend limits, approvers, cost centres and Kenyan tax invoices."
      >
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" variant="secondary">
            <Link to="/corporate/register/personal">Open a corporate account</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="bg-transparent">
            <a href="#corporate-travel-enquiry">Talk to the corporate desk</a>
          </Button>
        </div>
      </PageHero>

      <section className="container mx-auto px-4 py-16">
        <h2 className="text-2xl md:text-3xl font-bold mb-3">What you control</h2>
        <p className="text-muted-foreground max-w-2xl mb-8">
          Corporate travel goes wrong at the edges: a trip outside policy, a missing cost centre, an
          invoice finance cannot reconcile. These are the controls that close those gaps.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map(({ icon: Icon, t, d }) => (
            <Card key={t} className="p-6">
              <Icon className="h-6 w-6 text-primary mb-3" aria-hidden />
              <h3 className="font-semibold mb-1">{t}</h3>
              <p className="text-sm text-muted-foreground">{d}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-muted/40 py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold mb-8">The travel your teams actually book</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {useCases.map(({ icon: Icon, t, d }) => (
              <Card key={t} className="p-6">
                <Icon className="h-6 w-6 text-primary mb-3" aria-hidden />
                <h3 className="font-semibold mb-1">{t}</h3>
                <p className="text-sm text-muted-foreground">{d}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16">
        <h2 className="text-2xl md:text-3xl font-bold mb-8">How an organisation gets started</h2>
        <ol className="grid gap-4 md:grid-cols-5">
          {steps.map((s, i) => (
            <li key={s.t} className="rounded-xl border border-border bg-card p-5">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {i + 1}
              </div>
              <h3 className="font-semibold mb-1">{s.t}</h3>
              <p className="text-sm text-muted-foreground">{s.d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/corporate/register/personal">
              Start your corporate registration <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/riders/corporate">See employee mobility solutions</Link>
          </Button>
        </div>
      </section>

      <section id="book-a-corporate-trip" className="bg-muted/40 py-16">
        <div className="container mx-auto max-w-4xl px-4">
          <div className="mb-6 flex items-start gap-3">
            <Send className="mt-1 h-6 w-6 text-primary" aria-hidden />
            <div>
              <h2 className="text-2xl md:text-3xl font-bold">Book a corporate trip</h2>
              <p className="text-muted-foreground">
                Already on a company account? Request a trip against your department and cost centre.
                Your organisation's rules decide the outcome: within your limits it is booked, above
                them it goes to your approver first, and beyond your available credit it is held.
              </p>
            </div>
          </div>
          <ol className="mb-6 grid gap-4 sm:grid-cols-4">
            {[
              { t: "Request", d: "Pick-up, drop-off, time, purpose and cost centre." },
              { t: "Decision", d: "Checked against your rules and available credit." },
              { t: "Driver assigned", d: "Dispatch assigns a driver and confirms the booking." },
              { t: "Pick-up", d: "The trip appears on your dashboard until it completes." },
            ].map((s, i) => (
              <li key={s.t} className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {i + 1}
                </div>
                <h3 className="text-sm font-semibold">{s.t}</h3>
                <p className="text-xs text-muted-foreground">{s.d}</p>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/dashboard/corporate/trips/request">
                Request a corporate trip <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/auth?redirect=%2Fdashboard%2Fcorporate%2Ftrips%2Frequest">
                Sign in to your company account
              </Link>
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Trip requests are only available to people on an approved company account. If your
            organisation is not registered yet, open a corporate account first.
          </p>
        </div>
      </section>

      <section id="corporate-travel-enquiry" className="bg-muted/40 py-16">
        <div className="container mx-auto max-w-3xl px-4">
          <div className="mb-6 flex items-start gap-3">
            <FileSpreadsheet className="mt-1 h-6 w-6 text-primary" aria-hidden />
            <div>
              <h2 className="text-2xl md:text-3xl font-bold">Tell us how your organisation travels</h2>
              <p className="text-muted-foreground">
                Send your travel pattern — routes, monthly volume and who approves — and the corporate
                desk will come back with a written proposal.
              </p>
            </div>
          </div>
          <ContactForm
            type="sales"
            sourcePage={PATH}
            showCompany
            showEmployeeCount
            submitLabel="Send corporate enquiry"
          />
        </div>
      </section>

      <CrossLinks
        heading="Related solutions"
        keys={["corporates", "rentals", "delivery", "enterprise", "pricing", "support"]}
      />
    </MarketingPage>
  );
}
