import { Link, useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  StaffPageHeader, StaffSection, FlowChain, ChipList, InfoCard, MetricTile,
} from "@/components/staff/primitives";
import {
  CUSTOMER_SEGMENTS, SUPPLY_PARTICIPANTS, SUPPLY_VOCABULARY, REVENUE_CATEGORIES,
  REVENUE_GRAPH, COMMERCIAL_FLOW, PEOPLE_FLOW, REVENUE_FUNNEL, REVENUE_QUALITY_MEASURES,
  SALES_LIFECYCLE, MARKETPLACE_DIMENSIONS, LIQUIDITY_AXES,
} from "@/lib/staff/businessModel";
import {
  DEPARTMENTS, DIVISIONS, departmentBySlug, departmentsByDivision, ORG_HIERARCHY,
  POSITION_MODEL, CAPABILITY_DOMAINS, CAPABILITY_LEVELS, SKILL_EVIDENCE, PEOPLE_MODULES,
  ACADEMY_TRACKS, KNOWLEDGE_CLASSES, DECISION_REGISTER_FIELDS, INNOVATION_PIPELINE,
  INNOVATION_CRITERIA, WORKFORCE_SCENARIOS, PERFORMANCE_CHAIN,
} from "@/lib/staff/organisation";
import {
  SIGNAL_KINDS, SIGNAL_FAMILY_LABEL, RECOMMENDATION_CONTRACT, EXECUTIVE_DOMAINS,
  CLV_INPUTS, TWIN_NODES, type SignalFamily,
} from "@/lib/staff/intelligence";
import { requireInterns360Entries } from "@/lib/staff/interns360Entries";
import { GOVERNANCE_CONTROLS, UNIVERSAL_SEARCH_ENTITIES, scopesForRoles } from "@/lib/staff/access";
import { ExplainedAiPanel, ExplainedContractLegend, type ExplainedInsight } from "@/components/staff/ExplainedAiPanel";
import { AttentionSignalCard } from "@/components/staff/AttentionSignalCard";
import { SeedBatchNotice } from "@/components/staff/SeedBatchNotice";
import { SEED_BATCH, pickMetric, signalsByDomain, useIntelligenceData } from "@/lib/staff/intelligenceData";

/* Explained-AI insights. Sources are declared; unresolved sources block the
   conclusion rather than producing an estimate presented as performance. */
const EXPLAINED_INSIGHTS: ExplainedInsight[] = [
  {
    key: "revenue_concentration_risk",
    title: "Revenue concentration risk",
    why: "Concentration is computed as the share of recognised revenue attributable to the largest corporate accounts over a trailing period.",
    sources: [
      { label: "Recognised revenue", origin: "corporate_invoices · journals", state: "unavailable" },
      { label: "Account register", origin: "corporate_accounts", state: "unavailable" },
    ],
    assumptions: [
      "Only issued, non-voided invoices count toward recognised revenue.",
      "Accounts under one corporate group are treated as a single exposure.",
      "Trailing window is 12 months; shorter histories are reported as insufficient.",
    ],
    expectedImpact: "Not stated until sources resolve",
    recommendedAction: "Connect finance recognition data for your scope",
    owner: "Finance",
  },
  {
    key: "marketplace_liquidity_constraint",
    title: "Marketplace liquidity constraint",
    why: "Liquidity is the ratio of matched demand to total qualified demand, segmented by geography, service and time band.",
    sources: [
      { label: "Demand requests", origin: "dispatch_requests", state: "unavailable" },
      { label: "Verified supply availability", origin: "dispatch_supply_cells", state: "unavailable" },
    ],
    assumptions: [
      "Only compliance-verified participants count as available supply.",
      "Cancelled requests before offer are excluded from qualified demand.",
      "Geography is resolved to the operating city, not the raw coordinate.",
    ],
    expectedImpact: "Not stated until sources resolve",
    recommendedAction: "Connect dispatch telemetry for your geographic scope",
    owner: "Marketplace & Partner Success",
  },
  {
    key: "contract_explanation_corporate_mobility",
    title: "Contract explanation — corporate mobility agreement",
    why: "A contract explanation restates configured commercial terms in plain language and cites the clause or configuration each statement comes from. It never infers unwritten terms.",
    sources: [
      { label: "Commercial terms", origin: "corporate_accounts · payment_terms_days, credit_limit_cents", state: "unavailable" },
      { label: "Policy rules", origin: "corporate_policy_rules", state: "unavailable" },
      { label: "Signed agreement document", origin: "corporate_documents", state: "unavailable" },
    ],
    assumptions: [
      "Where a document and a configured value disagree, the document prevails and the conflict is flagged.",
      "Clauses without a machine-readable configuration are quoted, never summarised as a value.",
      "No obligation, discount or penalty is asserted unless it appears in a cited source.",
    ],
    expectedImpact: "Not stated until sources resolve",
    recommendedAction: "Select an account with a stored, parsed agreement",
    owner: "Commercial & Legal",
  },
];

