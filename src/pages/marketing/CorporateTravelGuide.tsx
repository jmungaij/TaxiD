import MarketingLayout from "@/components/marketing/MarketingLayout";
import { SeoHead } from "@/components/seo/SeoHead";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const PATH = "/blog/corporate-travel-management-guide";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Corporate Travel Management: The Complete Guide to Mobility Policy in Africa",
  description:
    "How to build a corporate travel and mobility policy that automates governance, controls spend, and works in markets like Kenya with M-Pesa and dual-wallet architectures.",
  author: { "@type": "Organization", name: "Yalla Mobility" },
  publisher: { "@type": "Organization", name: "Yalla Mobility" },
  mainEntityOfPage: `https://yalla-africa.lovable.app${PATH}`,
  datePublished: "2026-06-17",
};

const sections = [
  { id: "what-is", title: "What is corporate travel management?" },
  { id: "policy", title: "Building a corporate mobility policy" },
  { id: "automation", title: "Automating travel governance" },
  { id: "dual-wallet", title: "Dual-wallet architecture for corporate vs personal trips" },
  { id: "mpesa", title: "M-Pesa reconciliation for African corporates" },
  { id: "kpis", title: "KPIs every mobility manager should track" },
  { id: "checklist", title: "Implementation checklist" },
];

