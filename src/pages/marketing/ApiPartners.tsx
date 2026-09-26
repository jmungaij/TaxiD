/**
 * SAFARID API PARTNERS — enterprise API platform experience.
 *
 * This is the technical buying surface for CTOs, enterprise architects and
 * platform teams. Every claim on the page is rendered from the canonical
 * platform contract in `src/lib/partners/apiPlatform.ts`, so marketing copy
 * cannot drift away from the declared API surface, security posture, service
 * levels or commercial model.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Boxes, CheckCircle2, Copy, Check, FileCheck2, Gauge,
  KeyRound, Layers, Lock, Radio, ShieldCheck, Terminal, Workflow,
} from "lucide-react";

import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CONTACT } from "@/config/contact";
import {
  API_BASE_URL, API_FAQ, API_SANDBOX_URL, CAPABILITY_DOMAINS, COMMERCIAL_TIERS,
  LIFECYCLE_STAGES, SECURITY_CONTROLS, SERVICE_LEVELS, WEBHOOK_EVENTS,
  endpointsByDomain, type ApiEndpoint,
} from "@/lib/partners/apiPlatform";

const DOMAIN_ICONS: Record<string, typeof Boxes> = {
  quoting: Gauge,
  orders: Boxes,
  tracking: Radio,
  documents: FileCheck2,
  settlement: Layers,
  identity: KeyRound,
};

const METHOD_TONE: Record<string, string> = {
  GET: "bg-info/10 text-info border-info/30",
  POST: "bg-status-success/10 text-status-success border-status-success/30",
  PATCH: "bg-status-warning/10 text-status-warning border-status-warning/30",
  DELETE: "bg-destructive/10 text-destructive border-destructive/30",
};

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the code remains selectable */
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl border border-border bg-muted/50 p-4 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={copy}
        aria-label={`Copy ${label} sample`}
        className="absolute right-2 top-2 h-7 gap-1 px-2 text-xs"
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-md border px-2 py-0.5 font-mono text-xs font-semibold ${METHOD_TONE[endpoint.method]}`}>
          {endpoint.method}
        </span>
        <code className="font-mono text-sm">{endpoint.path}</code>
        {endpoint.idempotent && <Badge variant="outline" className="text-[11px]">Idempotent</Badge>}
        <Badge variant="secondary" className="font-mono text-[11px]">{endpoint.scope}</Badge>
      </div>
      <h4 className="mt-3 text-base font-semibold">{endpoint.name}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{endpoint.purpose}</p>

      <Tabs defaultValue={endpoint.samples[0].lang} className="mt-4">
        <TabsList>
          {endpoint.samples.map((s) => (
            <TabsTrigger key={s.lang} value={s.lang} className="text-xs">{s.lang}</TabsTrigger>
          ))}
        </TabsList>
        {endpoint.samples.map((s) => (
          <TabsContent key={s.lang} value={s.lang} className="mt-3">
            <CodeBlock code={s.code} label={`${endpoint.name} ${s.lang}`} />
          </TabsContent>
        ))}
      </Tabs>
    </article>
  );
}

export default function ApiPartners() {
  const groups = endpointsByDomain();

  return (
    <MarketingPage>
      <SeoHead
        title="API Partners | SAFARID"
        description="Enterprise mobility infrastructure APIs for quoting, booking, tracking, documents and settlement. Scoped OAuth credentials, signed webhooks, certified go-live."
        path="/partners/api"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "Service",
            name: "SAFARID API Platform",
            serviceType: "Mobility infrastructure API",
            provider: { "@type": "Organization", name: "SAFARID", url: "https://yalla.africa" },
            areaServed: "KE",
            description:
              "Programmatic quoting, booking, tracking, documents and settlement for platforms embedding mobility into their own products.",
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: API_FAQ.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          },
        ]}
      />

      <PageHero
        eyebrow="Integration partners"
        title="Mobility infrastructure, exposed as an API"
        subtitle="Quote, book, track, invoice and reconcile Kenyan mobility from inside your own product. Server-priced, idempotent, signed and certified before a single production request."
      >
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" variant="secondary">
            <Link to="/partners/apply?type=api">
              Request integration access
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
          >
            <Link to="/partners/api/console">Open the developer console</Link>
          </Button>
        </div>
        <dl className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            ["Environments", "Sandbox + production"],
            ["Auth", "OAuth 2.0 scoped credentials"],
            ["Go-live", "Certification-gated"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-primary-foreground/20 bg-primary-foreground/5 p-4">
              <dt className="text-xs uppercase tracking-wide text-primary-foreground/70">{k}</dt>
              <dd className="mt-1 text-sm font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </PageHero>

      {/* -------- Positioning -------- */}
      <section className="border-b border-border bg-muted/30">
        <div className="container mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-3">
          <div className="md:col-span-1">
            <h2 className="text-2xl font-bold">Not an API. An operating platform.</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Behind the endpoints sit dispatch, pricing governance, compliance, tax invoicing and a ledger-grade
              financial spine. You integrate once and inherit all of it.
            </p>
          </div>
          <div className="md:col-span-2 grid gap-4 sm:grid-cols-2">
            {[
              { icon: ShieldCheck, title: "Governed by design", body: "Prices, policies and cancellation outcomes are decided server-side and recorded immutably." },
              { icon: Workflow, title: "One state machine", body: "Rides, charter, delivery and rental share a single order lifecycle and event vocabulary." },
              { icon: FileCheck2, title: "Evidence you can defend", body: "Sealed, hash-verifiable receipts, tax invoices and proof of delivery on every order." },
              { icon: Lock, title: "Least privilege by default", body: "Desk-issued credentials carry only the scopes named in your integration scope document." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-border bg-card p-5">
                <Icon className="h-5 w-5 text-primary" aria-hidden />
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------- Capability domains -------- */}
      <section className="container mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold">Capability domains</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          The API surface is organised by business capability, not by internal service boundaries. Your integration
          scope names the domains you are granted.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {CAPABILITY_DOMAINS.map((d) => {
            const Icon = DOMAIN_ICONS[d.key] ?? Boxes;
            return (
              <Card key={d.key}>
                <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" aria-hidden />
                  </div>
                  <CardTitle className="text-base">{d.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{d.summary}</p>
                  <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                    {d.outcomes.map((o) => (
                      <li key={o} className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden />
                        {o}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* -------- API explorer -------- */}
      <section id="api-surface" className="border-y border-border bg-muted/30">
        <div className="container mx-auto max-w-6xl px-4 py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">The API surface</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Representative endpoints per domain, with runnable samples. The full OpenAPI 3.1 schema is issued with
                your sandbox credentials.
              </p>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p><span className="font-semibold text-foreground">Production</span> <code className="font-mono">{API_BASE_URL}</code></p>
              <p><span className="font-semibold text-foreground">Sandbox</span> <code className="font-mono">{API_SANDBOX_URL}</code></p>
            </div>
          </div>

          <Tabs defaultValue={groups[0].domain.key} className="mt-8">
            <TabsList className="flex h-auto flex-wrap justify-start">
              {groups.map(({ domain }) => (
                <TabsTrigger key={domain.key} value={domain.key} className="text-xs">{domain.name}</TabsTrigger>
              ))}
            </TabsList>
            {groups.map(({ domain, endpoints }) => (
              <TabsContent key={domain.key} value={domain.key} className="mt-6 space-y-5">
                {endpoints.map((e) => <EndpointCard key={`${e.method}${e.path}`} endpoint={e} />)}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </section>

      {/* -------- Webhooks -------- */}
      <section className="container mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 className="text-2xl font-bold">Event-driven, not polled</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              SAFARID pushes state to you. Every delivery is HMAC-SHA-256 signed with a timestamp; reject unsigned or
              stale payloads, respond 2xx to acknowledge, and let backoff handle the rest.
            </p>
            <CodeBlock
              label="webhook verification"
              code={`import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyYallaWebhook(rawBody: string, header: string, secret: string) {
  const [tsPart, sigPart] = header.split(",");           // "t=...,v1=..."
  const timestamp = tsPart.replace("t=", "");
  const expected = createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest("hex");
  const received = sigPart.replace("v1=", "");
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
  return fresh && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}`}
            />
          </div>
          <div className="rounded-2xl border border-border bg-card p-2">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">SAFARID webhook event catalogue</caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="p-3">Event</th>
                  <th scope="col" className="p-3">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {WEBHOOK_EVENTS.map((w) => (
                  <tr key={w.event} className="border-b border-border/60 last:border-0 align-top">
                    <td className="p-3">
                      <code className="font-mono text-xs font-semibold">{w.event}</code>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {w.payloadKeys.map((k) => (
                          <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{k}</span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{w.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* -------- Integration lifecycle -------- */}
      <section className="border-y border-border bg-muted/30">
        <div className="container mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold">Integration lifecycle</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Credentials are never self-serve. Access is granted stage by stage, and each stage has an explicit exit
            criterion — so both sides know what "done" means.
          </p>
          <ol className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-5">
            {LIFECYCLE_STAGES.map((s) => (
              <li key={s.step} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {s.step}
                  </span>
                  <span className="text-xs text-muted-foreground">{s.duration}</span>
                </div>
                <h3 className="mt-3 font-semibold">{s.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.detail}</p>
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Exit criteria: </span>{s.exitCriteria}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* -------- Security + SLO -------- */}
      <section className="container mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold">Security posture</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              What your security review will ask for, stated up front.
            </p>
            <ul className="mt-6 space-y-4">
              {SECURITY_CONTROLS.map((c) => (
                <li key={c.name} className="flex gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <h3 className="text-sm font-semibold">{c.name}</h3>
                    <p className="text-sm text-muted-foreground">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-bold">Service levels</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sandbox is for correctness. Production carries the commitments.
            </p>
            <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Sandbox and production service levels</caption>
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="p-3">Metric</th>
                    <th scope="col" className="p-3">Sandbox</th>
                    <th scope="col" className="p-3">Production</th>
                  </tr>
                </thead>
                <tbody>
                  {SERVICE_LEVELS.map((s) => (
                    <tr key={s.metric} className="border-b border-border/60 last:border-0">
                      <th scope="row" className="p-3 font-medium">{s.metric}</th>
                      <td className="p-3 text-muted-foreground">{s.sandbox}</td>
                      <td className="p-3 font-medium">{s.production}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              <Terminal className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Errors are returned as structured JSON with a stable <code className="font-mono">code</code>, a
              human-readable <code className="font-mono">message</code> and a <code className="font-mono">request_id</code>
              &nbsp;to quote when you contact the desk.
            </div>
          </div>
        </div>
      </section>

      {/* -------- Commercial tiers -------- */}
      <section className="border-y border-border bg-muted/30">
        <div className="container mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold">Commercial models</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Pricing is contracted, not published per call — because volume, service lines and settlement model change
            the economics. Here is the shape of each engagement.
          </p>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {COMMERCIAL_TIERS.map((t) => (
              <Card key={t.key} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="text-lg">{t.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{t.positioning}</p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Rate limit</dt>
                      <dd className="font-medium">{t.rateLimit}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Support</dt>
                      <dd className="font-medium">{t.support}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Commercials</dt>
                      <dd className="font-medium">{t.commercials}</dd>
                    </div>
                  </dl>
                  <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
                    {t.inclusions.map((i) => (
                      <li key={i} className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden />
                        {i}
                      </li>
                    ))}
                  </ul>
                  <Button asChild className="mt-6 w-full">
                    <Link to={`/partners/apply?type=api&tier=${t.key}`}>Discuss {t.name}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* -------- FAQ -------- */}
      <section className="container mx-auto max-w-4xl px-4 py-16">
        <h2 className="text-2xl font-bold">Technical questions, answered</h2>
        <Accordion type="single" collapsible className="mt-6">
          {API_FAQ.map((f, i) => (
            <AccordionItem key={f.q} value={`faq-${i}`}>
              <AccordionTrigger className="text-left text-base">{f.q}</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* -------- Conversion -------- */}
      <section className="bg-primary text-primary-foreground">
        <div className="container mx-auto max-w-5xl px-4 py-16 text-center">
          <h2 className="text-3xl font-bold">Start with a technical discovery session</h2>
          <p className="mx-auto mt-3 max-w-2xl text-primary-foreground/85">
            Bring your architecture and your volumes. You will leave with a named integration scope, a sandbox
            timeline and the certification scenarios you have to pass.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" variant="secondary">
              <Link to="/partners/apply?type=api">
                Request integration access
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
            >
              <Link to="/contact?subject=api-onboarding">Talk to the integration desk</Link>
            </Button>
          </div>
          <p className="mt-6 text-sm text-primary-foreground/75">
            Technical enquiries: <a className="underline" href={`mailto:${CONTACT.salesEmail}`}>{CONTACT.salesEmail}</a>
            {" · "}
            <a className="underline" href={`tel:${CONTACT.phoneE164}`}>{CONTACT.phoneDisplay}</a>
          </p>
        </div>
      </section>
    </MarketingPage>
  );
}