/* ---------------------------------------------------------------- Staff 360 */

const IMPACT_MEASURES = [
  { key: "customers", label: "Customers" },
  { key: "revenue", label: "Revenue" },
  { key: "marketplace", label: "Marketplace" },
  { key: "service_quality", label: "Service quality" },
  { key: "efficiency", label: "Efficiency" },
  { key: "innovation", label: "Innovation" },
  { key: "risk_reduction", label: "Risk reduction" },
  { key: "retention", label: "Retention" },
];

export function Staff360Home() {
  const { user, roles } = useAuth();
  const { index, seeded } = useIntelligenceData();
  const scopes = [...scopesForRoles(roles)];
  const answers = [
    { q: "Who am I?", a: `${user?.email ?? "Signed-in employee"} · roles: ${roles.join(", ") || "none granted"}` },
    { q: "What do I need to do?", a: "Tasks, approvals and deadlines appear once workflow assignment is wired to your position." },
    { q: "How am I performing?", a: "Outcome-based goals and KPIs, not activity volume." },
    { q: "What is my team doing?", a: "Team workload, outcomes and collaboration within your scope." },
    { q: "What is my department doing?", a: "Department performance against its operating system." },
    { q: "How is SAFARID performing?", a: "Authorised enterprise intelligence only." },
    { q: "What should I do next?", a: "Explained next-best actions from the SAFARID intelligence layer." },
  ];
  return (
    <>
      <StaffPageHeader
        eyebrow="SAFARID"
        title="Staff 360"
        lede="The internal operating system of a digital mobility marketplace: people, organisation, customers, marketplace, revenue and intelligence in one connected model."
      />
      <StaffSection title="Your seven questions" description="The first layer stays simple. Depth is one click away.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {answers.map((x) => (
            <InfoCard key={x.q} title={x.q}>{x.a}</InfoCard>
          ))}
        </div>
      </StaffSection>
      <StaffSection title="My SAFARID impact" description="Role-appropriate contribution measures — never a crude employee revenue score.">
        {seeded && <SeedBatchNotice batch={SEED_BATCH} className="mb-4 rounded-lg border border-info/30 bg-info/5 p-4" />}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {IMPACT_MEASURES.map((m) => (
            <MetricTile
              key={m.key}
              metric={pickMetric(index, "impact", "global", m.key, m.label, "Requires measurable outcomes linked to your position.")}
            />
          ))}
        </div>
      </StaffSection>
      <StaffSection
        title="Interns 360 — YMEITA"
        description="The talent accelerator inside Staff 360: recruitment, cohorts, capability, verified contribution and integrity."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {requireInterns360Entries().map((e) => (
            <Card key={e.to} className="h-full transition-colors hover:border-primary/40">
              <CardContent className="pt-5">
                <div className="text-sm font-semibold">{e.label}</div>
                <p className="mt-2 text-sm text-muted-foreground">{e.hint}</p>
                <Button asChild variant="ghost" size="sm" className="mt-3 px-0">
                  <Link to={e.to}>{e.cta ?? "Open"}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </StaffSection>
      <StaffSection title="Your data scope" description="You never see data merely because it exists in the platform.">
        <ChipList items={scopes.length ? scopes : ["self"]} />
      </StaffSection>
      <StaffSection title="How SAFARID creates value">
        <div className="space-y-4">
          <FlowChain steps={COMMERCIAL_FLOW} />
          <FlowChain steps={PEOPLE_FLOW} />
        </div>
      </StaffSection>
    </>
  );
}

/* ------------------------------------------------------------ Organisation */

export function StaffOrganisation() {
  return (
    <>
      <StaffPageHeader eyebrow="Organisation management" title="SAFARID Organisation Management System"
        lede="The authoritative organisational structure, and how each position connects to authority, workflow, KPI and capability." />
      <StaffSection title="Structural model">
        <div className="space-y-4">
          <FlowChain steps={ORG_HIERARCHY} />
          <FlowChain steps={POSITION_MODEL} />
        </div>
      </StaffSection>
      {DIVISIONS.map((div) => (
        <StaffSection key={div.id} title={div.label}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {departmentsByDivision(div.id).map((d) => (
              <Card key={d.slug} className="h-full">
                <CardContent className="pt-5">
                  <div className="text-sm font-semibold">{d.label}</div>
                  <div className="mt-1 text-xs text-primary">{d.operatingSystem}</div>
                  <p className="mt-2 text-sm text-muted-foreground">{d.mandate}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{d.valueContribution}</p>
                  <Button asChild variant="ghost" size="sm" className="mt-3 px-0">
                    <Link to={`/staff/departments/${d.slug}`}>Open operating system</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </StaffSection>
      ))}
      <StaffSection title="Continuous performance intelligence" description="Strategy connects to individual outcomes and impact.">
        <FlowChain steps={PERFORMANCE_CHAIN} />
      </StaffSection>
    </>
  );
}

/* ------------------------------------------------------------- Departments */

export function StaffDepartments() {
  return (
    <>
      <StaffPageHeader eyebrow="Departmental operating systems" title="Departments"
        lede="Eighteen interconnected operating systems, each accountable for a defined contribution to customers, marketplace and revenue." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DEPARTMENTS.map((d) => (
          <Link key={d.slug} to={`/staff/departments/${d.slug}`} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardContent className="pt-5">
                <div className="text-sm font-semibold">{d.label}</div>
                <div className="mt-1 text-xs text-primary">{d.operatingSystem}</div>
                <p className="mt-2 text-sm text-muted-foreground">{d.mandate}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

const DEPT_METRICS = [
  { key: "outcomes_delivered", label: "Outcomes delivered" },
  { key: "cycle_time", label: "Cycle time" },
  { key: "quality", label: "Quality" },
  { key: "revenue_contribution", label: "Contribution to revenue" },
];

export function StaffDepartmentDetail() {
  const { slug } = useParams();
  const dept = departmentBySlug(slug);
  const { index, seeded } = useIntelligenceData();
  if (!dept) {
    return (
      <>
        <StaffPageHeader title="Department not found" lede="This department is not part of the SAFARID organisation model." />
        <Button asChild variant="outline"><Link to="/staff/departments">Back to departments</Link></Button>
      </>
    );
  }
  return (
    <>
      <StaffPageHeader eyebrow={dept.operatingSystem} title={dept.label} lede={dept.mandate} />
      {seeded && <SeedBatchNotice batch={SEED_BATCH} />}
      <StaffSection title="Contribution to the economic engine">
        <p className="text-sm text-muted-foreground">{dept.valueContribution}</p>
      </StaffSection>
      <StaffSection title="Capability dependencies"><ChipList items={dept.capabilities} /></StaffSection>
      <StaffSection title="Department performance" description="Metrics appear only when this department's data sources are connected to your scope.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DEPT_METRICS.map((m) => (
            <MetricTile key={m.key} metric={pickMetric(index, "department", dept.slug, m.key, m.label)} />
          ))}
        </div>
      </StaffSection>
      {dept.linkedSurfaces?.length ? (
        <StaffSection title="Existing SAFARID surfaces" description="Reused, not rebuilt.">
          <div className="flex flex-wrap gap-2">
            {dept.linkedSurfaces.map((s) => (
              <Button key={s.to} asChild variant="outline" size="sm"><Link to={s.to}>{s.label}</Link></Button>
            ))}
          </div>
        </StaffSection>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- Revenue */

export function StaffRevenue() {
  const { index, seeded } = useIntelligenceData();
  return (
    <>
      <StaffPageHeader eyebrow="Finance & revenue assurance" title="SAFARID Revenue Intelligence Centre"
        lede="Revenue architecture, revenue graph and revenue quality. Commercial rules are read from configured platform pricing and settlement definitions — never assumed." />
      {seeded && <SeedBatchNotice batch={SEED_BATCH} />}
      <StaffSection title="Revenue graph"><FlowChain steps={REVENUE_GRAPH} /></StaffSection>
      <StaffSection title="Revenue categories">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {REVENUE_CATEGORIES.map((c) => (
            <InfoCard key={c.id} title={c.label}>
              <p>{c.description}</p>
              <div className="text-xs">Rule source: <span className="text-foreground">{c.ruleSource.replace(/_/g, " ")}</span></div>
              <MetricTile metric={pickMetric(index, "revenue_category", c.id, "recognised", "Recognised revenue", "Connect configured finance definitions to report this category.")} />
            </InfoCard>
          ))}
        </div>
      </StaffSection>
      <StaffSection title="Revenue funnel"><FlowChain steps={REVENUE_FUNNEL} /></StaffSection>
      <StaffSection title="Revenue quality"><ChipList items={REVENUE_QUALITY_MEASURES} /></StaffSection>
      <StaffSection title="Sales operating system" description="One lifecycle across individual, corporate, charter, delivery, logistics, rental and leasing demand.">
        <FlowChain steps={SALES_LIFECYCLE} />
      </StaffSection>
      <StaffSection title="Customer lifetime value inputs"><ChipList items={CLV_INPUTS} /></StaffSection>
    </>
  );
}

/* ----------------------------------------------------------- Marketplace */

export function StaffMarketplace() {
  const { index, seeded } = useIntelligenceData();
  const liquidity = [
    { key: "match_rate", label: "Match rate" },
    { key: "unmet_demand", label: "Unmet demand" },
    { key: "verified_supply", label: "Verified supply availability" },
    { key: "time_to_match", label: "Time to match" },
  ];
  return (
    <>
      <StaffPageHeader eyebrow="Marketplace & partner success" title="Marketplace 360"
        lede="SAFARID connects demand with independent resource owners and operators. Third-party capacity is marketplace supply — never SAFARID's fleet." />
      {seeded && <SeedBatchNotice batch={SEED_BATCH} />}
      <StaffSection title="Marketplace dimensions"><ChipList items={MARKETPLACE_DIMENSIONS} /></StaffSection>
      <StaffSection title="Marketplace liquidity" description="Can SAFARID match demand to available marketplace supply, across every axis?">
        <ChipList items={LIQUIDITY_AXES} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {liquidity.map((m) => (
            <MetricTile
              key={m.key}
              metric={pickMetric(index, "marketplace", "global", m.key, m.label, "Requires demand and supply telemetry for your geographic scope.")}
            />
          ))}
        </div>
      </StaffSection>
      <StaffSection title="Supply participants" description="Resource providers and operators — independent participants, not SAFARID employees or assets.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SUPPLY_PARTICIPANTS.map((p) => (
            <Card key={p.label}><CardContent className="pt-5">
              <div className="text-sm font-semibold">{p.label}</div>
              <p className="mt-1 text-sm text-muted-foreground">{p.provides}</p>
            </CardContent></Card>
          ))}
        </div>
      </StaffSection>
      <StaffSection title="Approved vocabulary"><ChipList items={SUPPLY_VOCABULARY} /></StaffSection>
    </>
  );
}

/* ------------------------------------------------------------- Customers */

export function StaffCustomers() {
  const { index, seeded } = useIntelligenceData();
  return (
    <>
      <StaffPageHeader eyebrow="Customer experience & success" title="Customer 360"
        lede="One common customer core with specialised archetypes — customers are not forced into a single simplistic CRM schema." />
      {seeded && <SeedBatchNotice batch={SEED_BATCH} />}
      {CUSTOMER_SEGMENTS.map((s) => (
        <StaffSection key={s.id} title={s.label} description={s.description}>
          <div className="grid gap-4 lg:grid-cols-3">
            <InfoCard title="Services purchased"><ChipList items={s.services} /></InfoCard>
            <InfoCard title="Customer 360 archetype">{s.archetype}</InfoCard>
            <InfoCard title="Commercial position">
              <MetricTile metric={pickMetric(index, "customer_segment", s.id, "accounts", "Accounts in scope")} />
              <MetricTile metric={pickMetric(index, "customer_segment", s.id, "ltv", "Lifetime value")} />
            </InfoCard>
          </div>
        </StaffSection>
      ))}
      <StaffSection title="Next best mobility" description="Cross-sell signals derive from actual behaviour and configured commercial rules only.">
        <ChipList items={["Airport transfers", "Executive travel", "Event mobility", "Charter", "Delivery", "Rental", "Leasing"]} />
      </StaffSection>
    </>
  );
}

/* ---------------------------------------------------------------- People */

export function StaffPeople() {
  return (
    <>
      <StaffPageHeader eyebrow="People, culture & organisation" title="Human Capital Operating System"
        lede="Capability, learning and workforce intelligence connected to customer, marketplace and revenue outcomes." />
      <StaffSection title="Modules"><ChipList items={PEOPLE_MODULES} /></StaffSection>
      <StaffSection title="SAFARID Capability Cloud" description="Organisational capability requirements mapped against employee capability.">
        <ChipList items={CAPABILITY_DOMAINS} />
        <div className="mt-3 text-xs text-muted-foreground">Levels: {CAPABILITY_LEVELS.join(" → ")}</div>
      </StaffSection>
      <StaffSection title="SAFARID Skill Graph" description="Claimed skills become verified through evidence.">
        <ChipList items={SKILL_EVIDENCE} />
      </StaffSection>
      <StaffSection title="Strategic workforce planning" description="Scenario models for growth, expansion and capability sourcing.">
        <ChipList items={WORKFORCE_SCENARIOS} />
      </StaffSection>
      <StaffSection title="SAFARID Academy" description="Learning recommendations derive from measured capability gaps.">
        <ChipList items={ACADEMY_TRACKS} />
      </StaffSection>
      <StaffSection title="Internal talent marketplace">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {["Projects", "Temporary assignments", "Cross-functional work", "Mentoring", "Innovation challenges", "Development opportunities"].map((l) => (
            <InfoCard key={l} title={l}>Opportunities are matched against your verified skill graph. No matches until skills and projects are recorded.</InfoCard>
          ))}
        </div>
      </StaffSection>
    </>
  );
}

/* ------------------------------------------------------------- Knowledge */

export function StaffKnowledge() {
  return (
    <>
      <StaffPageHeader eyebrow="Knowledge operating system" title="SAFARID Knowledge"
        lede="The authorised internal knowledge base. Staff-facing AI answers only from this corpus, within your data scope." />
      <StaffSection title="Content classes"><ChipList items={KNOWLEDGE_CLASSES} /></StaffSection>
      <StaffSection title="Decision register" description="SAFARID learns from its own organisational decisions.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DECISION_REGISTER_FIELDS.map((f) => (
            <Card key={f}><CardContent className="pt-5 text-sm font-medium">{f}</CardContent></Card>
          ))}
        </div>
      </StaffSection>
    </>
  );
}

/* ------------------------------------------------------------ Innovation */

export function StaffInnovation() {
  const { index, seeded } = useIntelligenceData();
  const portfolio = [
    { key: "ideas_submitted", label: "Ideas submitted" },
    { key: "in_experiment", label: "In experiment" },
    { key: "in_pilot", label: "In pilot" },
    { key: "scaled", label: "Scaled" },
  ];
  return (
    <>
      <StaffPageHeader eyebrow="Innovation lab" title="SAFARID Innovation Lab"
        lede="Ideas move through screening, business case, experiment and pilot — then scale or stop on evidence." />
      {seeded && <SeedBatchNotice batch={SEED_BATCH} />}
      <StaffSection title="Pipeline"><FlowChain steps={INNOVATION_PIPELINE} /></StaffSection>
      <StaffSection title="Evaluation criteria"><ChipList items={INNOVATION_CRITERIA} /></StaffSection>
      <StaffSection title="Portfolio">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {portfolio.map((p) => (
            <MetricTile key={p.key} metric={pickMetric(index, "innovation", "global", p.key, p.label)} />
          ))}
        </div>
      </StaffSection>
    </>
  );
}

/* ---------------------------------------------------------- Intelligence */

const FAMILIES: SignalFamily[] = ["revenue", "people", "marketplace", "organisation"];

export function StaffIntelligence() {
  const { index, signals, seeded } = useIntelligenceData({ withSignals: true });
  const byDomain = signalsByDomain(signals);
  return (
    <>
      <StaffPageHeader eyebrow="SAFARID intelligence layer" title="Enterprise Intelligence"
        lede="Contextual intelligence, not a generic chatbot. Every recommendation states why, evidence, confidence, expected impact, action and owner. AI never makes sensitive employment decisions autonomously." />
      {seeded && <SeedBatchNotice batch={SEED_BATCH} />}
      <StaffSection title="What requires leadership attention now?" description="Priorities are surfaced only from connected, authorised data.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {EXECUTIVE_DOMAINS.map((d) => (
            <InfoCard key={d.label} title={d.label}>
              <p>{d.detail}</p>
              <MetricTile metric={pickMetric(index, "attention", d.label, "signals", "Attention signals")} />
            </InfoCard>
          ))}
        </div>
      </StaffSection>
      {signals.length > 0 && (
        <StaffSection
          title="Open leadership signals"
          description="Each signal carries the full recommendation contract. AI proposes; a named owner decides."
        >
          <div className="space-y-8">
            {EXECUTIVE_DOMAINS.filter((d) => byDomain[d.label]?.length).map((d) => (
              <div key={d.label}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">{d.label}</h3>
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {byDomain[d.label].map((s) => (
                    <AttentionSignalCard key={s.id} signal={s} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </StaffSection>
      )}
      {FAMILIES.map((f) => (
        <StaffSection key={f} title={SIGNAL_FAMILY_LABEL[f]}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SIGNAL_KINDS.filter((k) => k.family === f).map((k) => (
              <InfoCard key={k.label} title={k.label}>{k.question}</InfoCard>
            ))}
          </div>
        </StaffSection>
      ))}
      <StaffSection
        title="Explained AI"
        description="Every insight and contract explanation discloses its data sources, its assumptions and its confidence. When a source is unresolved, no figure is produced."
      >
        <div className="mb-4"><ExplainedContractLegend /></div>
        <div className="grid gap-4 lg:grid-cols-3">
          {EXPLAINED_INSIGHTS.map((i) => (
            <ExplainedAiPanel key={i.title} insight={i} />
          ))}
        </div>
      </StaffSection>
      <StaffSection title="Recommendation contract"><ChipList items={RECOMMENDATION_CONTRACT} /></StaffSection>
      <StaffSection title="Organisational digital twin" description="Simulate structure, scale and capability before committing.">
        <ChipList items={TWIN_NODES} />
      </StaffSection>
    </>
  );
}

/* ------------------------------------------------------------ Governance */

export function StaffGovernance() {
  const { roles } = useAuth();
  return (
    <>
      <StaffPageHeader eyebrow="Governance" title="Access, audit & data controls"
        lede="Server-side policies remain the enforcement boundary. This surface shows the controls that shape what Staff 360 offers you." />
      <StaffSection title="Controls in force"><ChipList items={GOVERNANCE_CONTROLS} /></StaffSection>
      <StaffSection title="Your granted scopes"><ChipList items={[...scopesForRoles(roles)]} /></StaffSection>
      <StaffSection title="Universal search coverage" description="Each entity class resolves only within a scope you hold.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {UNIVERSAL_SEARCH_ENTITIES.map((e) => (
            <Card key={e.label}><CardContent className="pt-5">
              <div className="text-sm font-medium">{e.label}</div>
              <div className="text-xs text-muted-foreground">Requires scope: {e.scope}</div>
            </CardContent></Card>
          ))}
        </div>
      </StaffSection>
    </>
  );
}
