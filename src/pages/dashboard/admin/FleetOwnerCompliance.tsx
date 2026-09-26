/**
 * STAFF CONSOLE — Fleet Owner compliance verification, activation and withdrawals.
 *
 * Every decision here is executed by an authoritative database function that
 * enforces permission, evidence and state rules. Activation is refused unless
 * carrier_matchability passes; nothing in this screen can mark a control PASS.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listOnboardingReadiness, listComplianceItems, listSettlementDestinations,
  listWithdrawalRequests, reviewEvidence, verifyDestination, activateFleetOwner,
  decideWithdrawal, carrierMatchability, dispatchGate,
  type OnboardingReadinessRow, type ComplianceItemRow, type SettlementDestinationRow,
  type WithdrawalRequestRow, type EligibilityVerdict, type RpcOutcome,
} from "@/lib/logistics/carrier/onboarding";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const tone = (state: string) =>
  state === "VERIFIED" || state === "ACTIVE" || state === "RECONCILED" || state === "CLOSED"
    ? "bg-status-success/10 text-status-success border-status-success/30"
    : state === "REJECTED" || state === "EXPIRED" || state === "FAILED"
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : "bg-status-warning/10 text-status-warning border-status-warning/30";

export default function FleetOwnerCompliance() {
  const [rows, setRows] = useState<OnboardingReadinessRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<ComplianceItemRow[]>([]);
  const [destinations, setDestinations] = useState<SettlementDestinationRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequestRow[]>([]);
  const [verdict, setVerdict] = useState<EligibilityVerdict | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const carrier = useMemo(() => rows.find((r) => r.carrier_id === selected) ?? null, [rows, selected]);

  const loadIndex = useCallback(async () => {
    try {
      const [r, w] = await Promise.all([listOnboardingReadiness(), listWithdrawalRequests()]);
      setRows(r); setWithdrawals(w);
      setSelected((prev) => prev ?? r[0]?.carrier_id ?? null);
    } catch (e) {
      toast({ title: "Could not load Fleet Owners", description: (e as Error).message, variant: "destructive" });
    } finally { setLoading(false); }
  }, []);

  const loadCarrier = useCallback(async (id: string) => {
    const [i, d, v] = await Promise.all([
      listComplianceItems(id), listSettlementDestinations(id), carrierMatchability(id),
    ]);
    setItems(i); setDestinations(d); setVerdict(v);
  }, []);

  useEffect(() => { void loadIndex(); }, [loadIndex]);
  useEffect(() => { if (selected) void loadCarrier(selected); }, [selected, loadCarrier]);

  async function run(key: string, fn: () => Promise<RpcOutcome>, okTitle: string) {
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
    toast({ title: okTitle });
    await loadIndex();
    if (selected) await loadCarrier(selected);
  }

  if (loading) {
    return <main className="p-8"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></main>;
  }

  return (
    <main className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Fleet Owner compliance & settlement</h1>
        <p className="text-sm text-muted-foreground">
          Independent Fleet Owners hold their own operating licences, insurance and vehicle/driver documents.
          Verification here decides whether their capacity can be matched.
        </p>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-lg">Onboarding register</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fleet Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Own docs verified</TableHead>
                <TableHead className="text-right">Declarations</TableHead>
                <TableHead className="text-right">Verified payout</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">
                  No Fleet Owner is registered yet — the marketplace has no matchable third-party capacity.
                </TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.carrier_id} data-active={r.carrier_id === selected}>
                  <TableCell>
                    <button className="text-left font-medium hover:underline" onClick={() => setSelected(r.carrier_id)}>
                      {r.legal_entity_name}
                    </button>
                    <div className="text-xs text-muted-foreground">{r.carrier_code}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className={tone(r.operating_status)}>{r.operating_status}</Badge></TableCell>
                  <TableCell className="text-right">{r.carrier_verified}/{r.carrier_requirements}</TableCell>
                  <TableCell className="text-right">{r.declarations_accepted}/3</TableCell>
                  <TableCell className="text-right">{r.verified_destinations}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" disabled={busy === `act-${r.carrier_id}`}
                      onClick={() => run(`act-${r.carrier_id}`, () => activateFleetOwner(r.carrier_id), "Fleet Owner activated")}>
                      Activate
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {carrier && (
        <Tabs defaultValue="evidence">
          <TabsList>
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
            <TabsTrigger value="payout">Payout destinations</TabsTrigger>
            <TabsTrigger value="verdict">Matchability</TabsTrigger>
          </TabsList>

          <TabsContent value="evidence">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{carrier.legal_entity_name} — evidence</CardTitle>
                <CardDescription>Verification requires an actual uploaded document and records you as reviewer.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.length === 0 && <p className="text-sm text-muted-foreground">No checklist has been created for this Fleet Owner.</p>}
                {items.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-64">
                      <p className="text-sm font-medium">{i.requirement_label}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.responsibility_level} · {i.requirement_code}
                        {i.vehicle_id && ` · vehicle ${i.vehicle_id.slice(0, 8)}`}
                        {i.driver_user_id && ` · driver ${i.driver_user_id.slice(0, 8)}`}
                        {i.expires_on && ` · expires ${i.expires_on}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {i.evidence_storage_path ? `Document: ${i.evidence_storage_path.split("/").pop()}` : "No document submitted"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={tone(i.state)}>{i.state.replace(/_/g, " ")}</Badge>
                      <Button size="sm" disabled={busy === i.id}
                        onClick={() => run(i.id, () => reviewEvidence({ itemId: i.id, decision: "VERIFY" }), "Verified")}>
                        Verify
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy === i.id}
                        onClick={() => run(i.id, () => reviewEvidence({ itemId: i.id, decision: "REJECT", notes: "Rejected on review" }), "Rejected")}>
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payout">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Payout destinations</CardTitle>
                <CardDescription>Withdrawals can only be paid to a verified destination.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {destinations.length === 0 && <p className="text-sm text-muted-foreground">No destination nominated.</p>}
                {destinations.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">
                        {d.destination_type === "MPESA" ? `M-Pesa ${d.msisdn}` : `${d.bank_name} ${d.bank_account_number}`}
                      </p>
                      <p className="text-xs text-muted-foreground">{d.account_name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={tone(d.verification_state)}>{d.verification_state.replace(/_/g, " ")}</Badge>
                      <Button size="sm" disabled={busy === d.id}
                        onClick={() => run(d.id, () => verifyDestination({ destinationId: d.id, decision: "VERIFY" }), "Destination verified")}>
                        Verify
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy === d.id}
                        onClick={() => run(d.id, () => verifyDestination({ destinationId: d.id, decision: "REJECT" }), "Destination rejected")}>
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="verdict">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Authoritative matchability verdict</CardTitle>
                <CardDescription>The same verdict the live dispatch gate applies.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Badge variant="outline" className={tone(verdict?.matchable ? "VERIFIED" : "REJECTED")}>
                  {verdict?.state ?? "UNKNOWN"}
                </Badge>
                <ul className="space-y-1">
                  {(verdict?.blocking ?? []).map((b, i) => (
                    <li key={i} className="text-destructive">{b.code}{b.requirement ? ` — ${b.requirement}` : ""}</li>
                  ))}
                </ul>
                <Button size="sm" variant="outline"
                  onClick={async () => {
                    const res = await dispatchGate(carrier.carrier_id);
                    toast({ title: `Dispatch gate: ${res.passes ? "PASS" : "REFUSED"}`, description: String(res.reason ?? "") });
                  }}>
                  Run dispatch gate check
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Withdrawal requests</CardTitle>
          <CardDescription>
            Fleet Owners withdraw their wallet balance; staff authorise and record the payment evidence.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead className="text-right">Amount (KES)</TableHead>
                <TableHead>State</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {withdrawals.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-muted-foreground">No withdrawal request recorded.</TableCell></TableRow>
              )}
              {withdrawals.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="text-xs">{new Date(w.requested_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{Number(w.amount_kes).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline" className={tone(w.state)}>{w.state.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button size="sm" variant="outline" disabled={busy === w.id}
                      onClick={() => run(w.id, () => decideWithdrawal({ requestId: w.id, action: "APPROVE" }), "Approved")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === w.id}
                      onClick={() => run(w.id, () => decideWithdrawal({ requestId: w.id, action: "REJECT", reason: "Rejected on review" }), "Rejected")}>
                      Reject
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Payment execution and reconciliation are recorded through the existing settlement workflow.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
