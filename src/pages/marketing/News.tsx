import { Calendar } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Badge } from "@/components/ui/badge";

const posts = [
  { cat: "Press Release", date: "2026-06-01", t: "SAFARID raises Series B to scale corporate mobility across Africa", d: "Funding round led by regional growth investors will accelerate enterprise rollouts." },
  { cat: "Product Update", date: "2026-05-12", t: "Trip Intent v2: smarter business vs personal classification", d: "Cuts misclassified expenses by 38% in pilot enterprises." },
  { cat: "Safety", date: "2026-04-22", t: "New in-app SOS partnership with Kenya Red Cross", d: "Faster emergency dispatch and integrated incident reporting." },
  { cat: "Partnership", date: "2026-03-08", t: "Safaricom Business x SAFARID: native M-Pesa Daraja settlement", d: "Instant driver payouts and corporate reconciliation at scale." },
];

const News = () => (
  <MarketingPage>
    <PageHero eyebrow="Newsroom" title="What's new at SAFARID." subtitle="Product updates, partnerships, safety announcements and press releases." />
    <section className="container mx-auto px-4 py-16 max-w-4xl">
      <div className="space-y-6">
        {posts.map((p) => (
          <article key={p.t} className="p-6 rounded-xl bg-card border border-border hover:shadow-elegant transition-all">
            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
              <Badge variant="secondary">{p.cat}</Badge>
              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(p.date).toLocaleDateString()}</span>
            </div>
            <h2 className="text-xl font-bold mb-2">{p.t}</h2>
            <p className="text-muted-foreground">{p.d}</p>
          </article>
        ))}
      </div>
    </section>
  </MarketingPage>
);

export default News;
