import { SeoHead } from "@/components/seo/SeoHead";
import { Link } from "react-router-dom";
import { ArrowRight, Shield, Eye, TrendingUp, Award, CheckCircle2, Target, Lock, Zap, Building2, Headphones, Activity, Sparkles, Users, Globe, Leaf, Wallet, Briefcase, FileCheck2, Scale } from "lucide-react";
import { MarketingPage } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { AnalyticsEvents } from "@/lib/analyticsEvents";
import { AfricaMap } from "@/components/marketing/AfricaMap";
import { Counter } from "@/components/marketing/Counter";

const values = [
  { icon: Shield,     title: "Safety",        desc: "Background checks, live monitoring, in-trip insurance.", metric: "<60s SOS", href: "/safety" },
  { icon: CheckCircle2, title: "Reliability", desc: "99.95% uptime, sub-2-minute driver settlement.",         metric: "99.95% uptime", href: "/reliability" },
  { icon: Eye,        title: "Transparency",  desc: "Open pricing, immutable audit logs, live dashboards.",  metric: "0 hidden fees", href: "/transparency" },
  { icon: TrendingUp, title: "Innovation",    desc: "Event-driven core, AI assist, open developer APIs.",    metric: "<100ms p95",  href: "/innovation" },
  { icon: Award,      title: "Compliance",    desc: "GDPR, Kenya DPA, PCI DSS, ISO 27001 readiness.",        metric: "Kenya DPA",   href: "/compliance" },
];

const objectives = [
  { icon: Wallet,     title: "Economic Empowerment", desc: "Instant settlement and fair commissions for 12,400+ drivers." },
  { icon: Globe,      title: "Digital Inclusion",    desc: "USSD and feature-phone access bring mobility to every Kenyan." },
  { icon: Leaf,       title: "Sustainable Mobility", desc: "Pooling, smart routing and EV pilots reduce CO₂ per trip." },
  { icon: Building2,  title: "Enterprise Transport", desc: "Corporate wallets, policy and approvals for 850+ companies." },
  { icon: TrendingUp, title: "Regional Expansion",   desc: "From Kenya to Uganda, Tanzania, Rwanda and beyond." },
];

const compliance = [
  { icon: Globe,       label: "GDPR" },
  { icon: Shield,      label: "Kenya DPA 2019" },
  { icon: Lock,        label: "PCI DSS scope" },
  { icon: Award,       label: "ISO 27001 ready" },
  { icon: FileCheck2,  label: "OWASP ASVS L2" },
];

const capabilities = [
  { icon: Building2,  title: "Enterprise Infrastructure",   desc: "Multi-AZ, hash-chained ledger, idempotent payments.", kpi: "99.95% SLA",      href: "/security" },
  { icon: Zap,        title: "Instant Driver Settlement",   desc: "Earnings to M-Pesa in under 2 minutes per trip.",     kpi: "<2 min payout",   href: "/drivers" },
  { icon: Briefcase,  title: "Corporate Travel Governance", desc: "Cost centres, budgets, approvals, eTIMS invoicing.",  kpi: "850+ clients",    href: "/corporates" },
  { icon: Activity,   title: "Real-Time Ops Monitoring",    desc: "Live trip, payment and incident dashboards.",          kpi: "24/7 NOC",        href: "/security" },
  { icon: Scale,      title: "Regulatory Compliance",       desc: "KRA eTIMS, NTSA, ODPC — built in, not bolted on.",     kpi: "100% eTIMS",      href: "/compliance-center" },
  { icon: Sparkles,   title: "AI-Assisted Support",         desc: "LLM-powered triage resolves 70% of tickets in <2 min.", kpi: "70% auto-resolve", href: "/innovation" },
];

const stats = [
  { v: 12400,   suf: "+",     l: "Active Drivers" },
  { v: 150000,  suf: "+",     l: "Registered Riders" },
  { v: 850,     suf: "+",     l: "Corporate Clients" },
  { v: 4200000, suf: "+",     l: "Completed Trips" },
  { v: 320000,  suf: "+",     l: "Package Deliveries" },
];

const cases = [
  {
    eyebrow: "Corporate Mobility",
    title: "Safaricom — corporate travel transformed",
    desc: "Wallets, cost centres and policy automation cut travel admin overhead and gave Finance live visibility on spend.",
    kpis: [
      { v: "-64%", l: "Travel admin time" },
      { v: "+38%", l: "Policy compliance" },
      { v: "3.4x",  l: "ROI in year one" },
    ],
  },
  {
    eyebrow: "Last-Mile Logistics",
    title: "Jumia — 18,000 daily deliveries",
    desc: "TaxiD Delivery APIs scaled Jumia's last-mile from pilot to nationwide in under nine months.",
    kpis: [
      { v: "18K",  l: "Deliveries/day" },
      { v: "-22%", l: "Cost per drop" },
      { v: "9 mo", l: "To nationwide" },
    ],
  },
];

