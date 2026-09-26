import { Link } from "react-router-dom";
import { Building2, Clock, Headphones, ShieldCheck } from "lucide-react";
import { ContactForm } from "@/components/marketing/ContactForm";

const assurances = [
  { icon: Clock, title: "Reply within one business day", desc: "Every enquiry reaches a named Yalla Mobility specialist." },
  { icon: Building2, title: "Built for enterprise scale", desc: "Travel policy, cost centres, approvals and consolidated invoicing." },
  { icon: ShieldCheck, title: "Compliance ready", desc: "Business verification, insurance validity and audit trails from day one." },
  { icon: Headphones, title: "Dedicated onboarding", desc: "Guided rollout for your employees, driver partners and fleet operators." },
];

const TalkToSales = () => (
  <section id="talk-to-sales" className="scroll-mt-24 border-y border-border bg-secondary/30 py-20">
    <div className="container mx-auto px-4">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Talk to Sales</span>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">Talk to Yalla Mobility.</h2>
          <p className="mt-4 max-w-xl text-muted-foreground">
            Tell us how your organisation moves people, goods or assets. We will recommend the right mix of
            rides, corporate mobility, charter, rental, leasing and logistics — and help you get started.
          </p>

          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {assurances.map((a) => (
              <div key={a.title} className="flex gap-3">
                <a.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold">{a.title}</p>
                  <p className="text-sm text-muted-foreground">{a.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-8 text-sm text-muted-foreground">
            Prefer a longer conversation?{" "}
            <Link to="/contact" className="font-medium text-primary underline">
              Visit our contact centre
            </Link>{" "}
            or{" "}
            <Link to="/corporates" className="font-medium text-primary underline">
              explore corporate mobility
            </Link>
            .
          </p>
        </div>

        <ContactForm
          type="sales"
          sourcePage="/#talk-to-sales"
          showCompany
          showEmployeeCount
          submitLabel="Talk to Sales"
          heading="Request a tailored proposal"
          subheading="Share a few details and a Yalla Mobility specialist will be in touch."
        />
      </div>
    </div>
  </section>
);

export default TalkToSales;
