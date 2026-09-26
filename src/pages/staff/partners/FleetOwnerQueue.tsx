/**
 * STAFF — unified Fleet Owner work queue.
 *
 * One screen across the four places Fleet Owner work waits: partner interest,
 * compliance evidence, settlement destinations, and delivery evidence /
 * payables. Every row and count is read live; decisions are executed by the
 * authoritative database functions on the dedicated review screens.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadFleetOwnerQueue, carrierName, type FleetOwnerQueue } from "@/lib/logistics/carrier/queue";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, RefreshCw } from "lucide-react";

const kes = (n: number) => `KES ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FleetOwnerQueuePage() {
  const [queue, setQueue] = useState<FleetOwnerQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setQueue(await loadFleetOwnerQueue());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading && !queue) return <main className="p-8"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></main>;

  return (
    <main className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fleet Owner work queue</h1>
          <p className="text-sm text-muted-foreground">
            Everything waiting on a Yalla decision across intake, compliance, delivery evidence and settlement.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden />Refresh
        </Button>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Queue could not be read</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {queue && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            {[
              { label: "Applications open", n: queue.applications.length, to: "/staff/partners/fleet-owner-conversion" },
              { label: "Documents to verify", n: queue.evidence.length, to: "/dashboard/admin/fleet-owner-compliance" },
              { label: "Payout destinations to verify", n: queue.destinations.length, to: "/dashboard/admin/fleet-owner-compliance" },
              { label: "Delivery evidence to approve", n: queue.pods.length, to: "/dashboard/admin/carrier-pod-review" },
            ].map((c) => (
              <Card key={c.label}>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold">{c.n}</p>
                  <Button asChild size="sm" variant="outline" className="mt-2"><Link to={c.to}>Open</Link></Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Partner interest awaiting review or conversion</CardTitle>
              <CardDescription>Not yet converted into a Fleet Owner account.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Review status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.applications.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-muted-foreground">Nothing waiting.</TableCell></TableRow>
                  )}
                  {queue.applications.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm font-medium">{a.organisation_name}</TableCell>
                      <TableCell className="text-xs">{a.reference}</TableCell>
                      <TableCell><Badge variant="outline">{(a.review_status ?? a.status).replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline"><Link to="/staff/partners/fleet-owner-conversion">Review</Link></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Compliance evidence awaiting verification</CardTitle>
              <CardDescription>Business registration, KRA PIN, insurance and the rest of the checklist.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fleet Owner</TableHead>
                    <TableHead>Requirement</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.evidence.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-muted-foreground">No document is awaiting verification.</TableCell></TableRow>
                  )}
                  {queue.evidence.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="text-sm">{carrierName(queue.carriers, i.carrier_id)}</TableCell>
                      <TableCell className="text-sm">{i.requirement_label}</TableCell>
                      <TableCell className="text-xs">{i.responsibility_level}</TableCell>
                      <TableCell><Badge variant="outline">{i.state.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to="/dashboard/admin/fleet-owner-documents">Review</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Payout destinations awaiting verification</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fleet Owner</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.destinations.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-muted-foreground">Nothing waiting.</TableCell></TableRow>
                  )}
                  {queue.destinations.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-sm">{carrierName(queue.carriers, d.carrier_id)}</TableCell>
                      <TableCell className="text-sm">
                        {d.destination_type === "MPESA" ? `M-Pesa ${d.msisdn}` : `${d.bank_name} ${d.bank_account_number}`}
                        <span className="block text-xs text-muted-foreground">{d.account_name}</span>
                      </TableCell>
                      <TableCell><Badge variant="outline">{d.verification_state.replace(/_/g, " ")}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Delivery evidence and payables</CardTitle>
              <CardDescription>Approval accrues a payable; finance releases it to the Fleet Owner wallet.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Submission</TableHead>
                    <TableHead>Fleet Owner</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.pods.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-muted-foreground">No delivery evidence awaiting approval.</TableCell></TableRow>
                  )}
                  {queue.pods.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs">{p.submission_reference}</TableCell>
                      <TableCell className="text-sm">{carrierName(queue.carriers, p.carrier_id)}</TableCell>
                      <TableCell className="text-sm">{p.recipient_name}</TableCell>
                      <TableCell className="text-xs">{new Date(p.submitted_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payable awaiting release</TableHead>
                    <TableHead>Fleet Owner</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.payables.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-muted-foreground">No payable is awaiting release.</TableCell></TableRow>
                  )}
                  {queue.payables.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs">{p.line_reference}</TableCell>
                      <TableCell className="text-sm">{carrierName(queue.carriers, p.carrier_id)}</TableCell>
                      <TableCell className="text-right font-medium">{kes(p.net_payable)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
