/**
 * DRIVER ONBOARDING PORTAL — /driver/start
 *
 * Three real steps, in order: create the account, save the M-Pesa payout number
 * (our team verifies it before any money moves), then take the guided welcome
 * ride through the portal. Presentation and orchestration only — every step
 * calls existing, authoritative backend routines.
 */
import { CheckCircle2, Circle } from "lucide-react";
import { MarketingPage } from "@/components/marketing/PageHero";
import { SeoHead } from "@/components/seo/SeoHead";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppButton } from "@/components/nav/AppButton";
import DriverAccountStep from "@/components/driver/DriverAccountStep";
import DriverWelcomeTour from "@/components/driver/DriverWelcomeTour";
import ProviderPayoutNumbers from "@/components/provider/ProviderPayoutNumbers";
import { useAuth } from "@/hooks/useAuth";

function StepHeader({ n, title, blurb, done }: { n: number; title: string; blurb: string; done?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      {done ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      ) : (
        <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Step {n} — {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
      </div>
    </div>
  );
}

export default function DriverStart() {
  const { user, authLoading } = useAuth();

  return (
    <MarketingPage>
      <SeoHead
        path="/driver/start"
        title="Start Driving with TaxiD — Driver Sign-up"
        description="Create your TaxiD driver account, confirm the M-Pesa number your earnings are paid to, and take a guided tour of the driver portal."
      />

      <section className="container mx-auto px-4 py-12 md:py-16">
        <Badge variant="outline">Driver onboarding</Badge>
        <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">Start driving with TaxiD</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Three steps: create your account, tell us the M-Pesa number your money should go to, and take a short
          welcome ride through the portal so you know where your trips, earnings and payouts live.
        </p>

        <div className="mt-10 space-y-10">
          <div className="space-y-4">
            <StepHeader
              n={1}
              title="Create your account"
              blurb="Your email and password. You can come back to any step later."
              done={!!user}
            />
            {authLoading ? <Skeleton className="h-48 w-full" /> : <DriverAccountStep user={user} />}
          </div>

          <div className="space-y-4">
            <StepHeader
              n={2}
              title="Confirm your payout number"
              blurb="The M-Pesa number your earnings are sent to. Our team verifies it before any money is sent."
              done={false}
            />
            {user ? (
              <ProviderPayoutNumbers />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Create your account first</CardTitle>
                  <CardDescription>
                    Once you are signed in, you can save your M-Pesa number here and set which one is the default.
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <StepHeader n={3} title="Take your welcome ride" blurb="A guided tour of the driver portal." />
            <DriverWelcomeTour />
          </div>

          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-base">Next: your driver application</CardTitle>
              <CardDescription>
                Paid trips start once your licence, insurance and vehicle inspection are submitted and approved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AppButton analytics="driver_start_continue_application" action="navigate" target="/driver/apply">
                Continue to my application
              </AppButton>
            </CardContent>
          </Card>
        </div>
      </section>
    </MarketingPage>
  );
}
