/**
 * STAFF PAYOUT CONSOLE — Fleet Owner and Driver money, side by side.
 *
 * Read-only projection of the authoritative wallet/payable/payout records plus
 * the existing decision RPCs. Nothing here marks money paid: PAID requires the
 * provider result recorded by the disbursement path.
 */
import { useCallback, useEffect, useState } from "react";
import {
  listFleetOwnerMoney, listDriverMoney, listDriverPayoutQueue, listAllEarnings,
  accrueDriverEarning, releaseDriverEarning, decideDriverWithdrawal,
  type FleetOwnerMoneyRow, type DriverMoneyRow, type DriverPayoutQueueRow, type StaffEarningRow,
  type Outcome,
} from "@/lib/finance/payoutConsole";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw } from "lucide-react";

const kesFromCents = (c: number) =>
  `KES ${(c / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const kesPlain = (v: number) =>
  `KES ${Number(v).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const tone = (s: string) => {
  const v = (s || "").toUpperCase();
  if (["ACTIVE", "MATCHABLE", "SUCCESS", "AVAILABLE", "RELEASED", "PAID", "VERIFIED"].includes(v))
    return "bg-status-success/10 text-status-success border-status-success/30";
  if (["FAILED", "REJECTED", "CANCELLED", "REVERSED", "SUSPENDED"].includes(v))
    return "bg-destructive/10 text-destructive border-destructive/30";
  return "bg-status-warning/10 text-status-warning border-status-warning/30";
};

export default function PayoutConsole() {
  const [owners, setOwners] = useState<FleetOwnerMoneyRow[]>([]);
  const [drivers, setDrivers] = useState<DriverMoneyRow[]>([]);
  const [queue, setQueue] = useState<DriverPayoutQueueRow[]>([]);
  const [earnings, setEarnings] = useState<StaffEarningRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const [o, d, q, e] = await Promise.all([
        listFleetOwnerMoney(), listDriverMoney(), listDriverPayoutQueue(), listAllEarnings(),
      ]);
      setOwners(o); setDrivers(d); setQueue(q); setEarnings(e);
      setRefreshedAt(new Date().toLocaleTimeString("en-KE"));
    } catch (err) {
      toast({ title: "Could not load payout data", description: (err as Error).message, variant: "destructive" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => { void load(); }, 20_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function run(key: string, fn: () => Promise<Outcome>, okTitle: string) {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (res?.error) {
      return toast({
        title: "Refused",
        description: `${res.code ?? "ERROR"}${res.message ? ` — ${res.message}` : ""}`,
        variant: "destructive",
      });
    }
    toast({ title: okTitle, description: typeof res.note === "string" ? res.note : undefined });
    await load();
  }

  if (loading) return <main className="p-8"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></main>;

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payout console</h1>
          <p className="text-sm text-muted-foreground">
            Fleet Owner and driver balances from the authoritative wallet, payable and payout records.
            Refreshed {refreshedAt || "—"} · updates every 20s.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
        </Button>
      </header>

      <Tabs defaultValue="owners">
        <TabsList>
          <TabsTrigger value="owners">Fleet Owners</TabsTrigger>
          <TabsTrigger value="drivers">Drivers</TabsTrigger>
          <TabsTrigger value="queue">Driver withdrawals</TabsTrigger>
          <TabsTrigger value="earnings">Driver earnings</TabsTrigger>
        </TabsList>

        <TabsContent value="owners">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fleet Owner balances and payout status</CardTitle>
              <CardDescription>Wallet balance less reserved funds is the withdrawable amount.</CardDescription>
            </CardHeader>
            <CardContent>
              {owners.length === 0 ? (
                <p className="text-sm text-muted-foreground">No fleet owners on file.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fleet Owner</TableHead><TableHead>Status</TableHead>
                      <TableHead>Wallet</TableHead><TableHead>Reserved</TableHead>
                      <TableHead>Available</TableHead><TableHead>Accrued payables</TableHead>
                      <TableHead>Released</TableHead><TableHead>Destination</TableHead>
                      <TableHead>Last withdrawal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {owners.map((o) => (
                      <TableRow key={o.carrier_id}>
                        <TableCell className="font-medium">
                          {o.legal_entity_name}
                          <div className="text-xs text-muted-foreground">{o.carrier_code}</div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className={tone(o.operating_status)}>{o.operating_status}</Badge></TableCell>
                        <TableCell>{kesPlain(o.balance)}</TableCell>
                        <TableCell>{kesPlain(o.reserved)}</TableCell>
                        <TableCell className="font-semibold">{kesPlain(o.available)}</TableCell>
                        <TableCell>{o.payable_count === 0 ? "—" : kesPlain(o.accrued_payables)}</TableCell>
                        <TableCell>{o.payable_count === 0 ? "—" : kesPlain(o.released_payables)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={tone(o.destination_verified ? "VERIFIED" : "PENDING")}>
                            {o.destination_verified ? "Verified" : "Not verified"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {o.last_withdrawal_reference
                            ? <>{o.last_withdrawal_reference}<div className="text-muted-foreground">{o.last_withdrawal_state}</div></>
                            : "None"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="drivers">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Driver wallets and entitlements</CardTitle>
              <CardDescription>Earnings come from completed, attributed trips only.</CardDescription>
            </CardHeader>
            <CardContent>
              {drivers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No drivers on file.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Driver</TableHead><TableHead>Status</TableHead>
                      <TableHead>Wallet</TableHead><TableHead>Earned</TableHead>
                      <TableHead>Available</TableHead><TableHead>Withdrawn</TableHead>
                      <TableHead>In flight</TableHead><TableHead>Paid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drivers.map((d) => (
                      <TableRow key={d.driver_id}>
                        <TableCell className="font-medium">
                          {d.name}
                          <div className="text-xs text-muted-foreground">{d.driver_code ?? "—"}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={tone(d.status)}>{d.status}</Badge>
                          <div className="text-xs text-muted-foreground">{d.verification_status ?? "—"}</div>
                        </TableCell>
                        <TableCell>{kesFromCents(d.wallet_cents)}</TableCell>
                        <TableCell>{d.earning_count === 0 ? "—" : kesFromCents(d.earned_cents)}</TableCell>
                        <TableCell className="font-semibold">{kesFromCents(d.available_cents)}</TableCell>
                        <TableCell>{kesFromCents(d.withdrawn_cents)}</TableCell>
                        <TableCell>{kesFromCents(d.in_flight_cents)}</TableCell>
                        <TableCell>{kesFromCents(d.paid_cents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="queue">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Driver withdrawal queue</CardTitle>
              <CardDescription>
                Approving reserves the money through the ledger and wallet and queues the payout.
                Disbursement and PAID require the provider result.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {queue.length === 0 ? (
                <p className="text-sm text-muted-foreground">No driver withdrawals requested.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead><TableHead>Requested</TableHead>
                      <TableHead>Amount</TableHead><TableHead>Status</TableHead>
                      <TableHead>Provider reference</TableHead><TableHead className="text-right">Decision</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queue.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.reference ?? p.id.slice(0, 8)}</TableCell>
                        <TableCell className="text-xs">{new Date(p.created_at).toLocaleString("en-KE")}</TableCell>
                        <TableCell>{kesFromCents(p.amount_cents)}</TableCell>
                        <TableCell><Badge variant="outline" className={tone(p.status)}>{p.status}</Badge></TableCell>
                        <TableCell className="text-xs">{p.provider_txn_id ?? "Not disbursed"}</TableCell>
                        <TableCell className="text-right">
                          {p.status === "PENDING" ? (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" disabled={busy !== null}
                                onClick={() => void run(`a-${p.id}`,
                                  () => decideDriverWithdrawal({ payoutId: p.id, action: "APPROVE" }),
                                  "Withdrawal approved and queued")}>
                                {busy === `a-${p.id}` && <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden />}Approve
                              </Button>
                              <Button size="sm" variant="outline" disabled={busy !== null}
                                onClick={() => {
                                  const reason = window.prompt("Reason for rejection");
                                  if (!reason) return;
                                  void run(`r-${p.id}`,
                                    () => decideDriverWithdrawal({ payoutId: p.id, action: "REJECT", reason }),
                                    "Withdrawal rejected");
                                }}>Reject</Button>
                            </div>
                          ) : <span className="text-xs text-muted-foreground">Decided</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="earnings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Driver earning records</CardTitle>
              <CardDescription>
                Accrual posts the ledger entry; release credits the driver wallet once the customer
                payment on that trip is confirmed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <Button variant="outline" size="sm"
                  onClick={() => {
                    const id = window.prompt("Completed trip booking id to accrue");
                    if (!id) return;
                    void run("accrue", () => accrueDriverEarning(id.trim()), "Earning accrued");
                  }}>Accrue from booking id</Button>
              </div>
              {earnings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No earning records yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead><TableHead>Service</TableHead>
                      <TableHead>Gross</TableHead><TableHead>Commission</TableHead>
                      <TableHead>Net</TableHead><TableHead>State</TableHead>
                      <TableHead>Class</TableHead><TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {earnings.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">
                          {e.earning_reference}
                          <div className="text-xs text-muted-foreground">
                            {new Date(e.accrued_at).toLocaleString("en-KE")}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{e.service_line}</TableCell>
                        <TableCell>{kesFromCents(e.gross_cents)}</TableCell>
                        <TableCell>
                          {kesFromCents(e.commission_cents)}
                          <div className="text-xs text-muted-foreground">{(e.commission_bps / 100).toFixed(2)}%</div>
                        </TableCell>
                        <TableCell className="font-semibold">{kesFromCents(e.net_cents)}</TableCell>
                        <TableCell><Badge variant="outline" className={tone(e.state)}>{e.state}</Badge></TableCell>
                        <TableCell className="text-xs">{e.data_class}</TableCell>
                        <TableCell className="text-right">
                          {e.state === "EARNED" ? (
                            <Button size="sm" variant="outline" disabled={busy !== null}
                              onClick={() => void run(`rel-${e.id}`, () => releaseDriverEarning(e.id),
                                "Earning released to wallet")}>
                              {busy === `rel-${e.id}` && <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden />}Release
                            </Button>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
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
    </main>
  );
}
