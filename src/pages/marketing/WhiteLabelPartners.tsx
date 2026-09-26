/**
 * SAFARID WHITE-LABEL PARTNERS — enterprise white-label mobility platform.
 *
 * Every statement on this page is rendered from the canonical contract in
 * `src/lib/partners/whiteLabel.ts`, so marketing copy cannot claim a surface,
 * control, service level or commercial term the contract has not declared —
 * and anything not yet built renders with an explicit status badge.
 */
import { Link } from "react-router-dom";
import {
  ArrowRight, Boxes, Building2, CheckCircle2, FileCheck2, Gauge, KeyRound,
  Layers, Lock, Radio, ShieldCheck, Workflow,
} from "lucide-react";

import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { CONTACT, SALES_MAILTO } from "@/config/contact";
import {
  BRAND_IMMUTABLES, BRAND_SURFACES, CHANGE_CLASSES, CLAIM_MATRIX, COMMERCIAL_MODEL,
  CONTINUITY, DEVELOPER_RESOURCES, FINANCIAL_CHAIN, GOVERNANCE, HYPERCARE_SIGNALS,
  INCIDENT_PROCESS, LIFECYCLE, MARKETS, OPERATING_LOOP, ORDER_STATES, OWNER_LABEL,
  PERFORMANCE_METRICS, PRIVACY_CONTROLS, RESPONSIBILITY_MATRIX, ROLLBACK_TRIGGERS,
  ROLLOUT_STEPS, SECURITY_CONTROLS, SERVICE_CATALOGUE, SERVICE_LEVELS, STATUS_LABEL,
  STATUS_TONE, TENANT_MODEL, WHITE_LABEL_FAQ, type CapabilityStatus, type Owner,
} from "@/lib/partners/whiteLabel";

import {
  TENANT_HEADER, WHITE_LABEL_DOMAINS, currentWhiteLabelRelease,
} from "@/lib/partners/whiteLabelApi";

const SECTIONS = [
  ["what", "What white-label means"],
  ["architecture", "Platform architecture"],
  ["tenancy", "Multi-tenant model"],
  ["brand", "Brand configuration"],
  ["responsibility", "Who operates what"],
  ["services", "Services & markets"],
  ["journey", "Customer journey"],
  ["orders", "Canonical order model"],
  ["api", "API & integration"],
  ["security", "Security & privacy"],
  ["finance", "Money & settlement"],
  ["commercial", "Commercial model"],
  ["lifecycle", "Integration lifecycle"],
  ["golive", "Go-live & hypercare"],
  ["operations", "Operations & change"],
  ["performance", "Performance & governance"],
  ["claims", "Claim verification"],
  ["faq", "FAQ"],
] as const;

