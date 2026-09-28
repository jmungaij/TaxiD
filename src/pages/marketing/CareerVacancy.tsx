import { useEffect } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import {
  ArrowLeft, ArrowRight, Briefcase, Building2, CalendarClock, Clock3,
  MapPin, Target, UserRound, Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { MarketingPage } from "@/components/marketing/PageHero";
import {
  EMPLOYMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_LABELS,
  experienceLabel,
  getPublicVacancyDetail,
  labelFor,
  positionsLabel,
  PUBLIC_VACANCY_QUERY_OPTIONS,
  type PublicVacancyDetail,
  getPublicInternship,
  internshipOutcomeList,
  trackAnnouncementEvent,
} from "@/lib/recruitment/publicApi";

const SITE = "https://yalla-africa.lovable.app";

function Section({
  id, title, children,
}: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="py-10 border-t border-border first:border-0 first:pt-0">
      <h2 id={id} className="text-xl font-semibold tracking-tight mb-5">{title}</h2>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
          <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
          <span>{i}</span>
        </li>
      ))}
    </ul>
  );
}

function MetaItem({
  icon: Icon, label, value,
}: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium break-words">{value}</dd>
      </div>
    </div>
  );
}

/** Public-facing long-form date, e.g. "10 September 2026". ISO input is data, not presentation. */
function longDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * A vacancy title carries both the programme identity and its scope, separated by
 * an em/en dash. The identity is the display title; the scope becomes the
 * category line so the headline never has to carry the whole string.
 */
/** Location strings may already carry the country; never print "Nairobi, Kenya, Kenya". */
function placeLabel(location: string): string {
  return /kenya/i.test(location) ? location.trim() : `${location.trim()}, Kenya`;
}

function splitProgrammeTitle(title: string): { identity: string; scope: string | null } {
  const [identity, ...rest] = title.split(/\s+[—–-]\s+/);
  if (rest.length === 0) return { identity: title.trim(), scope: null };
  const scope = rest
    .flatMap((part) => part.split(/\s*[,•·]\s*/))
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
  return { identity: identity.trim(), scope: scope || null };
}


function jobPostingSchema(v: PublicVacancyDetail, url: string) {

  const employmentType =
    v.employment_type === "permanent" ? "FULL_TIME"
      : v.employment_type === "internship" ? "INTERN"
        : v.employment_type === "part_time" ? "PART_TIME"
          : "CONTRACTOR";

  const description = [
    v.role_purpose ?? v.public_summary ?? "",
    ...v.accountability_groups.map((g) => `${g.group}: ${g.bullets.join(" ")}`),
  ].filter(Boolean).join(" ");

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: v.title,
    description,
    identifier: { "@type": "PropertyValue", name: "TaxiD", value: v.vacancy_no },
    hiringOrganization: { "@type": "Organization", name: "TaxiD", sameAs: SITE },
    employmentType,
    url,
    jobLocationType: v.work_arrangement === "remote" ? "TELECOMMUTE" : undefined,
    totalJobOpenings: v.headcount,
  };
  if (v.published_at) schema.datePosted = v.published_at.slice(0, 10);
  if (v.application_deadline) schema.validThrough = v.application_deadline;
  if (v.location) {
    schema.jobLocation = {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: v.location, addressCountry: "KE" },
    };
  }
  if (v.min_years_experience) {
    schema.experienceRequirements = {
      "@type": "OccupationalExperienceRequirements",
      monthsOfExperience: Math.round(Number(v.min_years_experience) * 12),
    };
  }
  return schema;
}

