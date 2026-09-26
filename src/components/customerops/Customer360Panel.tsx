/**
 * Customer Operations — Customer 360° panel.
 *
 * One screen that aggregates profile, bookings (rides, deliveries, charters),
 * wallet activity, invoices, receipts, payments, refunds, complaints and
 * support history for the customer on the selected case.
 *
 * Composed exclusively from frozen primitives + shadcn atoms.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  UserCircle2,
  Wallet,
  ReceiptText,
  CreditCard,
  RotateCcw,
  MessageSquareWarning,
  Car,
  Package,
  Plane,
  FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import StatCard from "@/components/common/StatCard";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";

export interface Customer360Identity {
  userId: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  corporateAccountId?: string | null;
  caseNumber?: string | null;
}

type Row = Record<string, unknown>;

interface Bundle {
  profile: Row | null;
  trips: Row[];
  deliveries: Row[];
  charters: Row[];
  wallet: Row[];
  payments: Row[];
  refunds: Row[];
  invoices: Row[];
  cases: Row[];
}

const EMPTY: Bundle = {
  profile: null,
  trips: [],
  deliveries: [],
  charters: [],
  wallet: [],
  payments: [],
  refunds: [],
  invoices: [],
  cases: [],
};

const kes = (cents: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(cents / 100);

const money = (amount: number, currency = "KES") =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

const day = (v: unknown) => (typeof v === "string" ? new Date(v).toLocaleDateString() : "—");
const stamp = (v: unknown) => (typeof v === "string" ? new Date(v).toLocaleString() : "—");
const str = (v: unknown, fallback = "—") => (typeof v === "string" && v ? v : fallback);
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

function ListSection({
  title,
  icon: Icon,
  items,
  emptyLabel,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: { key: string; primary: string; secondary?: string; badge?: string }[];
  emptyLabel: string;
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        {title}
        <span className="text-xs text-muted-foreground">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.key} className="rounded-md border px-2.5 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{i.primary}</span>
                {i.badge && (
                  <Badge variant="outline" className="text-[10px]">
                    {i.badge}
                  </Badge>
                )}
              </div>
              {i.secondary && <p className="text-muted-foreground">{i.secondary}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Customer360Panel({ identity }: { identity: Customer360Identity | null }) {
  const [data, setData] = useState<Bundle>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uid = identity?.userId ?? null;
  const email = identity?.email ?? null;
  const phone = identity?.phone ?? null;
  const corporateId = identity?.corporateAccountId ?? null;

  const load = useCallback(async () => {
    if (!identity) return;
    setLoading(true);
    setError(null);
    try {
      const none = Promise.resolve({ data: [] as Row[], error: null });
      const [profile, trips, deliveries, charters, wallet, payments, refunds, invoices, cases] = await Promise.all([
        uid
          ? untypedDb.from("profiles").select("user_id,full_name,phone,avatar_url,created_at").eq("user_id", uid).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        uid
          ? untypedDb
              .from("trip_bookings")
              .select("id,booking_number,status,total_fare,payment_method,pickup_address,dropoff_address,created_at")
              .eq("rider_user_id", uid)
              .order("created_at", { ascending: false })
              .limit(10)
          : none,
        uid
          ? untypedDb
              .from("delivery_orders")
              .select("id,order_number,status,total_amount,currency,payment_status,created_at")
              .eq("customer_id", uid)
              .order("created_at", { ascending: false })
              .limit(10)
          : none,
        uid
          ? untypedDb
              .from("charter_bookings")
              .select("id,reference,asset_name,status,payment_status,amount,currency,mpesa_receipt,created_at")
              .eq("user_id", uid)
              .order("created_at", { ascending: false })
              .limit(10)
          : none,
        uid
          ? untypedDb
              .from("wallet_transactions")
              .select("id,amount_cents,kind,status,created_at")
              .eq("user_id", uid)
              .order("created_at", { ascending: false })
              .limit(10)
          : none,
        uid
          ? untypedDb
              .from("fact_payments")
              .select("id,amount_cents,currency,status,payment_method,paid_at,created_at")
              .eq("rider_id", uid)
              .order("created_at", { ascending: false })
              .limit(10)
          : none,
        uid
          ? untypedDb
              .from("refund_requests")
              .select("id,amount_cents,currency,status,reason,created_at")
              .eq("requested_by", uid)
              .order("created_at", { ascending: false })
              .limit(10)
          : none,
        corporateId
          ? untypedDb
              .from("corporate_invoices")
              .select("id,invoice_number,status,total_cents,balance_cents,currency,issued_at,due_at")
              .eq("corporate_id", corporateId)
              .order("issued_at", { ascending: false })
              .limit(10)
          : none,
        uid
          ? untypedDb
              .from("support_cases")
              .select("id,case_number,subject,category,status,priority,satisfaction_score,created_at,resolved_at")
              .eq("requester_user_id", uid)
              .order("created_at", { ascending: false })
              .limit(15)
          : email
            ? untypedDb
                .from("support_cases")
                .select("id,case_number,subject,category,status,priority,satisfaction_score,created_at,resolved_at")
                .eq("requester_email", email)
                .order("created_at", { ascending: false })
                .limit(15)
            : none,
      ]);

      setData({
        profile: (profile.data ?? null) as Row | null,
        trips: (trips.data ?? []) as Row[],
        deliveries: (deliveries.data ?? []) as Row[],
        charters: (charters.data ?? []) as Row[],
        wallet: (wallet.data ?? []) as Row[],
        payments: (payments.data ?? []) as Row[],
        refunds: (refunds.data ?? []) as Row[],
        invoices: (invoices.data ?? []) as Row[],
        cases: (cases.data ?? []) as Row[],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the customer profile");
    } finally {
      setLoading(false);
    }
  }, [identity, uid, email, corporateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const bookings = data.trips.length + data.deliveries.length + data.charters.length;
    const lifetimeCents =
      data.payments.reduce((s, p) => s + num(p.amount_cents), 0) +
      data.charters.reduce((s, c) => s + Math.round(num(c.amount) * 100), 0);
    const walletNet = data.wallet.reduce(
      (s, w) => s + (String(w.kind).includes("debit") ? -num(w.amount_cents) : num(w.amount_cents)),
      0,
    );
    const openInvoiceCents = data.invoices.reduce((s, i) => s + num(i.balance_cents), 0);
    const refundedCents = data.refunds
      .filter((r) => String(r.status) === "completed" || String(r.status) === "executed")
      .reduce((s, r) => s + num(r.amount_cents), 0);
    const complaints = data.cases.length;
    const csatScores = data.cases
      .map((c) => num(c.satisfaction_score))
      .filter((n) => n > 0);
    return {
      bookings,
      lifetimeCents,
      walletNet,
      openInvoiceCents,
      refundedCents,
      complaints,
      openComplaints: data.cases.filter((c) => !c.resolved_at).length,
      csat: csatScores.length ? Math.round((csatScores.reduce((a, b) => a + b, 0) / csatScores.length) * 10) / 10 : null,
    };
  }, [data]);

  if (!identity) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-muted-foreground">
          <UserCircle2 className="mx-auto mb-2 h-6 w-6" aria-hidden />
          <p className="font-medium text-foreground">Select a case to open Customer 360°</p>
          <p className="mt-1 text-sm">
            Opening a case loads the customer's profile, bookings, wallet, invoices, receipts, payments, refunds and
            complaint history on one screen.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isEmpty =
    !loading &&
    !data.profile &&
    totals.bookings +
      data.wallet.length +
      data.payments.length +
      data.refunds.length +
      data.invoices.length +
      data.cases.length ===
      0;

  return (
    <SectionErrorBoundary sectionName="Customer 360">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Lifetime value"
            value={kes(totals.lifetimeCents)}
            icon={<CreditCard className="h-5 w-5 text-primary" />}
            description={`${data.payments.length} settled payments`}
          />
          <StatCard
            title="Bookings on record"
            value={totals.bookings}
            icon={<Car className="h-5 w-5 text-primary" />}
            description="Rides, deliveries and charters"
          />
          <StatCard
            title="Wallet net movement"
            value={kes(totals.walletNet)}
            icon={<Wallet className="h-5 w-5 text-primary" />}
            description={`${data.wallet.length} ledger entries`}
          />
          <StatCard
            title="Complaints"
            value={totals.complaints}
            icon={<MessageSquareWarning className="h-5 w-5 text-primary" />}
            description={`${totals.openComplaints} open · CSAT ${totals.csat ?? "—"}`}
          />
        </div>

        <AsyncState
          loading={loading}
          error={error}
          isEmpty={isEmpty}
          emptyTitle="No linked customer record"
          emptyMessage="This case has no signed-in customer linked, so booking, wallet and billing history is unavailable."
          onRetry={() => void load()}
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserCircle2 className="h-4 w-4" aria-hidden />
                  Profile
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <dl className="space-y-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Name</dt>
                    <dd className="font-medium">
                      {str(data.profile?.full_name, identity.name ?? "Unknown customer")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Email</dt>
                    <dd className="truncate">{str(email)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Phone</dt>
                    <dd>{str(data.profile?.phone, phone ?? "—")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Customer since</dt>
                    <dd>{day(data.profile?.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Account type</dt>
                    <dd>
                      <Badge variant="outline">{corporateId ? "Corporate" : "Personal"}</Badge>
                    </dd>
                  </div>
                </dl>
                <Separator />
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Open invoice balance: <span className="font-medium text-foreground">{kes(totals.openInvoiceCents)}</span></p>
                  <p>Refunded to date: <span className="font-medium text-foreground">{kes(totals.refundedCents)}</span></p>
                  {identity.caseNumber && <p>Viewing from case {identity.caseNumber}</p>}
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Bookings</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <ListSection
                  title="Rides"
                  icon={Car}
                  emptyLabel="No rides on record"
                  items={data.trips.map((t) => ({
                    key: String(t.id),
                    primary: str(t.booking_number, "Ride"),
                    secondary: `${day(t.created_at)} · ${money(num(t.total_fare))}`,
                    badge: str(t.status),
                  }))}
                />
                <ListSection
                  title="Deliveries"
                  icon={Package}
                  emptyLabel="No deliveries on record"
                  items={data.deliveries.map((d) => ({
                    key: String(d.id),
                    primary: str(d.order_number, "Delivery"),
                    secondary: `${day(d.created_at)} · ${money(num(d.total_amount), str(d.currency, "KES"))}`,
                    badge: str(d.status),
                  }))}
                />
                <ListSection
                  title="Charters"
                  icon={Plane}
                  emptyLabel="No charters on record"
                  items={data.charters.map((c) => ({
                    key: String(c.id),
                    primary: str(c.reference, "Charter"),
                    secondary: `${str(c.asset_name, "asset")} · ${money(num(c.amount), str(c.currency, "KES"))}`,
                    badge: str(c.status),
                  }))}
                />
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Money trail</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <ListSection
                  title="Payments"
                  icon={CreditCard}
                  emptyLabel="No payments captured"
                  items={data.payments.map((p) => ({
                    key: String(p.id),
                    primary: kes(num(p.amount_cents)),
                    secondary: `${str(p.payment_method, "method n/a")} · ${stamp(p.paid_at ?? p.created_at)}`,
                    badge: str(p.status),
                  }))}
                />
                <ListSection
                  title="Receipts"
                  icon={ReceiptText}
                  emptyLabel="No receipts issued"
                  items={data.charters
                    .filter((c) => c.mpesa_receipt)
                    .map((c) => ({
                      key: `rcpt-${c.id}`,
                      primary: str(c.mpesa_receipt),
                      secondary: `${str(c.reference)} · ${money(num(c.amount), str(c.currency, "KES"))}`,
                      badge: str(c.payment_status, "paid"),
                    }))
                    .concat(
                      data.payments
                        .filter((p) => String(p.status) === "succeeded" || String(p.status) === "captured")
                        .map((p) => ({
                          key: `rcpt-pay-${p.id}`,
                          primary: `Receipt ${String(p.id).slice(0, 8).toUpperCase()}`,
                          secondary: `${kes(num(p.amount_cents))} · ${stamp(p.paid_at ?? p.created_at)}`,
                          badge: "eTIMS",
                        })),
                    )}
                />
                <ListSection
                  title="Invoices"
                  icon={FileText}
                  emptyLabel={corporateId ? "No invoices issued" : "Personal accounts are receipted, not invoiced"}
                  items={data.invoices.map((i) => ({
                    key: String(i.id),
                    primary: str(i.invoice_number),
                    secondary: `${kes(num(i.total_cents))} · balance ${kes(num(i.balance_cents))} · due ${day(i.due_at)}`,
                    badge: str(i.status),
                  }))}
                />
                <ListSection
                  title="Refunds"
                  icon={RotateCcw}
                  emptyLabel="No refunds requested"
                  items={data.refunds.map((r) => ({
                    key: String(r.id),
                    primary: kes(num(r.amount_cents)),
                    secondary: `${str(r.reason, "no reason recorded")} · ${day(r.created_at)}`,
                    badge: str(r.status),
                  }))}
                />
                <div className="sm:col-span-2">
                  <ListSection
                    title="Wallet activity"
                    icon={Wallet}
                    emptyLabel="No wallet activity"
                    items={data.wallet.map((w) => ({
                      key: String(w.id),
                      primary: `${str(w.kind)} · ${kes(num(w.amount_cents))}`,
                      secondary: stamp(w.created_at),
                      badge: str(w.status),
                    }))}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Complaints & support history</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[360px] px-6 pb-6">
                  {data.cases.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No prior cases for this customer.</p>
                  ) : (
                    <ol className="space-y-3">
                      {data.cases.map((c) => (
                        <li key={String(c.id)} className="border-l-2 border-border pl-3">
                          <p className="text-sm font-medium">
                            {str(c.case_number)} · {str(c.subject)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {day(c.created_at)} · {str(c.category)} · {str(c.priority)}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge variant="outline" className="text-[10px]">
                              {str(c.status)}
                            </Badge>
                            {num(c.satisfaction_score) > 0 && (
                              <Badge variant="secondary" className="text-[10px]">
                                CSAT {num(c.satisfaction_score)}/5
                              </Badge>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </AsyncState>
      </div>
    </SectionErrorBoundary>
  );
}