const About = () => (
  <MarketingPage>
    <SeoHead
      title="About TaxiD — Africa's mobility & logistics OS"
      description="TaxiD is a digital platform that facilitates travel by connecting riders to a spectrum of mobility solutions."
      path="/about"
    />

    {/* ---------------- HERO ---------------- */}
    <section className="relative overflow-hidden bg-primary text-primary-foreground">
      <div className="absolute inset-0 opacity-20" aria-hidden>
        <svg className="w-full h-full" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="1200" height="600" fill="url(#grid)" />
          {[...Array(8)].map((_, i) => (
            <circle key={i} cx={150 + i * 130} cy={300 + Math.sin(i) * 60} r="4" fill="white">
              <animate attributeName="opacity" values="0.2;1;0.2" dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
            </circle>
          ))}
          <path d="M 50 400 Q 300 200 600 350 T 1150 250" stroke="white" strokeWidth="2" fill="none" strokeDasharray="4 6" opacity="0.5">
            <animate attributeName="stroke-dashoffset" values="0;-20" dur="3s" repeatCount="indefinite" />
          </path>
        </svg>
      </div>
      <div className="relative container mx-auto px-4 py-24 md:py-32 max-w-5xl">
        <span className="inline-block px-3 py-1 rounded-full bg-ice/20 text-xs font-semibold mb-5 uppercase tracking-wider">About TaxiD</span>
        <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-5">
          One Platform.<br />
          <span className="bg-gradient-to-r from-ice to-ice/70 bg-clip-text text-transparent">Every Journey.</span>
        </h1>
        <p className="text-lg md:text-xl text-primary-foreground/90 max-w-3xl mb-8">
          TaxiD is a digital platform that facilitates travel by connecting riders to a spectrum of mobility solutions.
        </p>
        <div className="flex flex-wrap gap-3">
          <AppButton size="lg" className="bg-ice text-primary hover:bg-ice/90"
            analytics="marketing.get_started" action="navigate" target="/auth?mode=register">
            Get Started <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </AppButton>
          <AppButton size="lg" variant="outline" className="border-ice/70 text-ice hover:bg-ice/20"
            analytics="marketing.partner_with_us" action="navigate" target="/contact">
            Partner With Us
          </AppButton>
          <AppButton size="lg" variant="ghost" className="text-ice hover:bg-ice/20"
            analytics="marketing.explore_enterprise" action="navigate" target="/corporates">
            Explore Enterprise <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </AppButton>
        </div>
      </div>
    </section>

    {/* ---------------- MISSION / VISION ---------------- */}
    <section className="container mx-auto px-4 py-20">
      <div className="grid md:grid-cols-2 gap-6 mb-10">
        <div className="p-8 rounded-2xl bg-gradient-to-br from-secondary to-background border border-border">
          <Target className="h-10 w-10 text-primary mb-4" />
          <h2 className="text-2xl font-bold mb-3">Our Mission</h2>
          <p className="text-muted-foreground">Transform mobility through intelligent transportation technology that empowers riders, drivers, businesses and communities.</p>
        </div>
        <div className="p-8 rounded-2xl bg-gradient-to-br from-secondary to-background border border-border">
          <Eye className="h-10 w-10 text-primary mb-4" />
          <h2 className="text-2xl font-bold mb-3">Our Vision</h2>
          <p className="text-muted-foreground">To become Africa's most trusted and connected mobility ecosystem — linking cities, communities and commerce at scale.</p>
        </div>
      </div>

      <h3 className="text-xl font-semibold mb-6">Strategic Objectives</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {objectives.map((o) => (
          <div key={o.title} className="p-5 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors">
            <o.icon className="h-7 w-7 text-primary mb-3" />
            <h4 className="font-semibold mb-1">{o.title}</h4>
            <p className="text-xs text-muted-foreground">{o.desc}</p>
          </div>
        ))}
      </div>
    </section>

    {/* ---------------- CORE VALUES ---------------- */}
    <section className="bg-secondary/40 py-20">
      <div className="container mx-auto px-4">
        <div className="max-w-2xl mb-12">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">Core Values</span>
          <h2 className="text-3xl md:text-4xl font-bold mt-2 mb-3">What we stand for</h2>
          <p className="text-muted-foreground">Five non-negotiables that shape every decision, every release, every ride.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-5">
          {values.map((v) => (
            <Link
              key={v.title}
              to={v.href}
              className="group p-6 rounded-xl bg-card border border-border hover:border-primary hover:shadow-lg transition-all"
            >
              <v.icon className="h-8 w-8 text-primary mb-3 group-hover:scale-110 transition-transform" />
              <h3 className="font-semibold mb-2">{v.title}</h3>
              <p className="text-sm text-muted-foreground mb-4">{v.desc}</p>
              <div className="text-xs font-semibold text-primary mb-3">{v.metric}</div>
              <div className="inline-flex items-center text-sm font-medium text-primary">
                Read about {v.title.toLowerCase()} <ArrowRight className="ml-1 h-3 w-3 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>

    {/* ---------------- TRUST & COMPLIANCE ---------------- */}
    <section className="container mx-auto px-4 py-20">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">Trust & Compliance Center</span>
          <h2 className="text-3xl md:text-4xl font-bold mt-2 mb-4">Compliance, by design</h2>
          <p className="text-muted-foreground mb-6">
            TaxiD is built to the highest enterprise security and regulatory standards in every market we operate in.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
            {compliance.map((c) => (
              <div key={c.label} className="flex items-center gap-2 p-3 rounded-lg bg-card border border-border">
                <c.icon className="h-5 w-5 text-primary shrink-0" />
                <span className="text-sm font-medium">{c.label}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <Button asChild><Link to="/compliance-center">Compliance Center</Link></Button>
            <Button asChild variant="outline"><Link to="/security">Security</Link></Button>
            <Button asChild variant="ghost"><Link to="/privacy">Privacy</Link></Button>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-gradient-to-br from-card to-secondary border border-border shadow-xl">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Security Dashboard</div>
              <div className="text-lg font-semibold mt-1">Live status</div>
            </div>
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-status-success">
              <span className="h-2 w-2 rounded-full bg-status-success animate-pulse" /> Operational
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { l: "System availability", v: "99.97%" },
              { l: "Platform health",     v: "A+" },
              { l: "Incidents (30d)",     v: "0" },
              { l: "Audit compliance",    v: "100%" },
            ].map((m) => (
              <div key={m.l} className="p-4 rounded-lg bg-background border border-border">
                <div className="text-xs text-muted-foreground">{m.l}</div>
                <div className="text-2xl font-bold text-primary mt-1">{m.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>

    {/* ---------------- WHY TaxiD RIDE ---------------- */}
    <section className="bg-secondary/40 py-20">
      <div className="container mx-auto px-4">
        <div className="max-w-2xl mb-12">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">Why TaxiD</span>
          <h2 className="text-3xl md:text-4xl font-bold mt-2 mb-3">Enterprise capabilities, end to end</h2>
          <p className="text-muted-foreground">Everything an operator, partner or enterprise customer needs to move people and goods at scale.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {capabilities.map((c) => (
            <div key={c.title} className="group p-6 rounded-xl bg-card border border-border hover:border-primary hover:shadow-lg transition-all flex flex-col">
              <c.icon className="h-7 w-7 text-primary mb-3" />
              <h3 className="font-semibold mb-2">{c.title}</h3>
              <p className="text-sm text-muted-foreground mb-4 flex-1">{c.desc}</p>
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <span className="text-xs font-semibold text-primary">{c.kpi}</span>
                <Link to={c.href} aria-label={`Read about ${c.title}`} className="text-sm font-medium text-primary inline-flex items-center hover:underline">
                  Read about {c.title.toLowerCase()} <ArrowRight className="ml-1 h-3 w-3 group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* ---------------- PLATFORM SCALE ---------------- */}
    <section className="bg-primary text-primary-foreground py-20">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-3">TaxiD by the numbers</h2>
          <p className="text-primary-foreground/85">The scale behind Africa's mobility operating system.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
          {stats.map((s) => (
            <div key={s.l} className="text-center">
              <div className="text-3xl md:text-5xl font-bold tabular-nums">
                <Counter to={s.v} suffix={s.suf} />
              </div>
              <div className="text-sm text-primary-foreground/80 mt-2">{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* ---------------- CASE STUDIES ---------------- */}
    <section className="container mx-auto px-4 py-20">
      <div className="max-w-2xl mb-12">
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">Impact Stories</span>
        <h2 className="text-3xl md:text-4xl font-bold mt-2 mb-3">Enterprise case studies</h2>
        <p className="text-muted-foreground">Real businesses delivering real outcomes on TaxiD.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        {cases.map((c) => (
          <article key={c.title} className="p-8 rounded-2xl bg-card border border-border hover:shadow-xl transition-shadow">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">{c.eyebrow}</span>
            <h3 className="text-xl font-bold mt-2 mb-3">{c.title}</h3>
            <p className="text-muted-foreground mb-6">{c.desc}</p>
            <div className="grid grid-cols-3 gap-3 pt-6 border-t border-border">
              {c.kpis.map((k) => (
                <div key={k.l}>
                  <div className="text-2xl font-bold text-primary">{k.v}</div>
                  <div className="text-xs text-muted-foreground mt-1">{k.l}</div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>

    {/* ---------------- LEADERSHIP ---------------- */}
    <section className="bg-secondary/40 py-20">
      <div className="container mx-auto px-4">
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Leadership & Governance</span>
            <h2 className="text-3xl md:text-4xl font-bold mt-2 mb-4">Operators behind the platform</h2>
            <p className="text-muted-foreground mb-6">Independent board oversight with audit, risk and safety committees.</p>
            <div className="flex flex-wrap gap-3">
              <Button asChild><Link to="/leadership">Executive team</Link></Button>
              <Button asChild variant="outline"><Link to="/governance">Board & committees</Link></Button>
              <Button asChild variant="ghost"><Link to="/investors">Investors</Link></Button>
            </div>
          </div>
          <div className="lg:col-span-2 grid sm:grid-cols-2 gap-4">
            {[
              { icon: Briefcase, t: "Executive Leadership", d: "Operators who have scaled African tech, finance and mobility." },
              { icon: Scale,     t: "Board Governance",     d: "Audit, risk, remuneration, safety and ESG committees." },
              { icon: Users,     t: "Advisory Council",     d: "Regional regulators, drivers, corporates and academics." },
              { icon: Award,     t: "Independent Safety",   d: "Quarterly review board for serious incidents." },
            ].map((x) => (
              <div key={x.t} className="p-5 rounded-xl bg-card border border-border">
                <x.icon className="h-7 w-7 text-primary mb-3" />
                <h3 className="font-semibold mb-1">{x.t}</h3>
                <p className="text-sm text-muted-foreground">{x.d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>

    {/* ---------------- AFRICA EXPANSION MAP ---------------- */}
    <section className="container mx-auto px-4 py-20">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">Africa Expansion</span>
          <h2 className="text-3xl md:text-4xl font-bold mt-2 mb-4">Live across East Africa. Growing across the continent.</h2>
          <p className="text-muted-foreground mb-6">
            TaxiD is operational in Kenya, Uganda and Tanzania, with Rwanda, Ethiopia and Nigeria onboarding next.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div><div className="text-2xl font-bold text-primary">3</div><div className="text-xs text-muted-foreground">Live markets</div></div>
            <div><div className="text-2xl font-bold text-primary">6+</div><div className="text-xs text-muted-foreground">Onboarding</div></div>
            <div><div className="text-2xl font-bold text-primary">12</div><div className="text-xs text-muted-foreground">Cities live</div></div>
          </div>
        </div>
        <AfricaMap />
      </div>
    </section>

    {/* ---------------- INVESTOR ---------------- */}
    <section className="bg-gradient-to-br from-secondary via-background to-secondary py-20">
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="text-center mb-10">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">Investor Relations</span>
          <h2 className="text-3xl md:text-4xl font-bold mt-2 mb-3">Building Africa's mobility OS</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">Compounding platform economics across rides, delivery, corporate and rental.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
          {[
            { l: "African mobility TAM", v: "$120B" },
            { l: "Active drivers",       v: "12,400+" },
            { l: "Corporate clients",    v: "850+" },
            { l: "Trips completed",      v: "4.2M+" },
          ].map((s) => (
            <div key={s.l} className="p-6 rounded-xl bg-card border border-border text-center">
              <div className="text-3xl font-bold text-primary">{s.v}</div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mt-2">{s.l}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild size="lg"><Link to="/investors">Investor Relations</Link></Button>
          <Button asChild size="lg" variant="outline"><Link to="/news">Newsroom</Link></Button>
          <Button asChild size="lg" variant="ghost"><Link to="/sustainability">Sustainability</Link></Button>
        </div>
      </div>
    </section>

    {/* ---------------- FINAL CTA ---------------- */}
    <section className="bg-primary text-primary-foreground py-20">
      <div className="container mx-auto px-4 text-center max-w-3xl">
        <Headphones className="h-12 w-12 mx-auto mb-5 opacity-90" />
        <h2 className="text-3xl md:text-4xl font-bold mb-4">Move with TaxiD</h2>
        <p className="text-lg opacity-90 mb-8">Join the operating system powering Africa's mobility — as a rider, driver, corporate, partner or investor.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <AppButton analytics={AnalyticsEvents.MARKETING_GET_STARTED} action="navigate" target="/auth?mode=register"
            size="lg" className="bg-ice text-primary hover:bg-ice/90">
            Get Started <ArrowRight className="ml-2 h-4 w-4" />
          </AppButton>
          <AppButton analytics={AnalyticsEvents.MARKETING_TALK_TO_SALES} action="navigate" target="/contact"
            size="lg" variant="outline" className="border-ice/70 text-ice hover:bg-ice/20">
            Talk to Sales
          </AppButton>
        </div>
      </div>
    </section>
  </MarketingPage>
);

export default About;
