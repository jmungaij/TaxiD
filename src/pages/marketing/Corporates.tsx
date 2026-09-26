import { Link } from "react-router-dom";
import { FileText, Upload, Wallet, Building2, ShieldCheck, BarChart3, Map, Users, Settings, DollarSign, Calculator, FileSearch, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { Input } from "@/components/ui/input";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { CrossLinks } from "@/components/marketing/CrossLinks";
import corporatesImg from "@/assets/corporates.jpg";

const kycDocs = [
  "Certificate of Incorporation","CR12 Registration","KRA PIN Certificate","Tax Compliance Certificate",
  "County Business Permit","NSSF Registration","NHIF Registration","Industry Licenses",
];

const modules = [
  { icon: BarChart3, t: "Executive Control Panel", d: "Spend burn-down, financial exposure, risk heatmaps, approval bottlenecks." },
  { icon: Map, t: "Mobility Operations Center", d: "Live ride monitoring, mid-ride policy alerts, emergency overrides, fleet management." },
  { icon: Users, t: "Identity Command Center", d: "Employee lifecycle, spend velocity, risk scoring, compliance tracking." },
  { icon: Settings, t: "Policy Orchestration", d: "Dynamic travel policies, surge control, override management." },
  { icon: DollarSign, t: "Budget Intelligence", d: "Budget forecasting, cost center analytics, predictive alerts." },
  { icon: Calculator, t: "Finance & Ledger Control", d: "Double-entry accounting, reconciliation monitoring, ERP integration." },
  { icon: FileText, t: "Tax & Compliance", d: "VAT reporting, tax reconciliation, regulatory exports." },
  { icon: FileSearch, t: "Audit & Forensics", d: "Immutable audit logs, event replay, cryptographic validation, legal evidence exports." },
];

const Corporates = () => (
  <MarketingPage>
    <PageHero
      eyebrow="Corporate Mobility"
      title="Enterprise Mobility and Travel Governance Platform"
      subtitle="Control travel spend, compliance, approvals, budgets, and employee mobility from a single platform."
      image={corporatesImg}
      imageAlt="Corporate executive entering chauffeured Yalla Mobility vehicle"
    >
      <Button id="demo" size="lg" className="bg-ice text-primary hover:bg-ice/90" asChild><Link to="/contact?subject=enterprise-demo">Request Enterprise Demo <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
    </PageHero>

    {/* KYC */}
    <section className="container mx-auto px-4 py-20">
      <div className="text-center max-w-2xl mx-auto mb-12">
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">Onboarding</span>
        <h2 className="text-3xl font-bold mt-3 mb-3">Kenya KYC Module</h2>
        <p className="text-muted-foreground">OCR extraction, verification workflows, compliance status tracking and approval history — built in.</p>
      </div>
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="p-6 rounded-2xl bg-card border border-border">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Required Documents</h3>
          <div className="grid grid-cols-2 gap-2">
            {kycDocs.map((d) => (
              <div key={d} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-status-success mt-0.5 shrink-0" /><span>{d}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4">Upload formats: PDF, JPEG, PNG</p>
        </div>
        <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/5 to-primary-glow/5 border border-border">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><Upload className="h-5 w-5 text-primary" /> Start your KYC</h3>
          <div className="space-y-3">
            <Input placeholder="Company legal name" />
            <Input placeholder="KRA PIN" />
            <Input placeholder="Contact email" type="email" />
            <Input placeholder="Phone (+254...)" />
            <Button className="w-full" asChild><Link to="/auth?mode=register&audience=corporate">Begin Onboarding</Link></Button>
          </div>
        </div>
      </div>
    </section>

    {/* WALLETS */}
    <section className="bg-secondary/40 py-20">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl font-bold mb-3">Dual Wallet Architecture</h2>
          <p className="text-muted-foreground">Powered by M-Pesa Daraja for instant top-ups, payouts and reconciliation.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          <div className="p-6 rounded-2xl bg-card border border-border">
            <Building2 className="h-10 w-10 text-primary mb-3" />
            <h3 className="text-xl font-bold mb-2">Corporate Wallet</h3>
            <p className="text-sm text-muted-foreground mb-3">Company-funded · Policy governed · Budget controlled</p>
          </div>
          <div className="p-6 rounded-2xl bg-card border border-border">
            <Wallet className="h-10 w-10 text-primary mb-3" />
            <h3 className="text-xl font-bold mb-2">Personal Wallet</h3>
            <p className="text-sm text-muted-foreground mb-3">Employee-funded · Independent spending</p>
          </div>
        </div>
        <div className="mt-8 max-w-4xl mx-auto p-6 rounded-2xl bg-primary text-primary-foreground text-center">
          <p className="text-sm uppercase tracking-wider mb-1 opacity-80">M-Pesa Daraja</p>
          <p className="text-xl"><span className="font-bold">Paybill 4148095</span> · Settlement +254 142 970050</p>
        </div>
      </div>
    </section>

    {/* TRIP INTENT */}
    <section className="container mx-auto px-4 py-20">
      <h2 className="text-3xl font-bold text-center mb-3">Trip Intent System</h2>
      <p className="text-center text-muted-foreground mb-10">Every booking is classified before it touches the wallet.</p>
      <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        <div className="p-6 rounded-xl bg-primary/5 border border-primary/20">
          <h3 className="font-semibold text-primary mb-3">Business Trip</h3>
          <ul className="space-y-2 text-sm">
            {["Policy evaluation","Budget reservation","Manager approval","Corporate charge"].map(s => (
              <li key={s} className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-primary mt-0.5" />{s}</li>
            ))}
          </ul>
        </div>
        <div className="p-6 rounded-xl bg-primary/5 border border-primary/20">
          <h3 className="font-semibold text-primary mb-3">Personal Trip</h3>
          <ul className="space-y-2 text-sm">
            {["Employee charge","No escalation","Direct settlement"].map(s => (
              <li key={s} className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-status-success mt-0.5" />{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>

    {/* EXECUTIVE DASHBOARD */}
    <section className="bg-gradient-to-b from-secondary/30 to-background py-20">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <ShieldCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-3xl font-bold mb-3">Corporate Dashboard</h2>
          <p className="text-muted-foreground">Eight purpose-built modules for finance, operations, compliance and audit.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {modules.map((m) => (
            <div key={m.t} className="p-5 rounded-xl bg-card border border-border hover:shadow-elegant transition-all">
              <m.icon className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold mb-1">{m.t}</h3>
              <p className="text-xs text-muted-foreground">{m.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    <section id="accounts" className="container mx-auto px-4 py-20">
      <div className="rounded-3xl bg-primary p-10 md:p-14 text-center text-primary-foreground">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">See the corporate console in action.</h2>
        <p className="opacity-90 mb-8 max-w-xl mx-auto">Book a 30-minute walkthrough with our enterprise team.</p>
        <AppButton
          size="lg"
          analytics="corporate_book_demo"
          action="navigate"
          target="/contact?type=demo&audience=corporate"
          className="bg-ice text-primary hover:bg-ice/90"
        >
          Book Demo
        </AppButton>
      </div>
    </section>
    <CrossLinks
      heading="Related on Yalla"
      keys={["enterprise", "developers", "pricing", "delivery", "rentals", "careers"]}
    />
  </MarketingPage>
);

export default Corporates;
