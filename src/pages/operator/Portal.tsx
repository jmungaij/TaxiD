/**
 * OPERATOR PORTAL — one place for the person doing the work.
 *
 * A driver, fleet operator, charter operator or truck owner sees only their own
 * work and their own money here: rides, the statement of each fulfilled trip,
 * the wallet, and every withdrawal on its real approval path. Every figure is
 * read from the platform's own records; nothing is calculated in the browser.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { SeoHead } from "@/components/seo/SeoHead";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { Wallet } from "lucide-react";
import DriverRides from "@/components/provider/DriverRides";
import ProviderInvoices from "@/components/provider/ProviderInvoices";
import ProviderPayoutAccount from "@/components/provider/ProviderPayoutAccount";
import ProviderPayoutNumbers from "@/components/provider/ProviderPayoutNumbers";
import {
  PAYOUT_STATE_LABEL,
  loadProviderSettlementSelf,
  settlementMoney,
} from "@/lib/provider/settlement";

const when = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

/** The operator's own withdrawals, each with where it has reached. */
function MyPayoutQueue() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["provider-settlement-self"],
    queryFn: loadProviderSettlementSelf,
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  const w = data!.wallet;
  const rows = data!.payouts ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" />
            My wallet
          </CardTitle>
          <CardDescription>
            Money is held until a trip is fulfilled, then becomes available to withdraw. A{" "}
            {(data!.withdrawal_fee_bps / 100).toFixed(0)}% fee applies only when a withdrawal actually
            succeeds.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Available to withdraw", value: w.available_cents },
            { label: "Held until fulfilment", value: w.held_cents },
            { label: "Set aside for a withdrawal", value: w.reserved_cents },
            { label: "Paid out so far", value: w.lifetime_withdrawn_cents },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-lg font-semibold">{settlementMoney(k.value, w.currency)}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My withdrawals ({rows.length})</CardTitle>
          <CardDescription>
            Each withdrawal is checked, approved by our finance team, released and then sent to your
            M-Pesa number. It shows as paid only once Safaricom confirms it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have not requested a withdrawal yet.
            </p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
                <div className="space-y-1">
                  <p className="font-mono text-xs text-muted-foreground">{r.reference}</p>
                  <p className="text-sm font-semibold">
                    {settlementMoney(r.amount_cents, r.currency)} to {r.msisdn}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Requested {when(r.created_at)}
                    {r.paid_at ? ` · paid ${when(r.paid_at)}` : ""}
                  </p>
                  {r.failure_reason && <p className="text-xs text-destructive">{r.failure_reason}</p>}
                </div>
                <Badge variant={r.state === "PAID" ? "default" : r.state === "FAILED" ? "destructive" : "outline"}>
                  {PAYOUT_STATE_LABEL[r.state]}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function OperatorPortal() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <MarketingLayout>
        <div className="container mx-auto px-4 py-16">
          <Skeleton className="h-64 w-full" />
        </div>
      </MarketingLayout>
    );
  }

  if (!user) {
    return (
      <MarketingLayout>
        <div className="container mx-auto px-4 py-16">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Please sign in</CardTitle>
              <CardDescription>
                Sign in to see your rides, your statements and your withdrawals.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link to="/auth?redirect=/operator">Sign in</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </MarketingLayout>
    );
  }

  return (
    <MarketingLayout>
      <div className="container mx-auto space-y-6 px-4 py-12">
        <SeoHead
          path="/operator"
          title="Operator Portal — Your Rides, Statements and Payouts"
          description="Drivers, fleet operators, charter and logistics operators see their own rides, statements, wallet and withdrawals in one place."
        />

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">My work and my money</h1>
            <p className="text-sm text-muted-foreground">
              Your rides, what each fulfilled trip earned you, your wallet and every withdrawal on its
              way to your M-Pesa number.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/provider/capacity">Vehicles, documents &amp; availability</Link>
          </Button>
        </header>

        <Tabs defaultValue="rides" className="space-y-4">
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="rides">My rides</TabsTrigger>
            <TabsTrigger value="statements">Statements</TabsTrigger>
            <TabsTrigger value="wallet">Wallet &amp; withdrawals</TabsTrigger>
            <TabsTrigger value="queue">Payout queue</TabsTrigger>
            <TabsTrigger value="numbers">My M-Pesa numbers</TabsTrigger>
          </TabsList>

          <TabsContent value="rides" className="space-y-4">
            <DriverRides />
          </TabsContent>

          <TabsContent value="statements" className="space-y-4">
            <ProviderInvoices />
          </TabsContent>

          <TabsContent value="wallet" className="space-y-4">
            <ProviderPayoutAccount />
          </TabsContent>

          <TabsContent value="queue" className="space-y-4">
            <MyPayoutQueue />
          </TabsContent>

          <TabsContent value="numbers" className="space-y-4">
            <ProviderPayoutNumbers />
          </TabsContent>
        </Tabs>
      </div>
    </MarketingLayout>
  );
}