const CorporateTravelGuide = () => {
  return (
    <MarketingLayout>
      <SeoHead
        title="Corporate Travel Management Guide | Yalla Mobility"
        description="A practical guide to corporate travel management and mobility policy — automating governance, controlling spend, and reconciling M-Pesa for African enterprises."
        path={PATH}
        type="article"
        jsonLd={jsonLd}
      />

      <article className="mx-auto max-w-3xl px-4 py-16">
        <header className="mb-10">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Guide · Corporate Mobility</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">
            Corporate Travel Management: The Complete Guide to Mobility Policy
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            How modern finance and operations teams automate corporate travel governance,
            enforce policy at the point of booking, and reconcile every shilling — including
            what changes when you operate in markets that run on M-Pesa.
          </p>
        </header>

        <nav aria-label="Table of contents" className="mb-12 rounded-lg border bg-card p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">On this page</h2>
          <ol className="space-y-1 text-sm">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-primary hover:underline">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <section id="what-is" className="prose prose-slate mb-12 max-w-none dark:prose-invert">
          <h2>1. What is corporate travel management?</h2>
          <p>
            Corporate travel management is the discipline of planning, booking, paying for,
            and reporting on every business trip an employee takes — whether that's a 15-minute
            ride to a client meeting in Nairobi or a multi-day trip across borders. Done well,
            it turns travel from an opaque expense line into a controllable, auditable program.
          </p>
          <p>
            The old model — employees pay out of pocket, submit receipts weeks later, finance
            reconciles by hand — leaks money at every step. Modern programs replace it with a
            policy engine that runs at the moment of booking and a settlement layer that closes
            the loop automatically.
          </p>
        </section>

        <section id="policy" className="prose prose-slate mb-12 max-w-none dark:prose-invert">
          <h2>2. Building a corporate mobility policy</h2>
          <p>A workable mobility policy answers five questions in plain language:</p>
          <ul>
            <li><strong>Who can book?</strong> Which employees, contractors, or guests.</li>
            <li><strong>What can they book?</strong> Ride class, vehicle type, geographic limits.</li>
            <li><strong>When?</strong> Business hours, blackout windows, advance approval thresholds.</li>
            <li><strong>How much?</strong> Per-trip caps, monthly caps, project budgets, cost centers.</li>
            <li><strong>What needs approval?</strong> Auto-approve under a threshold, route the rest to a manager.</li>
          </ul>
          <p>
            Write it once, encode it once. If the policy lives in a PDF nobody opens, it is not a
            policy — it is a wish.
          </p>
        </section>

        <section id="automation" className="prose prose-slate mb-12 max-w-none dark:prose-invert">
          <h2>3. Automating travel governance</h2>
          <p>
            Governance is what stops the policy from being theoretical. The four primitives every
            corporate mobility platform should provide:
          </p>
          <ol>
            <li><strong>Pre-trip controls.</strong> Block out-of-policy bookings before they happen.</li>
            <li><strong>In-trip visibility.</strong> Live trip status, GPS, and ETA for safety and duty of care.</li>
            <li><strong>Post-trip reconciliation.</strong> Every receipt mapped to a cost center, project, or client billable.</li>
            <li><strong>Audit trail.</strong> Immutable record of who booked what, who approved it, what the policy said at the time.</li>
          </ol>
        </section>

        <section id="dual-wallet" className="prose prose-slate mb-12 max-w-none dark:prose-invert">
          <h2>4. Dual-wallet architecture for corporate vs personal trips</h2>
          <p>
            The biggest unforced error in corporate ride programs is forcing employees to choose
            between a personal app and a corporate one. They pick the personal one, expense it
            later, and finance ends up doing manual matching.
          </p>
          <p>
            A <strong>dual-wallet</strong> architecture solves this. One employee account, two
            payment sources:
          </p>
          <ul>
            <li><strong>Corporate wallet</strong> — funded by the employer, gated by policy, used for trips tagged as business.</li>
            <li><strong>Personal wallet</strong> — funded by the employee (M-Pesa, card), used for trips tagged as personal.</li>
          </ul>
          <p>
            At booking time the rider picks a <em>trip intent</em> — Business or Personal — and
            the platform routes the charge to the right wallet. The corporate wallet enforces the
            policy engine; the personal wallet behaves like any consumer ride. Finance never sees
            personal trips. The employee never has to submit a receipt.
          </p>
        </section>

        <section id="mpesa" className="prose prose-slate mb-12 max-w-none dark:prose-invert">
          <h2>5. M-Pesa reconciliation for African corporates</h2>
          <p>
            In Kenya and across East Africa, M-Pesa is the dominant payment rail. Any corporate
            travel platform that treats it as an afterthought will fail reconciliation by the end
            of the first month. A robust approach has three parts:
          </p>
          <ul>
            <li>
              <strong>Top-up via Paybill.</strong> Corporates fund the corporate wallet by paying
              a Paybill number with their company account number as the reference. The platform
              ingests Daraja callbacks and credits the wallet in near real time.
            </li>
            <li>
              <strong>Settlement with idempotency.</strong> Every Daraja callback is keyed by the
              M-Pesa transaction ID so retries cannot double-credit. Failed callbacks are queued
              and reconciled against the M-Pesa statement nightly.
            </li>
            <li>
              <strong>KRA-ready invoicing.</strong> Corporate invoices include the KRA PIN,
              eTIMS-compliant tax lines, and a clear breakdown of each trip — so the finance team
              can file VAT without re-keying anything.
            </li>
          </ul>
          <p>
            This is the layer most global travel platforms skip. It is also the layer that decides
            whether your CFO trusts the program in month two.
          </p>
        </section>

        <section id="kpis" className="prose prose-slate mb-12 max-w-none dark:prose-invert">
          <h2>6. KPIs every mobility manager should track</h2>
          <ul>
            <li><strong>Policy compliance rate</strong> — % of trips inside policy at booking time.</li>
            <li><strong>Auto-approval rate</strong> — % of trips that never needed a human approver.</li>
            <li><strong>Cost per trip by cost center</strong> — to spot drift early.</li>
            <li><strong>Reconciliation lag</strong> — hours between trip completion and a posted journal entry.</li>
            <li><strong>Duty-of-care coverage</strong> — % of trips with live GPS and emergency contact attached.</li>
          </ul>
        </section>

        <section id="checklist" className="prose prose-slate mb-12 max-w-none dark:prose-invert">
          <h2>7. Implementation checklist</h2>
          <ol>
            <li>Document the five policy questions above. Get sign-off from finance and HR.</li>
            <li>Define cost centers and budget caps per department.</li>
            <li>Enable the dual-wallet split so personal trips never enter the corporate ledger.</li>
            <li>Wire up M-Pesa Paybill top-ups and Daraja callbacks with idempotency keys.</li>
            <li>Turn on pre-trip policy enforcement and approval routing.</li>
            <li>Publish a live dashboard for the mobility manager and the CFO.</li>
            <li>Review the policy quarterly against actual usage.</li>
          </ol>
        </section>

        <aside className="mt-16 rounded-xl border bg-card p-8 text-center">
          <h2 className="text-2xl font-semibold">See it working on your corporate account</h2>
          <p className="mt-2 text-muted-foreground">
            Yalla Mobility ships dual wallets, M-Pesa Paybill reconciliation, KRA-ready invoicing,
            and pre-trip policy controls out of the box.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link to="/corporates">Explore Corporate features</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/contact">Talk to sales</Link>
            </Button>
          </div>
        </aside>
      </article>
    </MarketingLayout>
  );
};

export default CorporateTravelGuide;