export default function CareerVacancy() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const q = useQuery({
    queryKey: ["public", "vacancy-detail", slug],
    queryFn: () => getPublicVacancyDetail(slug),
    ...PUBLIC_VACANCY_QUERY_OPTIONS,
  });

  // Internship programmes carry a public announcement block. Only the
  // visitor-safe fields are served; internal scoring and selection controls are
  // not part of the public contract.
  const internship = useQuery({
    queryKey: ["public", "internship", slug],
    queryFn: () => getPublicInternship(slug),
    ...PUBLIC_VACANCY_QUERY_OPTIONS,
  });

  // Funnel signal: one anonymous view per resolved announcement. The server
  // caps repeats, and no candidate identity is involved.
  const viewSlug = q.data?.canonical_slug ?? (q.data?.open ? slug : "");
  useEffect(() => {
    if (viewSlug) trackAnnouncementEvent(viewSlug, "VIEW");
  }, [viewSlug]);

  // An outdated or corrected link resolves through the alias table; move the
  // visitor to the canonical URL without losing their place in history.
  const canonical = q.data?.canonical_slug;
  useEffect(() => {
    if (canonical && canonical !== slug) {
      navigate(`/careers/${canonical}${location.search}`, { replace: true });
    }
  }, [canonical, slug, navigate, location.search]);

  if (q.isLoading) {
    return (
      <MarketingPage>
        <div className="container mx-auto px-4 py-24 space-y-4 max-w-3xl">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-40" />
        </div>
      </MarketingPage>
    );
  }

  // A vacancy that is unpublished, paused, closed or archived is not returned by
  // the server-side publication query, so its public URL resolves to this state.
  if (q.error || !q.data?.open || !q.data.vacancy) {
    const networkIssue = !!q.error;
    return (
      <MarketingPage>
        <div className="container mx-auto px-4 py-24 max-w-2xl text-center">
          <h1 className="text-2xl font-bold mb-3">
            {networkIssue ? "We could not load this position" : "Applications are closed for this position"}
          </h1>
          <p className="text-muted-foreground mb-6">
            {networkIssue
              ? "There was a problem reaching our recruitment service. Please try again in a moment."
              : "This vacancy is not currently open for applications. It may have been filled, paused or withdrawn."}
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            {networkIssue && (
              <Button onClick={() => q.refetch()}>Try again</Button>
            )}
            <Button asChild variant={networkIssue ? "outline" : "default"}>
              <Link to="/careers">View current openings <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link>
            </Button>
          </div>
        </div>
      </MarketingPage>
    );
  }

  const v = q.data.vacancy;
  const others = q.data.other_openings ?? [];
  const url = `${SITE}/careers/${q.data.canonical_slug ?? slug}`;
  const applyHref = `/careers/${q.data.canonical_slug ?? slug}/apply`;
  const contract = labelFor(EMPLOYMENT_TYPE_LABELS, v.employment_type);
  const arrangement = labelFor(WORK_ARRANGEMENT_LABELS, v.work_arrangement);
  const programme = splitProgrammeTitle(v.title);

  const experience = experienceLabel(v.min_years_experience);
  const prog = internship.data;
  const pageTitle = prog
    ? `${v.title} Internship Programme | TaxiD`
    : `${v.title} | TaxiD Careers`;
  const metaDescription = (
    prog
      ? prog.summary
        ?? prog.programme_purpose
        ?? `Apply for the ${v.title} internship programme at TaxiD${prog.duration_weeks ? ` — ${prog.duration_weeks} weeks` : ""}${v.location ? `, ${v.location}` : ""}.`
      : v.public_summary ?? v.role_purpose ?? `Apply for the ${v.title} role at TaxiD.`
  ).slice(0, 155);

  return (
    <MarketingPage>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={url} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={url} />
        <meta property="og:image" content="https://yalla-africa.lovable.app/og-taxid-1200x630.png" />
        <meta name="twitter:image" content="https://yalla-africa.lovable.app/og-taxid-1200x630.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={metaDescription} />
        <script type="application/ld+json">{JSON.stringify(jobPostingSchema(v, url))}</script>
      </Helmet>

      {/* ---------------- Vacancy header ---------------- */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 pt-10 pb-8 max-w-4xl">
          <Link
            to={`/careers${location.search}`}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> All openings
          </Link>

          <p className="mt-6 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            TaxiD · Reference {v.vacancy_no}
          </p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">{v.title}</h1>
          {v.public_summary ? (
            <p className="mt-3 text-base text-muted-foreground max-w-2xl leading-relaxed">{v.public_summary}</p>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            {v.location ? <Badge variant="outline" className="gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />{placeLabel(v.location)}</Badge> : null}
            <Badge variant="outline" className="gap-1"><Briefcase className="h-3 w-3" aria-hidden="true" />{contract}</Badge>
            <Badge variant="outline" className="gap-1"><Building2 className="h-3 w-3" aria-hidden="true" />{arrangement}</Badge>
            <Badge variant="outline" className="gap-1"><Users className="h-3 w-3" aria-hidden="true" />{positionsLabel(v.headcount)}</Badge>
            {experience ? <Badge variant="outline" className="gap-1"><Clock3 className="h-3 w-3" aria-hidden="true" />{experience}</Badge> : null}
          </div>

          <div className="mt-7">
            <AppButton
              size="lg"
              className="h-auto max-w-full whitespace-normal py-3 text-left"
              analytics="career_vacancy_apply_hero"
              action="navigate"
              target={applyHref}
              trackingMeta={{ vacancy: v.title }}
            >
              Apply for {programme.identity} <ArrowRight className="ml-1 h-4 w-4 shrink-0" aria-hidden="true" />
            </AppButton>
          </div>

        </div>
      </header>

      <div className="container mx-auto px-4 py-10 max-w-4xl pb-28 md:pb-16">
        {internship.data ? (
          <section
            aria-labelledby="internship-programme"
            className="mb-10 overflow-hidden rounded-2xl border border-primary/20 bg-primary text-primary-foreground shadow-lg"
          >
            <div className="px-5 py-8 sm:px-8 sm:py-10">
              <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.18em] text-ice">
                YMEITA · TaxiD internship programme
              </p>
              {/* Identity first: the programme title is never the mission statement. */}
              <h2
                id="internship-programme"
                className="mt-3 max-w-[26ch] break-words text-[clamp(1.75rem,5vw,3rem)] font-bold leading-[1.08] tracking-tight"
              >
                {programme.identity}
              </h2>
              {programme.scope ? (
                <p className="mt-3 max-w-[60ch] break-words text-xs sm:text-sm font-medium uppercase tracking-[0.1em] text-ice">
                  {programme.scope}
                </p>
              ) : null}
              {internship.data.programme_purpose ? (
                /* Long mandates read as body copy; a short proposition earns display scale. */
                <p
                  className={
                    internship.data.programme_purpose.length > 320
                      ? "mt-5 max-w-[68ch] break-words text-[clamp(0.95rem,1.4vw,1.05rem)] leading-[1.6] text-primary-foreground"
                      : "mt-5 max-w-[46ch] break-words text-[clamp(1.05rem,2.1vw,1.5rem)] leading-[1.42] text-primary-foreground"
                  }
                >
                  {internship.data.programme_purpose}
                </p>
              ) : null}

              {internship.data.summary ? (
                <p className="mt-4 max-w-[72ch] break-words whitespace-pre-line text-sm sm:text-[0.95rem] leading-[1.65] text-ice">
                  {internship.data.summary}
                </p>
              ) : null}
              <dl className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Duration", value: internship.data.duration_weeks ? `${internship.data.duration_weeks} weeks` : null },
                  { label: "Starts", value: longDate(internship.data.start_date) },
                  { label: "Applications close", value: longDate(internship.data.application_deadline) },
                  { label: "Host function", value: internship.data.host_function ?? internship.data.business_unit },
                  { label: "Location", value: v.location ? placeLabel(v.location) : null },
                  { label: "Work arrangement", value: arrangement },
                  { label: "Intake", value: v.headcount ? `${v.headcount} place${v.headcount === 1 ? "" : "s"}` : null },
                  { label: "Internship type", value: internship.data.internship_type },
                ]
                  .filter((f) => !!f.value)
                  .map((f) => (
                    <div
                      key={f.label}
                      className="min-w-0 rounded-lg border border-primary-foreground/15 bg-primary-foreground/10 px-4 py-3 supports-[backdrop-filter]:backdrop-blur-sm"
                    >
                      <dt className="text-[11px] uppercase tracking-[0.1em] text-ice">{f.label}</dt>
                      <dd className="mt-1 break-words text-[0.95rem] font-semibold leading-snug">{f.value}</dd>
                    </div>
                  ))}
              </dl>
            </div>

            <div className="grid gap-6 border-t border-primary-foreground/15 bg-background px-6 py-7 text-foreground sm:px-8 md:grid-cols-3">
              {[
                { t: "What you will do", body: internship.data.what_you_will_do },
                { t: "What you will learn", body: internship.data.what_you_will_learn },
                { t: "Who should apply", body: internship.data.who_should_apply },
              ]
                .filter((c) => !!c.body)
                .map((c) => (
                  <div key={c.t}>
                    <h3 className="text-sm font-semibold">{c.t}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{c.body}</p>
                  </div>
                ))}
            </div>
            {(internshipOutcomeList(internship.data.learning_outcomes).length > 0 ||
              (internship.data.practical_capabilities ?? []).length > 0 ||
              (internship.data.required_documents ?? []).length > 0) && (
              <div className="grid gap-6 border-t border-border bg-background px-6 py-7 text-foreground sm:px-8 md:grid-cols-3">
                {[
                  { t: "Outcomes you leave with", items: internshipOutcomeList(internship.data.learning_outcomes) },
                  { t: "Capabilities you will practise", items: internship.data.practical_capabilities ?? [] },
                  { t: "Documents to bring", items: internship.data.required_documents ?? [] },
                ]
                  .filter((c) => c.items.length > 0)
                  .map((c) => (
                    <div key={c.t}>
                      <h3 className="text-sm font-semibold">{c.t}</h3>
                      <ul className="mt-2 space-y-2">
                        {c.items.map((i) => (
                          <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            <span>{i}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}
          </section>
        ) : null}

        {v.role_purpose ? (
          <Section id="about-the-role" title="About the role">
            <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{v.role_purpose}</p>
          </Section>
        ) : null}

        {v.accountability_groups.length > 0 ? (
          <Section id="what-you-will-do" title="What you will do">
            <div className="space-y-8">
              {v.accountability_groups.map((g) => (
                <div key={g.group}>
                  <h3 className="text-base font-semibold mb-3">{g.group}</h3>
                  <Bullets items={g.bullets} />
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        <Section id="what-we-are-looking-for" title="What we are looking for">
          <div className="space-y-8">
            {(v.qualification_level || v.qualifications.length > 0) && (
              <div>
                <h3 className="text-base font-semibold mb-2">Minimum qualification</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {v.qualification_level ?? "Relevant qualification"}
                  {v.qualifications.length > 0
                    ? ` in ${v.qualifications.join(", ")}, or a related discipline.`
                    : "."}
                </p>
                {v.equivalent_experience_accepted ? (
                  <p className="text-sm text-muted-foreground mt-2">
                    Equivalent professional experience that demonstrates the same competence will also be considered.
                  </p>
                ) : null}
              </div>
            )}

            {v.experience_statement ? (
              <div>
                <h3 className="text-base font-semibold mb-2">Experience</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{v.experience_statement}</p>
              </div>
            ) : null}

            {v.required_skills.length > 0 && (
              <div>
                <h3 className="text-base font-semibold mb-1">Required capabilities</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Candidates should meet these criteria to be considered.
                </p>
                <div className="flex flex-wrap gap-2">
                  {v.required_skills.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
                </div>
              </div>
            )}

            {v.technical_tools.length > 0 && (
              <div>
                <h3 className="text-base font-semibold mb-3">Tools you will use</h3>
                <div className="flex flex-wrap gap-2">
                  {v.technical_tools.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
                </div>
              </div>
            )}

            {v.preferred_skills.length > 0 && (
              <div>
                <h3 className="text-base font-semibold mb-1">Preferred experience</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Advantageous, but not mandatory.
                </p>
                <div className="flex flex-wrap gap-2">
                  {v.preferred_skills.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
                </div>
              </div>
            )}

            {v.competencies.length > 0 && (
              <div>
                <h3 className="text-base font-semibold mb-3">Core competencies</h3>
                <Bullets items={v.competencies} />
              </div>
            )}
          </div>
        </Section>

        {v.success_outcomes.length > 0 ? (
          <Section id="what-success-looks-like" title="What success looks like">
            <Bullets items={v.success_outcomes} />
          </Section>
        ) : null}

        {v.suitability.length > 0 ? (
          <Section id="who-this-may-suit" title="Who this role may suit">
            <p className="text-sm text-muted-foreground mb-3">This role may suit you if:</p>
            <Bullets items={v.suitability} />
          </Section>
        ) : null}

        <Section id="role-details" title="Role details">
          <dl className="grid gap-x-8 sm:grid-cols-2 divide-y divide-border sm:divide-y-0">
            {v.location ? <MetaItem icon={MapPin} label="Location" value={placeLabel(v.location)} /> : null}
            <MetaItem icon={Building2} label="Work arrangement" value={arrangement} />
            <MetaItem icon={Briefcase} label="Contract" value={contract} />
            {experience ? <MetaItem icon={Clock3} label="Experience" value={experience} /> : null}
            {v.department ? <MetaItem icon={Target} label="Department" value={v.department} /> : null}
            {v.reports_to ? <MetaItem icon={UserRound} label="Reports to" value={v.reports_to} /> : null}
            <MetaItem icon={Users} label="Positions available" value={String(v.headcount)} />
            {v.application_deadline ? (
              <MetaItem
                icon={CalendarClock}
                label="Application deadline"
                value={new Date(v.application_deadline).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
              />
            ) : null}
          </dl>
        </Section>

        {v.recruitment_process.length > 0 ? (
          <Section id="recruitment-process" title="Recruitment process">
            <ol className="space-y-5">
              {v.recruitment_process.map((s, i) => (
                <li key={s.step} className="flex gap-4">
                  <span
                    aria-hidden="true"
                    className="h-7 w-7 shrink-0 rounded-full bg-primary/10 text-primary text-sm font-semibold flex items-center justify-center"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-medium text-sm">{s.step}</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground mt-5">
              Stages vary by role, so not every candidate will take part in every stage.
            </p>
          </Section>
        ) : null}

        <Section id="ready-to-apply" title="Ready to apply?">
          <div className="p-6 rounded-xl bg-card border border-border">
            <p className="text-sm text-muted-foreground mb-4 max-w-xl leading-relaxed">
              Submit your application through TaxiD's secure recruitment portal. Your application enters
              our recruitment system immediately and you will receive an application reference you can quote.
              Your personal data is handled in line with our{" "}
              <Link to="/privacy" className="underline">recruitment privacy notice</Link>, which is shown in full
              before you submit.
            </p>
            <AppButton
              size="lg"
              className="h-auto max-w-full whitespace-normal py-3 text-left"
              analytics="career_vacancy_apply_footer"
              action="navigate"
              target={applyHref}
              trackingMeta={{ vacancy: v.title }}
            >
              Apply for {programme.identity} <ArrowRight className="ml-1 h-4 w-4 shrink-0" aria-hidden="true" />
            </AppButton>

          </div>
        </Section>

        {others.length > 0 ? (
          <Section id="other-opportunities" title="Other opportunities">
            <div className="space-y-3">
              {others.map((o) => (
                <Link
                  key={o.public_slug}
                  to={`/careers/${o.public_slug}`}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div>
                    <p className="font-medium">{o.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {[o.location, labelFor(EMPLOYMENT_TYPE_LABELS, o.employment_type), labelFor(WORK_ARRANGEMENT_LABELS, o.work_arrangement)]
                        .filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-primary inline-flex items-center">
                    View role <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
                  </span>
                </Link>
              ))}
            </div>
          </Section>
        ) : null}

        <Separator className="sm:hidden" />
      </div>

      {/* Sticky mobile apply bar — keyboard reachable, no layout overflow. */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur px-4 py-3">
        <AppButton
          className="w-full max-w-full whitespace-normal"
          size="lg"
          analytics="career_vacancy_apply_sticky"
          action="navigate"
          target={applyHref}
          trackingMeta={{ vacancy: v.title }}
        >
          Apply for {programme.identity}
        </AppButton>

      </div>
    </MarketingPage>
  );
}
