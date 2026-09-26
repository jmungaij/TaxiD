import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Car, Handshake, GraduationCap, MapPin, ArrowRight, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import {
  EMPLOYMENT_TYPE_LABELS,
  WORK_ARRANGEMENT_LABELS,
  labelFor,
  listPublicVacancies,
  PUBLIC_VACANCY_QUERY_OPTIONS,
} from "@/lib/recruitment/publicApi";

const sections = [
  { icon: Briefcase, t: "Open Positions", d: "Every role below is published live from our recruitment system." },
  { icon: Car, t: "Driver Opportunities", d: "Become a SAFARID driver partner across Africa." },
  { icon: Handshake, t: "Partner Programs", d: "Fleet partners, corporate resellers, integrators." },
  { icon: GraduationCap, t: "Internship Programs", d: "12-week paid internships across the continent." },
];


const Careers = () => {
  const vacancies = useQuery({
    queryKey: ["public", "vacancies"],
    queryFn: listPublicVacancies,
    ...PUBLIC_VACANCY_QUERY_OPTIONS,
  });

  return (
    <MarketingPage>
      <PageHero
        eyebrow="Careers"
        title="Build mobility's future with us."
        subtitle="Join a team obsessed with moving Africa forward — safely, profitably and sustainably."
      />

      <section className="container mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold mb-6">Ways to join SAFARID</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {sections.map((s) => (
            <div key={s.t} className="p-6 rounded-xl bg-card border border-border">
              <s.icon className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold mb-1">{s.t}</h3>
              <p className="text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>

        <h2 id="partners" className="text-2xl font-bold mb-6">Open Positions</h2>

        <div className="space-y-3 max-w-3xl">
          {vacancies.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          ) : vacancies.error ? (
            <div className="p-6 rounded-xl bg-card border border-border">
              <p className="font-semibold">Open positions are temporarily unavailable</p>
              <p className="text-sm text-muted-foreground mt-1">
                Please try again shortly, or{" "}
                <Link to="/contact" className="underline">contact our team</Link>.
              </p>
            </div>
          ) : (vacancies.data ?? []).length === 0 ? (
            <div className="p-8 rounded-xl bg-card border border-border text-center">
              <p className="font-semibold">No current openings</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                We are not advertising any roles right now. New vacancies appear here the moment they are
                published by our recruitment team.
              </p>
            </div>
          ) : (
            (vacancies.data ?? []).map((v) => (
              <Link
                key={v.id}
                to={`/careers/${v.public_slug}`}
                className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-5 rounded-xl bg-card border border-border hover:border-primary/40 transition-all"
              >
                <div>
                  <h3 className="font-semibold">{v.title}</h3>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" aria-hidden="true" />{v.location ?? "Location flexible"}
                    </span>
                    <Badge variant="outline">{labelFor(EMPLOYMENT_TYPE_LABELS, v.employment_type)}</Badge>
                    <Badge variant="outline">{labelFor(WORK_ARRANGEMENT_LABELS, v.work_arrangement)}</Badge>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      Ref {v.vacancy_no}
                    </span>
                  </div>
                </div>
                <span className="inline-flex items-center text-sm font-medium text-primary">
                  View & apply <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
                </span>
              </Link>
            ))
          )}
        </div>
      </section>
    </MarketingPage>
  );
};

export default Careers;
