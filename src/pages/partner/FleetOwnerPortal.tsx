/**
 * FLEET OWNER PORTAL — what an independent Fleet Owner sees about itself.
 *
 * Status, compliance position, movements and money are all read from the
 * authoritative records. The portal decides nothing: the market-access verdict
 * is carrier_matchability, the same verdict the live dispatch gate applies.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listMyFleetOwners, loadFleetOwnerPortal, compliancePosition, evidenceDocumentUrl,
  pendingPayableTotal, releasedPayableTotal,
  type FleetOwnerCarrier, type FleetOwnerPortalView,
} from "@/lib/logistics/carrier/portal";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, ShieldAlert, FileText, Wallet, Truck } from "lucide-react";
import FleetOwnerClaims from "@/components/partner/FleetOwnerClaims";


const tone = (state: string) =>
  ["VERIFIED", "ACTIVE", "APPROVED", "RELEASED", "COMPLETED", "RECONCILED", "CLOSED"].includes(state)
    ? "bg-status-success/10 text-status-success border-status-success/30"
    : ["REJECTED", "EXPIRED", "FAILED", "BLOCKED", "SUSPENDED"].includes(state)
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : "bg-status-warning/10 text-status-warning border-status-warning/30";

const kes = (n: number) => `KES ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FleetOwnerPortal() {
  const [carriers, setCarriers] = useState<FleetOwnerCarrier[]>([]);
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [view, setView] = useState<FleetOwnerPortalView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const rows = await listMyFleetOwners();
        setCarriers(rows);
        setCarrierId(rows[0]?.id ?? null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const refresh = useCallback(async (carrier: FleetOwnerCarrier) => {
    try {
      setView(await loadFleetOwnerPortal(carrier));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const carrier = carriers.find((c) => c.id === carrierId);
    if (carrier) void refresh(carrier);
  }, [carrierId, carriers, refresh]);

  const position = useMemo(() => (view ? compliancePosition(view.items) : null), [view]);

  async function openDocument(path: string | null) {
    const url = await evidenceDocumentUrl(path);
    if (!url) return toast({ title: "Document unavailable", description: "No readable document is stored for this item.", variant: "destructive" });
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (loading) return <main className="p-8"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></main>;

  if (carriers.length === 0) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Fleet Owner portal</h1>
        <Alert>
          <AlertTitle>No Fleet Owner account is linked to your sign-in</AlertTitle>
          <AlertDescription>
            Apply as a Fleet Owner and, once your application is approved, this portal shows your compliance,
            movements and settlement position.
            <div className="mt-3"><Button asChild size="sm" data-analytics="fleet_owner_portal_apply"><Link to="/partner/fleet-owner/apply">Apply as a Fleet Owner</Link></Button></div>
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fleet Owner portal</h1>
          <p className="text-sm text-muted-foreground">
            Your own compliance position, movements and settlement — as the platform records them.
          </p>
        </div>
        {carriers.length > 1 && (
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={carrierId ?? ""}
            onChange={(e) => setCarrierId(e.target.value)}
            aria-label="Select your Fleet Owner account"
          >
            {carriers.map((c) => <option key={c.id} value={c.id}>{c.legal_entity_name}</option>)}
          </select>
        )}
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load your account</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {view && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  {view.matchability.matchable ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <ShieldAlert className="h-4 w-4" aria-hidden />}
                  Market access
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge variant="outline" className={tone(view.matchability.matchable ? "VERIFIED" : "REJECTED")}>
                  {view.matchability.state ?? "UNKNOWN"}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  {view.carrier.legal_entity_name} · {view.carrier.carrier_code} · {view.carrier.operating_status}
                </p>
                <ul className="space-y-1 text-xs text-destructive">
                  {(view.matchability.blocking ?? []).map((b, i) => (
                    <li key={i}>{String(b.code)}{b.requirement ? ` — ${String(b.requirement)}` : ""}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" aria-hidden />Compliance</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                {position && position.mandatory > 0 ? (
                  <>
                    <p className="text-2xl font-semibold">{position.verified}/{position.mandatory}</p>
                    <p className="text-xs text-muted-foreground">
                      {position.pending} awaiting review · {position.missing} not submitted · {position.rejected} to replace
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No checklist has been created yet.</p>
                )}
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link to="/partner/fleet-owner/onboarding">Submit or replace documents</Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4" aria-hidden />Settlement</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                {view.wallet ? (
                  <p className="text-2xl font-semibold">{kes(view.wallet.balance)}</p>
                ) : (
                  <p className="text-sm font-medium text-muted-foreground">NO FINANCIAL ACTIVITY</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Awaiting release {view.payables.length > 0 ? kes(pendingPayableTotal(view.payables)) : "— none"} ·
                  {" "}Released {view.payables.length > 0 ? kes(releasedPayableTotal(view.payables)) : "— none"}
                </p>
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link to="/partner/fleet-owner/delivery-evidence">Submit delivery evidence</Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="compliance">
            <TabsList>
              <TabsTrigger value="compliance">Compliance checklist</TabsTrigger>
              <TabsTrigger value="movements">Movements</TabsTrigger>
              <TabsTrigger value="claims">Claims & invoices</TabsTrigger>
              <TabsTrigger value="finance">Payables & withdrawals</TabsTrigger>
            </TabsList>

            <TabsContent value="claims">
              <FleetOwnerClaims carrierId={view.carrier.id} legalName={view.carrier.legal_entity_name} />
            </TabsContent>


            <TabsContent value="compliance">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Your evidence register</CardTitle>
                  <CardDescription>
                    You own these documents. SAFARID verifies them; it never issues or approves them on your behalf.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {view.items.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No checklist exists yet. Open the onboarding page to create it.
                    </p>
                  )}
                  {view.items.map((i) => (
                    <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-64">
                        <p className="text-sm font-medium">{i.requirement_label}</p>
                        <p className="text-xs text-muted-foreground">
                          {i.responsibility_level} · {i.requirement_code}
                          {i.expires_on && ` · expires ${i.expires_on}`}
                          {i.review_notes && ` · ${i.review_notes}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={tone(i.state)}>{i.state.replace(/_/g, " ")}</Badge>
                        {i.evidence_storage_path && (
                          <Button size="sm" variant="outline" onClick={() => void openDocument(i.evidence_storage_path)}>
                            Open document
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                    Declarations accepted: {view.declarations.filter((d) => d.accepted_at).length} of 3 ·
                    {" "}Verified payout destinations: {view.destinations.filter((d) => d.verification_state === "VERIFIED").length}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="movements">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg"><Truck className="h-4 w-4" aria-hidden />Movements assigned to your vehicles</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Route</TableHead>
                        <TableHead>Leg</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Arrived</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {view.movements.length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-muted-foreground">
                          No movement is assigned to your vehicles yet.
                        </TableCell></TableRow>
                      )}
                      {view.movements.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="text-sm">{m.origin_label} → {m.destination_label}</TableCell>
                          <TableCell className="text-xs">#{m.leg_no} {m.leg_type}</TableCell>
                          <TableCell><Badge variant="outline" className={tone(m.status)}>{m.status.replace(/_/g, " ")}</Badge></TableCell>
                          <TableCell className="text-xs">{m.actual_arrival ? new Date(m.actual_arrival).toLocaleString() : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="finance">
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Payable lines</CardTitle>
                    <CardDescription>Accrued when your delivery evidence is approved; released to your wallet by finance.</CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Reference</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right">Platform fee</TableHead>
                          <TableHead className="text-right">Net</TableHead>
                          <TableHead>State</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {view.payables.length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-muted-foreground">NO FINANCIAL ACTIVITY</TableCell></TableRow>
                        )}
                        {view.payables.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="text-xs">{p.line_reference}</TableCell>
                            <TableCell className="text-right">{kes(Number(p.gross_amount))}</TableCell>
                            <TableCell className="text-right">{kes(Number(p.platform_fee))}</TableCell>
                            <TableCell className="text-right font-medium">{kes(Number(p.net_payable))}</TableCell>
                            <TableCell><Badge variant="outline" className={tone(p.state)}>{p.state}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-lg">Withdrawals</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Requested</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>State</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {view.withdrawals.length === 0 && (
                          <TableRow><TableCell colSpan={3} className="text-muted-foreground">No withdrawal requested.</TableCell></TableRow>
                        )}
                        {view.withdrawals.map((w) => (
                          <TableRow key={w.id}>
                            <TableCell className="text-xs">{new Date(w.requested_at).toLocaleString()}</TableCell>
                            <TableCell className="text-right">{kes(Number(w.amount_kes))}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={tone(w.state)}>{w.state.replace(/_/g, " ")}</Badge>
                              {w.failure_reason && <span className="ml-2 text-xs text-destructive">{w.failure_reason}</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </main>
  );
}