function StatusBadge({ status }: { status: CapabilityStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const OWNER_TONE: Record<Owner, string> = {
  PARTNER: "border-info/30 bg-info/10 text-info",
  SAFARID: "border-primary/30 bg-primary/10 text-primary",
  SHARED: "border-border bg-muted text-muted-foreground",
};

function OwnerBadge({ owner }: { owner: Owner }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${OWNER_TONE[owner]}`}>
      {OWNER_LABEL[owner]}
    </span>
  );
}

function Section({
  id, eyebrow, title, lead, children,
}: { id: string; eyebrow: string; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border py-16">
      <div className="container mx-auto max-w-6xl px-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
        <h2 className="mt-2 text-2xl font-bold md:text-3xl">{title}</h2>
        {lead && <p className="mt-3 max-w-3xl text-muted-foreground">{lead}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

/** Vertical architecture spine — real layers, not decoration. */
function ArchitectureSpine() {
  const layers = [
    { name: "Partner", detail: "Contracting legal entity" },
    { name: "Tenant", detail: "Brand, services, markets, environment" },
    { name: "Brand configuration", detail: "Identity applied to surfaces in scope" },
    { name: "Customer experience", detail: "Branded booking and tracking surfaces" },
    { name: "Booking / API", detail: "Quote, order, cancel, track — scoped credentials" },
    { name: "Canonical mobility order", detail: "One order record, one state machine" },
    { name: "Operations", detail: "Exception handling, support escalation" },
    { name: "Dispatch / fulfilment", detail: "Supply assignment and completion" },
    { name: "Payments", detail: "Capture on verified provider callback" },
    { name: "Settlement", detail: "Append-only ledger and sealed statements" },
    { name: "Reporting", detail: "Performance, usage and reconciliation" },
  ];
  const rails = ["Security", "Governance", "Data", "Support", "Observability", "Compliance"];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <ol className="relative space-y-2 border-l border-border pl-6">
        {layers.map((l, i) => (
          <li key={l.name} className="relative rounded-xl border border-border bg-card px-4 py-3">
            <span
              aria-hidden
              className="absolute -left-[31px] top-4 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground"
            >
              {i + 1}
            </span>
            <p className="text-sm font-semibold">{l.name}</p>
            <p className="text-xs text-muted-foreground">{l.detail}</p>
          </li>
        ))}
      </ol>
      <aside className="rounded-2xl border border-border bg-muted/30 p-5">
        <h3 className="text-sm font-semibold">Cross-cutting concerns</h3>
        <p className="mt-1 text-xs text-muted-foreground">Applied to every layer of the spine, not bolted on at the edge.</p>
        <ul className="mt-4 space-y-2">
          {rails.map((r) => (
            <li key={r} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              {r}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

const JOURNEY = [
  { step: "Discover", owner: "PARTNER" as Owner },
  { step: "Book", owner: "PARTNER" as Owner },
  { step: "Quote", owner: "SAFARID" as Owner },
  { step: "Confirm", owner: "SHARED" as Owner },
  { step: "Track", owner: "SAFARID" as Owner },
  { step: "Fulfil", owner: "SAFARID" as Owner },
  { step: "Pay", owner: "SAFARID" as Owner },
  { step: "Receive document", owner: "SAFARID" as Owner },
  { step: "Support", owner: "SHARED" as Owner },
  { step: "Settle", owner: "SAFARID" as Owner },
  { step: "Report", owner: "SHARED" as Owner },
];

export default function WhiteLabelPartners() {
  return (
    <MarketingPage>
      <SeoHead
        title="White-Label Partners | SAFARID"
        description="Launch and operate a branded mobility experience on SAFARID's mobility infrastructure: multi-tenant architecture, brand configuration, canonical orders, signed APIs, settlement and joint governance."
        path="/partners/white-label"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: "SAFARID White-Label Mobility Platform",
          serviceType: "White-label mobility infrastructure",
          provider: { "@type": "Organization", name: "SAFARID" },
          areaServed: "KE",
          description: "Branded mobility experiences operated on SAFARID's mobility infrastructure, with multi-tenant isolation, API integration, settlement and joint governance.",
        }}
      />

      <PageHero
        eyebrow="White-Label Partners"
        title="Your brand at the front, SAFARID's execution engine behind it"
        subtitle="Launch and operate a branded mobility experience without building the mobility infrastructure behind it — your brand, customer journey and commercial relationship, powered by SAFARID's operating platform, supply network and fulfilment capability."
      >
        <div className="flex flex-wrap gap-3">
          <AppButton size="lg" variant="secondary" analytics="white_label_hero_apply" action="navigate" target="/partners/apply?type=white-label">
            Apply to the programme <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
          </AppButton>
          <Button asChild size="lg" variant="outline" className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10">
            <Link to="/partners/api">API platform</Link>
          </Button>
        </div>
        <p className="mt-5 max-w-2xl text-sm text-primary-foreground/80">
          Every capability below carries an explicit status. Anything marked <strong>Roadmap</strong> is not
          available today, and anything marked <strong>Contractual</strong> exists in a signed agreement rather
          than in software configuration.
        </p>
      </PageHero>

      {/* In-page IA */}
      <nav aria-label="On this page" className="border-b border-border bg-muted/20">
        <div className="container mx-auto max-w-6xl px-4 py-4">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <Section
        id="what"
        eyebrow="Definition"
        title="What white-label means here"
        lead="The partner owns the brand, the customer and the commercial proposition. SAFARID owns the mobility infrastructure that makes the promise deliverable. This table is the full list of surfaces — nothing outside it is white-labelled."
      >
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Brandable surfaces, their status and who manages them</caption>
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Surface</th>
                <th scope="col" className="px-4 py-3 font-semibold">What it covers</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">Managed by</th>
              </tr>
            </thead>
            <tbody>
              {BRAND_SURFACES.map((s) => (
                <tr key={s.surface} className="border-t border-border align-top">
                  <th scope="row" className="px-4 py-3 text-left font-semibold">{s.surface}</th>
                  <td className="px-4 py-3 text-muted-foreground">{s.detail}</td>
                  <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                  <td className="px-4 py-3"><OwnerBadge owner={s.owner} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        id="architecture"
        eyebrow="Architecture"
        title="White-label platform architecture"
        lead="A partner request enters at the top of this spine and leaves as a settled, reported, documented journey. Each layer is a real system boundary with its own authorization."
      >
        <ArchitectureSpine />
      </Section>

      <Section
        id="tenancy"
        eyebrow="Isolation"
        title="Multi-tenant model"
        lead="Tenant A cannot reach Tenant B, and sandbox cannot reach production. Isolation is enforced in the database by row-level security, so a UI defect cannot leak another partner's data."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {TENANT_MODEL.map((t) => (
            <article key={t.entity} className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-base font-semibold">{t.entity}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t.scope}</p>
              <p className="mt-3 flex gap-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t.isolation}
              </p>
            </article>
          ))}
        </div>
      </Section>

      <Section
        id="brand"
        eyebrow="Configuration"
        title="Brand configuration layer"
        lead="A brand profile is attached to the tenant at provisioning and applied to the surfaces in scope. Some information is deliberately outside its reach."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Brand profile</h3>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {["Logo", "Colours", "Typography", "App identity", "Email identity", "Notification templates", "Legal identity", "Customer-facing policies"].map((f) => (
                <li key={f} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-status-warning/30 bg-status-warning/5 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-status-warning">Never overridable by branding</h3>
            <ul className="mt-4 space-y-3">
              {BRAND_IMMUTABLES.map((i) => (
                <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden />
                  {i}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section
        id="responsibility"
        eyebrow="Operating model"
        title="Who operates what"
        lead="An unowned responsibility is an incident waiting to happen. Every area below has a named owner before a programme goes live."
      >
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Responsibility matrix between partner and SAFARID</caption>
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Area</th>
                <th scope="col" className="px-4 py-3 font-semibold">Owner</th>
                <th scope="col" className="px-4 py-3 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {RESPONSIBILITY_MATRIX.map((r) => (
                <tr key={r.area} className="border-t border-border align-top">
                  <th scope="row" className="px-4 py-3 text-left font-semibold">{r.area}</th>
                  <td className="px-4 py-3"><OwnerBadge owner={r.owner} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        id="services"
        eyebrow="Catalogue"
        title="Services and markets"
        lead="What a tenant may sell, and where. Service and market admission is a governance decision, not a configuration toggle."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border">
            <h3 className="border-b border-border px-5 py-3 text-sm font-semibold">Service catalogue</h3>
            <ul>
              {SERVICE_CATALOGUE.map((s) => (
                <li key={s.service} className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 last:border-b-0">
                  <div>
                    <p className="text-sm font-semibold">{s.service}</p>
                    <p className="text-xs text-muted-foreground">{s.note}</p>
                  </div>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border">
            <h3 className="border-b border-border px-5 py-3 text-sm font-semibold">Markets and availability</h3>
            <ul>
              {MARKETS.map((m) => (
                <li key={m.market} className="border-b border-border px-5 py-4 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{m.market}</p>
                    <StatusBadge status={m.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{m.services}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{m.restrictions}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section
        id="journey"
        eyebrow="Experience"
        title="The branded customer journey"
        lead="The customer sees one continuous branded experience. Behind it, each step has an accountable operator."
      >
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {JOURNEY.map((j, i) => (
            <li key={j.step} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <span className="flex items-center gap-3 text-sm font-semibold">
                <span className="text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                {j.step}
              </span>
              <OwnerBadge owner={j.owner} />
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="orders"
        eyebrow="Domain model"
        title="Canonical mobility order"
        lead="One order record carries the journey from quote to settlement. These are the only states, and the only transitions the platform allows."
      >
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Order state machine and allowed transitions</caption>
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">State</th>
                <th scope="col" className="px-4 py-3 font-semibold">Meaning</th>
                <th scope="col" className="px-4 py-3 font-semibold">Allowed next</th>
              </tr>
            </thead>
            <tbody>
              {ORDER_STATES.map((s) => (
                <tr key={s.state} className="border-t border-border align-top">
                  <th scope="row" className="px-4 py-3 text-left font-mono text-xs font-semibold">{s.state}</th>
                  <td className="px-4 py-3 text-muted-foreground">{s.meaning}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {s.next.length ? s.next.join(" · ") : "terminal"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        id="api"
        eyebrow="Integration"
        title="API and integration"
        lead="White-label runs on exactly the same API platform published for API partners — one surface, one set of scopes, one changelog. There is no separate, undocumented white-label API."
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {DEVELOPER_RESOURCES.map((r) => (
            <Link
              key={r.to}
              to={r.to}
              className="group rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold group-hover:text-primary">{r.name}</h3>
                <StatusBadge status={r.status} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{r.detail}</p>
              <span className="mt-3 inline-flex items-center text-xs font-semibold text-primary">
                Open <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: KeyRound, label: "Scoped credentials per tenant and environment" },
            { icon: Radio, label: "Signed, replay-bounded webhooks" },
            { icon: Boxes, label: "Idempotency keys on every mutating call" },
            { icon: FileCheck2, label: "Versioned OpenAPI with published diffs" },
          ].map(({ icon: Icon, label }) => (
            <p key={label} className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              {label}
            </p>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold">
              Tenant-scoped capability surface
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {currentWhiteLabelRelease().version}
              </span>
            </h3>
            <Link
              to="/partners/white-label/workspace"
              className="inline-flex items-center text-xs font-semibold text-primary"
            >
              Open the white-label workspace <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Each branded surface is sourced from the same capability model as the API partner
            platform, with a mandatory <code className="font-mono">{TENANT_HEADER}</code> header and
            tenant identity on every webhook envelope.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {WHITE_LABEL_DOMAINS.map((d) => (
              <div key={d.key} className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{d.name}</span>
                  <StatusBadge status={d.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{d.evidence}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>


      <Section
        id="security"
        eyebrow="Assurance"
        title="Security and data privacy"
        lead="Only controls that exist are listed as controls. Everything else is marked roadmap or contractual — a security architect should be able to plan against this table without a call."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border">
            <h3 className="border-b border-border px-5 py-3 text-sm font-semibold">Security controls</h3>
            <ul>
              {SECURITY_CONTROLS.map((c) => (
                <li key={c.name} className="border-b border-border px-5 py-4 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{c.name}</p>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.detail}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border">
            <h3 className="border-b border-border px-5 py-3 text-sm font-semibold">Data and privacy</h3>
            <ul>
              {PRIVACY_CONTROLS.map((c) => (
                <li key={c.name} className="border-b border-border px-5 py-4 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{c.name}</p>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section
        id="finance"
        eyebrow="Finance"
        title="From order to settled statement"
        lead="Each step names its source of truth. Nothing in this chain is edited after the fact — corrections are new entries."
      >
        <ol className="grid gap-3 md:grid-cols-2">
          {FINANCIAL_CHAIN.map((f, i) => (
            <li key={f.step} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                <h3 className="text-base font-semibold">{f.step}</h3>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{f.detail}</p>
              <p className="mt-3 flex gap-2 text-xs text-muted-foreground">
                <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Source of truth: {f.sourceOfTruth}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="commercial"
        eyebrow="Commercial"
        title="Commercial model"
        lead="The structure is published; the numbers live in the signed agreement. SAFARID does not publish white-label pricing, because it is sized from scope, services, markets and volume."
      >
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Commercial terms and their basis</caption>
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Term</th>
                <th scope="col" className="px-4 py-3 font-semibold">Basis</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {COMMERCIAL_MODEL.map((c) => (
                <tr key={c.term} className="border-t border-border align-top">
                  <th scope="row" className="px-4 py-3 text-left font-semibold">{c.term}</th>
                  <td className="px-4 py-3 text-muted-foreground">{c.basis}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mt-10 text-lg font-semibold">Service levels</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Targets and objectives are how the platform is run and reported. A commitment exists only where the agreement says so.
        </p>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {SERVICE_LEVELS.map((s) => (
            <li key={s.measure} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{s.measure}</p>
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{s.kind}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{s.value}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="lifecycle"
        eyebrow="Lifecycle"
        title="Ten-stage integration lifecycle"
        lead="Each stage has an owner, entry criteria, deliverables, exit criteria and an approver. A programme cannot skip a stage to reach production faster."
      >
        <div className="space-y-3">
          {LIFECYCLE.map((s) => (
            <details key={s.step} className="group rounded-2xl border border-border bg-card p-5">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3">
                <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-xs font-semibold">{s.step}</span>
                <span className="text-base font-semibold">{s.name}</span>
                <OwnerBadge owner={s.owner} />
                <span className="ml-auto text-xs text-muted-foreground group-open:hidden">Show detail</span>
              </summary>
              <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
                {[
                  ["Entry criteria", s.entryCriteria],
                  ["Activities", s.activities],
                  ["Deliverables", s.deliverables],
                  ["Exit criteria", s.exitCriteria],
                  ["Approval", s.approval],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{k}</dt>
                    <dd className="mt-1 text-muted-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
        </div>
      </Section>

      <Section
        id="golive"
        eyebrow="Production"
        title="Controlled go-live and hypercare"
        lead="Production exposure is staged, and every stage has a defined way back. Hypercare ends on evidence, not on a date."
      >
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Traffic exposure</h3>
          <ol className="mt-4 flex flex-wrap items-center gap-2">
            {ROLLOUT_STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary">{s}</span>
                {i < ROLLOUT_STEPS.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-destructive">Rollback triggers</h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {ROLLBACK_TRIGGERS.map((t) => <li key={t}>• {t}</li>)}
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Hypercare monitoring</h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {HYPERCARE_SIGNALS.map((t) => <li key={t}>• {t}</li>)}
            </ul>
          </div>
        </div>
      </Section>

      <Section
        id="operations"
        eyebrow="Run"
        title="Continuous operations, change and incidents"
        lead="The relationship does not end at go-live. It enters a loop with recertification built into it."
      >
        <ol className="flex flex-wrap items-center gap-2">
          {OPERATING_LOOP.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold">{s}</span>
              {i < OPERATING_LOOP.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
            </li>
          ))}
        </ol>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border">
            <h3 className="border-b border-border px-5 py-3 text-sm font-semibold">Change management</h3>
            <ul>
              {CHANGE_CLASSES.map((c) => (
                <li key={c.change} className="border-b border-border px-5 py-4 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{c.change}</p>
                    {c.requiresRecertification && (
                      <span className="rounded-full border border-status-warning/30 bg-status-warning/10 px-2 py-0.5 text-[11px] font-semibold text-status-warning">
                        Recertification
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.notice}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border">
            <h3 className="border-b border-border px-5 py-3 text-sm font-semibold">Incident management</h3>
            <ol>
              {INCIDENT_PROCESS.map((s, i) => (
                <li key={s.stage} className="border-b border-border px-5 py-3 last:border-b-0">
                  <p className="text-sm font-semibold">{i + 1}. {s.stage}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{s.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <h3 className="mt-10 text-lg font-semibold">Business continuity posture</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {CONTINUITY.map((c) => (
            <article key={c.scenario} className="rounded-xl border border-border bg-card p-4">
              <h4 className="text-sm font-semibold">{c.scenario}</h4>
              <p className="mt-1 text-xs text-muted-foreground">{c.posture}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section
        id="performance"
        eyebrow="Governance"
        title="Performance and governance"
        lead="What gets measured, and the forum that owns each decision."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <Gauge className="h-4 w-4" aria-hidden /> Partner performance
            </h3>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {PERFORMANCE_METRICS.map((m) => (
                <li key={m} className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">{m}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border">
            <h3 className="border-b border-border px-5 py-3 flex items-center gap-2 text-sm font-semibold">
              <Workflow className="h-4 w-4" aria-hidden /> Governance domains
            </h3>
            <ul>
              {GOVERNANCE.map((g) => (
                <li key={g.domain} className="border-b border-border px-5 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{g.domain}</p>
                    <span className="text-xs text-muted-foreground">{g.forum}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{g.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section
        id="claims"
        eyebrow="Verification"
        title="Claim verification matrix"
        lead="Published so a buyer can challenge us on any statement above. Each claim carries a status and the evidence behind it."
      >
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Public claims, their status and supporting evidence</caption>
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Claim</th>
                <th scope="col" className="px-4 py-3 font-semibold">Category</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {CLAIM_MATRIX.filter((c) => c.publiclyVisible).map((c) => (
                <tr key={c.claim} className="border-t border-border align-top">
                  <th scope="row" className="px-4 py-3 text-left font-semibold">{c.claim}</th>
                  <td className="px-4 py-3 text-muted-foreground">{c.category}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{c.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="faq" eyebrow="Questions" title="Frequently asked questions">
        <Accordion type="single" collapsible className="max-w-4xl">
          {WHITE_LABEL_FAQ.map((f, i) => (
            <AccordionItem key={f.q} value={`faq-${i}`}>
              <AccordionTrigger className="text-left text-base font-semibold">{f.q}</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Section>

      <section className="border-t border-border bg-primary py-16 text-primary-foreground">
        <div className="container mx-auto max-w-4xl px-4 text-center">
          <Building2 className="mx-auto h-8 w-8" aria-hidden />
          <h2 className="mt-4 text-2xl font-bold md:text-3xl">Take your brand to market on SAFARID's mobility infrastructure</h2>
          <p className="mx-auto mt-3 max-w-2xl text-primary-foreground/85">
            Programmes are qualified before build. Apply with your market, services and expected volume, and the partner
            desk will come back with a feasibility view and the operating model that fits.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <AppButton size="lg" variant="secondary" analytics="white_label_footer_apply" action="navigate" target="/partners/apply?type=white-label">
              Apply to the programme <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </AppButton>
            <Button asChild size="lg" variant="outline" className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10">
              <a href={SALES_MAILTO}>Email {CONTACT.salesEmail}</a>
            </Button>
          </div>
          <p className="mt-5 text-sm text-primary-foreground/70">
            Technical teams can start in the <Link to="/partners/api" className="underline">API platform</Link> and{" "}
            <Link to="/partners/api/console" className="underline">developer console</Link> before commercial discussions conclude.
          </p>
        </div>
      </section>
    </MarketingPage>
  );
}
