/**
 * /enterprise/demo — a guided walkthrough of how a company books corporate
 * rides with policy checks, manager approval and spend visibility.
 *
 * This is a DEMONSTRATION: every figure on the page is sample data held in
 * component state. Nothing is written to the platform and no real booking is
 * created. Real bookings, policies and spend live in the corporate dashboard.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, BadgeCheck, Car, CheckCircle2, RotateCcw, ShieldCheck, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import corporatesImg from "@/assets/corporates.jpg";
import { useAuth } from "@/hooks/useAuth";


const SAMPLE_TRIP = {
  employee: "Aisha Mwangi — Sales",
  route: "ABC Place, Westlands → Jomo Kenyatta International Airport",
  when: "Tomorrow, 07:30",
  vehicle: "Executive sedan",
  estimate: 4800,
  costCentre: "SALES-KE-01",
};

const SAMPLE_POLICY = {
  perTripCap: 4000,
  monthlyBudget: 250000,
  monthToDate: 118400,
  approver: "Daniel Otieno — Finance Director",
};

const money = (n: number) => `KSh ${n.toLocaleString("en-KE")}`;

const STEPS = ["Employee books", "Policy check", "Manager approval", "Spend view"] as const;

const CORPORATE_ROLES = ["corporate_admin", "corporate_manager", "corporate_employee", "admin", "super_admin"];

const EnterpriseDemo = () => {
  const { roles } = useAuth();
  const hasCorporateAccess = roles.some((r) => CORPORATE_ROLES.includes(r));
  const [step, setStep] = useState(0);
  const [decision, setDecision] = useState<"pending" | "approved" | "declined">("pending");


  const overCap = SAMPLE_TRIP.estimate > SAMPLE_POLICY.perTripCap;
  const committed =
    SAMPLE_POLICY.monthToDate + (decision === "approved" ? SAMPLE_TRIP.estimate : 0);

  const reset = () => {
    setStep(0);
    setDecision("pending");
  };

  return (
    <MarketingPage>
      <PageHero
        eyebrow="Enterprise walkthrough"
        title="See a corporate booking move through approval and spend control"
        subtitle="A guided demonstration using sample data. No real booking is created and nothing is charged."
        image={corporatesImg}
        imageAlt="Corporate traveller booking a Yalla Mobility ride"
      >
        <Button size="lg" className="bg-ice text-primary hover:bg-ice/90" asChild>
          <Link to="/corporate/register" data-analytics="enterprise-demo-open-account">
            Open a corporate account <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </PageHero>

      <section className="container mx-auto px-4 py-16" aria-labelledby="demo-flow">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>
              Demonstration only — the names, amounts and limits below are sample data.
            </span>
          </div>

          {hasCorporateAccess && (
            <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
              <p className="font-medium">Your organisation is already set up.</p>
              <p className="mt-1 text-muted-foreground">
                Book a real ride against your own limits, approvers and cost centres.
              </p>
              <Button className="mt-3" asChild>
                <Link to="/dashboard/corporate/trips/request" data-analytics="enterprise-demo-live-request">
                  Request a real ride <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          )}


          <h2 id="demo-flow" className="mt-8 text-2xl font-bold tracking-tight md:text-3xl">
            {STEPS[step]}
          </h2>

          <ol className="mt-4 flex flex-wrap gap-2" aria-label="Walkthrough steps">
            {STEPS.map((s, i) => (
              <li key={s}>
                <Badge variant={i === step ? "default" : "outline"}>{i + 1}. {s}</Badge>
              </li>
            ))}
          </ol>

          <div className="mt-8 space-y-4 rounded-xl border border-border bg-card p-6">
            {step === 0 && (
              <>
                <Car className="h-6 w-6 text-primary" aria-hidden="true" />
                <h3 className="text-lg font-semibold">Trip request</h3>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Employee</dt><dd>{SAMPLE_TRIP.employee}</dd></div>
                  <div><dt className="text-muted-foreground">When</dt><dd>{SAMPLE_TRIP.when}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-muted-foreground">Route</dt><dd>{SAMPLE_TRIP.route}</dd></div>
                  <div><dt className="text-muted-foreground">Vehicle</dt><dd>{SAMPLE_TRIP.vehicle}</dd></div>
                  <div><dt className="text-muted-foreground">Cost centre</dt><dd>{SAMPLE_TRIP.costCentre}</dd></div>
                  <div><dt className="text-muted-foreground">Estimate</dt><dd>{money(SAMPLE_TRIP.estimate)}</dd></div>
                </dl>
              </>
            )}

            {step === 1 && (
              <>
                <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
                <h3 className="text-lg font-semibold">Company policy check</h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    {overCap
                      ? <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" aria-hidden="true" />
                      : <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />}
                    Per-trip cap {money(SAMPLE_POLICY.perTripCap)} — this trip is {money(SAMPLE_TRIP.estimate)}
                    {overCap ? ", so approval is required." : ", within policy."}
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
                    Cost centre {SAMPLE_TRIP.costCentre} is active and funded.
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
                    Monthly budget {money(SAMPLE_POLICY.monthlyBudget)} — {money(SAMPLE_POLICY.monthToDate)} used so far.
                  </li>
                </ul>
                <p className="text-sm text-muted-foreground">
                  Routed to {SAMPLE_POLICY.approver} for a decision.
                </p>
              </>
            )}

            {step === 2 && (
              <>
                <BadgeCheck className="h-6 w-6 text-primary" aria-hidden="true" />
                <h3 className="text-lg font-semibold">Manager decision</h3>
                <p className="text-sm text-muted-foreground">
                  {SAMPLE_POLICY.approver} sees the trip, the policy exception and the remaining budget.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setDecision("approved")} data-analytics="enterprise-demo-approve">
                    Approve trip
                  </Button>
                  <Button variant="outline" onClick={() => setDecision("declined")} data-analytics="enterprise-demo-decline">
                    Decline
                  </Button>
                </div>
                {decision !== "pending" && (
                  <p className="text-sm">
                    Decision recorded in this demonstration: <strong>{decision === "approved" ? "Approved" : "Declined"}</strong>.
                  </p>
                )}
              </>
            )}

            {step === 3 && (
              <>
                <Wallet className="h-6 w-6 text-primary" aria-hidden="true" />
                <h3 className="text-lg font-semibold">Spend view</h3>
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-muted-foreground">Monthly budget</dt><dd>{money(SAMPLE_POLICY.monthlyBudget)}</dd></div>
                  <div><dt className="text-muted-foreground">Committed</dt><dd>{money(committed)}</dd></div>
                  <div><dt className="text-muted-foreground">Remaining</dt><dd>{money(SAMPLE_POLICY.monthlyBudget - committed)}</dd></div>
                </dl>
                <p className="text-sm text-muted-foreground">
                  {decision === "approved"
                    ? "The approved trip is committed against the cost centre and appears on the monthly statement."
                    : "Nothing was committed — a declined or unapproved trip never reaches the statement."}
                </p>
              </>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              {step > 0 && (
                <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button
                  onClick={() => setStep(step + 1)}
                  disabled={step === 2 && decision === "pending"}
                  data-analytics="enterprise-demo-next-step"
                >
                  Next step <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              ) : (
                <Button variant="outline" onClick={reset} data-analytics="enterprise-demo-restart">
                  <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Start again
                </Button>
              )}
            </div>
          </div>

          <div className="mt-10 rounded-xl border border-border bg-secondary/20 p-6">
            <h3 className="text-lg font-semibold">Run this with your own policies</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Corporate accounts set their own caps, cost centres, approvers and budgets, and see live
              bookings, approvals and invoices.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild><Link to="/corporate/register">Open a corporate account</Link></Button>
              <Button variant="outline" asChild><Link to="/corporate">Read the company profile</Link></Button>
            </div>
          </div>
        </div>
      </section>
    </MarketingPage>
  );
};

export default EnterpriseDemo;
