/**
 * DRIVER PORTAL — projection only.
 *
 * Every figure on this screen is returned by an authoritative server record or
 * by `driver_portal_summary()`. Nothing is computed, totalled or assumed in the
 * browser, and no placeholder amount is ever rendered: when there is no
 * authoritative record the screen says so.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  driverPortalSummary, listMyEarnings, listMyTrips, listMyPayouts,
  listMyPayoutMethods, listMyDriverDocuments, listMyWalletTransactions,
  requestDriverWithdrawal, kes,
  type DriverPortalSummary, type DriverEarningRow, type DriverTripRow,
  type DriverPayoutRow, type DriverPayoutMethodRow, type DriverDocumentRow,
} from "@/lib/drivers/portal";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Loader2, Wallet, Car, FileText, Banknote } from "lucide-react";

const tone = (s: string) => {
  const v = (s || "").toUpperCase();
  if (["AVAILABLE", "VERIFIED", "SUCCESS", "COMPLETED", "ACTIVE", "PAID", "APPROVED"].includes(v))
    return "bg-status-success/10 text-status-success border-status-success/30";
  if (["REJECTED", "FAILED", "REVERSED", "CANCELLED", "EXPIRED", "DISPUTED"].includes(v))
    return "bg-destructive/10 text-destructive border-destructive/30";
  return "bg-status-warning/10 text-status-warning border-status-warning/30";
};

const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("en-KE") : "—");

export default function DriverPortal() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DriverPortalSummary | null>(null);
  const [earnings, setEarnings] = useState<DriverEarningRow[]>([]);
  const [trips, setTrips] = useState<DriverTripRow[]>([]);
  const [payouts, setPayouts] = useState<DriverPayoutRow[]>([]);
  const [methods, setMethods] = useState<DriverPayoutMethodRow[]>([]);
  const [documents, setDocuments] = useState<DriverDocumentRow[]>([]);
  const [walletTxns, setWalletTxns] = useState<Awaited<ReturnType<typeof listMyWalletTransactions>>>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await driverPortalSummary();
      setSummary(s);
      if (!s.is_driver || !s.driver) return;
      const [e, t, p, m, d, w] = await Promise.all([
        listMyEarnings(), listMyTrips(s.driver.id), listMyPayouts(),
        listMyPayoutMethods(), listMyDriverDocuments(), listMyWalletTransactions(),
      ]);
      setEarnings(e); setTrips(t); setPayouts(p); setMethods(m); setDocuments(d); setWalletTxns(w);
      setMethodId((prev) => prev || m.find((x) => x.verified && x.is_default)?.id || m.find((x) => x.verified)?.id || "");
    } catch (err) {
      toast({ title: "Could not load your portal", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const availableCents = summary?.earnings?.available_cents ?? 0;
  const walletCents = summary?.wallet?.balance_cents ?? 0;
  const inFlightCents = summary?.payouts?.in_flight_cents ?? 0;
  const withdrawable = Math.max(walletCents - inFlightCents, 0);

  const verifiedMethods = useMemo(() => methods.filter((m) => m.verified), [methods]);

  async function submitWithdrawal() {
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      return toast({ title: "Enter a valid amount", variant: "destructive" });
    }
    if (!methodId) return toast({ title: "Select a verified payout destination", variant: "destructive" });
    setBusy(true);
    const res = await requestDriverWithdrawal({
      amountCents: cents,
      methodId,
      // stable per driver + amount + minute: a double-click cannot create two payouts
      idempotencyKey: `dwd:${user?.id}:${cents}:${new Date().toISOString().slice(0, 16)}`,
    });
    setBusy(false);
    if (res?.error) {
      return toast({
        title: "Withdrawal refused",
        description: `${res.code ?? "ERROR"}${res.message ? ` — ${res.message}` : ""}`,
        variant: "destructive",
      });
    }
    toast({
      title: res.replay ? "Existing request returned" : "Withdrawal requested",
      description: "Finance must authorise the payout before any money moves.",
    });
    setOpen(false); setAmount("");
    await load();
  }

  if (loading) {
    return <main className="p-8"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></main>;
  }

  if (!summary?.is_driver || !summary.driver) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-bold">Driver portal</h1>
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>No driver record for this account</CardTitle>
            <CardDescription>
              This portal opens once your driver application has been approved and your driver
              record is active. Apply or check your application status first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link to="/driver/apply">Go to driver application</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const d = summary.driver;
  const financiallyActive = d.status === "active";

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{d.name || "Driver"}</h1>
          <p className="text-sm text-muted-foreground">
            {d.driver_code ?? "—"} · {d.carrier_name ? `Fleet Owner: ${d.carrier_name}` : "No fleet owner attributed"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={tone(d.status)}>Driver: {d.status}</Badge>
          <Badge variant="outline" className={tone(d.application_status ?? "")}>
            Application: {d.application_status ?? "—"}
          </Badge>
          <Badge variant="outline" className={tone(d.verification_status ?? "")}>
            Verification: {d.verification_status ?? "—"}
          </Badge>
        </div>
      </header>

      {!financiallyActive && (
        <Card className="border-status-warning/40">
          <CardHeader>
            <CardTitle className="text-base">Earnings and withdrawals are closed</CardTitle>
            <CardDescription>
              Your driver record is <strong>{d.status}</strong>. Trips, earnings and payouts open only
              while the record is active and verified.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2"><Wallet className="h-4 w-4" aria-hidden /> Wallet balance</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.wallet?.exists ? kes(walletCents) : "No wallet yet"}</p>
            <p className="text-xs text-muted-foreground">
              {inFlightCents > 0 ? `${kes(inFlightCents)} reserved for a payout in progress` : "Nothing reserved"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Available to withdraw</CardDescription></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{withdrawable > 0 ? kes(withdrawable) : "No available balance"}</p>
            <p className="text-xs text-muted-foreground">Released earnings: {kes(availableCents)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Pending earnings</CardDescription></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {(summary.earnings?.pending_cents ?? 0) > 0 ? kes(summary.earnings?.pending_cents) : "None pending"}
            </p>
            <p className="text-xs text-muted-foreground">Awaiting confirmed customer payment</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2"><Car className="h-4 w-4" aria-hidden /> Trips</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.trips?.completed ?? 0}</p>
            <p className="text-xs text-muted-foreground">
              {(summary.trips?.total ?? 0) === 0 ? "No completed trips" : `${summary.trips?.total} total · ${summary.trips?.cancelled} cancelled`}
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Today", summary.earnings?.today_cents],
          ["This week", summary.earnings?.week_cents],
          ["This month", summary.earnings?.month_cents],
          ["Lifetime", summary.earnings?.lifetime_cents],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardHeader className="pb-2"><CardDescription>{label as string}</CardDescription></CardHeader>
            <CardContent>
              <p className="text-xl font-semibold">
                {(value as number) > 0 ? kes(value as number) : "No earnings yet"}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={!financiallyActive || withdrawable <= 0 || verifiedMethods.length === 0}>
              <Banknote className="mr-2 h-4 w-4" aria-hidden /> Request withdrawal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request a withdrawal</DialogTitle>
              <DialogDescription>
                Available {kes(withdrawable)}. Minimum KES 50. Finance authorises the payout; money
                moves only when the provider confirms the disbursement.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="wd-amount">Amount (KES)</Label>
                <Input id="wd-amount" inputMode="decimal" value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder="50" />
              </div>
              <div>
                <Label htmlFor="wd-method">Verified destination</Label>
                <select id="wd-method" className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                  value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                  <option value="">Select…</option>
                  {verifiedMethods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.method_type} ····{(m.msisdn ?? m.bank_account ?? "").slice(-4)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => void submitWithdrawal()} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Submit request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {verifiedMethods.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No verified payout destination on file — finance must verify your M-Pesa number before you can withdraw.
          </p>
        )}
      </div>

      <Tabs defaultValue="trips">
        <TabsList>
          <TabsTrigger value="trips">Trips</TabsTrigger>
          <TabsTrigger value="earnings">Earnings</TabsTrigger>
          <TabsTrigger value="wallet">Wallet</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="trips">
          <Card>
            <CardHeader><CardTitle className="text-base">My trips</CardTitle></CardHeader>
            <CardContent>
              {trips.length === 0 ? (
                <p className="text-sm text-muted-foreground">No completed trips.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trip</TableHead><TableHead>Route</TableHead>
                      <TableHead>Status</TableHead><TableHead>Fare</TableHead>
                      <TableHead>Payment</TableHead><TableHead>Earning</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trips.map((t) => {
                      const e = earnings.find((x) => x.booking_id === t.id);
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium">
                            {t.booking_number ?? t.id.slice(0, 8)}
                            <div className="text-xs text-muted-foreground">{dt(t.completed_at ?? t.created_at)}</div>
                          </TableCell>
                          <TableCell className="max-w-[260px] text-xs">
                            {t.pickup_address ?? "—"} → {t.dropoff_address ?? "—"}
                          </TableCell>
                          <TableCell><Badge variant="outline" className={tone(t.status)}>{t.status}</Badge></TableCell>
                          <TableCell>{t.total_fare != null ? `KES ${t.total_fare}` : "—"}</TableCell>
                          <TableCell className="text-xs">{t.payment_status ?? "—"}</TableCell>
                          <TableCell>
                            {e ? (
                              <>
                                {kes(e.net_cents)}
                                <div className="text-xs text-muted-foreground">{e.state}</div>
                              </>
                            ) : <span className="text-xs text-muted-foreground">Not accrued</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="earnings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Earning records</CardTitle>
              <CardDescription>
                Gross fare less the commission rate held on each record. Amounts cannot be edited.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {earnings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No earnings yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead><TableHead>Service</TableHead>
                      <TableHead>Gross</TableHead><TableHead>Commission</TableHead>
                      <TableHead>Net</TableHead><TableHead>State</TableHead><TableHead>Class</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {earnings.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">
                          {e.earning_reference}
                          <div className="text-xs text-muted-foreground">{dt(e.accrued_at)}</div>
                        </TableCell>
                        <TableCell className="text-xs">{e.service_line}</TableCell>
                        <TableCell>{kes(e.gross_cents)}</TableCell>
                        <TableCell>
                          {kes(e.commission_cents)}
                          <div className="text-xs text-muted-foreground">{(e.commission_bps / 100).toFixed(2)}%</div>
                        </TableCell>
                        <TableCell className="font-semibold">{kes(e.net_cents)}</TableCell>
                        <TableCell><Badge variant="outline" className={tone(e.state)}>{e.state}</Badge></TableCell>
                        <TableCell className="text-xs">{e.data_class}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="wallet">
          <Card>
            <CardHeader><CardTitle className="text-base">Wallet movements</CardTitle></CardHeader>
            <CardContent>
              {walletTxns.length === 0 ? (
                <p className="text-sm text-muted-foreground">No wallet movements yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead><TableHead>Type</TableHead>
                      <TableHead>Reference</TableHead><TableHead>Status</TableHead><TableHead>Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {walletTxns.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="text-xs">{dt(w.created_at)}</TableCell>
                        <TableCell className="text-xs">{w.kind}</TableCell>
                        <TableCell className="text-xs">{w.reference ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline" className={tone(w.status)}>{w.status}</Badge></TableCell>
                        <TableCell className={w.direction === "credit" ? "text-status-success" : "text-destructive"}>
                          {w.direction === "credit" ? "+" : "−"}{kes(w.amount_cents)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payouts">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Withdrawal and payout history</CardTitle>
              <CardDescription>A payout reads PAID only when the provider result is recorded.</CardDescription>
            </CardHeader>
            <CardContent>
              {payouts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No withdrawals requested yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead><TableHead>Requested</TableHead>
                      <TableHead>Destination</TableHead><TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead><TableHead>Provider reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payouts.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.reference ?? p.id.slice(0, 8)}</TableCell>
                        <TableCell className="text-xs">{dt(p.created_at)}</TableCell>
                        <TableCell className="text-xs">
                          {String((p.metadata as { destination_type?: string })?.destination_type ?? "—")}
                          {" ····"}
                          {String((p.metadata as { destination_masked?: string })?.destination_masked ?? "")}
                        </TableCell>
                        <TableCell>{kes(p.amount_cents)}</TableCell>
                        <TableCell><Badge variant="outline" className={tone(p.status)}>{p.status}</Badge></TableCell>
                        <TableCell className="text-xs">{p.provider_txn_id ?? "Not disbursed"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" aria-hidden /> My documents
              </CardTitle>
              <CardDescription>
                {(summary.documents?.expired ?? 0) > 0
                  ? "One or more documents have expired — your operational eligibility is affected."
                  : "Only your own submitted evidence is shown."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents submitted yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead><TableHead>Number</TableHead>
                      <TableHead>Issued</TableHead><TableHead>Expires</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium">{doc.doc_label ?? doc.doc_type ?? "—"}</TableCell>
                        <TableCell className="text-xs">{doc.document_number ?? "—"}</TableCell>
                        <TableCell className="text-xs">{doc.issue_date ?? "—"}</TableCell>
                        <TableCell className="text-xs">{doc.expiry_date ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={tone(doc.status ?? "")}>{doc.status ?? "—"}</Badge>
                          {doc.rejection_reason && (
                            <div className="text-xs text-destructive">{doc.rejection_reason}</div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Server-computed at {dt(summary.generated_at)}. Earnings marked TEST are controlled test records
        and are excluded from production reporting.
      </p>
    </main>
  );
}
