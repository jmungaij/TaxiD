import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, Wallet, FileText, AlertCircle } from "lucide-react";

const KES = (cents: number) => `KES ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  OPEN: "secondary",
  PARTIAL: "secondary",
  PAID: "default",
  OVERDUE: "destructive",
  WAIVED: "outline",
  PENDING: "secondary",
  QUEUED: "secondary",
  PROCESSING: "secondary",
  SUCCESS: "default",
  FAILED: "destructive",
  REVERSED: "destructive",
  CANCELLED: "outline",
  ACCEPTED: "default",
  SUBMITTED: "secondary",
  RETRYING: "secondary",
  REJECTED: "destructive",
  VOIDED: "outline",
  REFUNDED: "outline",
};

export default function DriverTax() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [liabilities, setLiabilities] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [p, l, i, py] = await Promise.all([
        supabase.from("driver_tax_profiles").select("*").eq("driver_id", user.id).maybeSingle(),
        supabase.from("driver_tax_liabilities").select("*").eq("driver_id", user.id).order("due_date", { ascending: false }).limit(24),
        supabase.from("driver_etims_invoices").select("*").eq("driver_id", user.id).order("issued_at", { ascending: false }).limit(50),
        supabase.from("driver_payouts").select("*").eq("driver_id", user.id).order("created_at", { ascending: false }).limit(50),
      ]);
      setProfile(p.data);
      setLiabilities(l.data ?? []);
      setInvoices(i.data ?? []);
      setPayouts(py.data ?? []);
      setLoading(false);
    })();
  }, [user]);

  if (loading) return <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;

  const openLiability = liabilities
    .filter((l) => ["OPEN", "PARTIAL", "OVERDUE"].includes(l.status))
    .reduce((s, l) => s + (l.amount_cents - l.paid_cents), 0);

  const totalPaidOut = payouts
    .filter((p) => p.status === "SUCCESS")
    .reduce((s, p) => s + p.amount_cents, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tax & Payouts</h1>
        <p className="text-sm text-muted-foreground">Your KRA tax position, eTIMS invoices, and payout history.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<FileText className="h-5 w-5 text-primary" />} label="Tax regime" value={profile?.current_regime ?? "—"} sub={profile?.status ?? "No profile"} />
        <StatCard icon={<AlertCircle className="h-5 w-5 text-destructive" />} label="Outstanding tax" value={KES(openLiability)} sub={`${liabilities.filter(l => l.status !== 'PAID').length} open period(s)`} />
        <StatCard icon={<Receipt className="h-5 w-5 text-primary" />} label="eTIMS invoices" value={invoices.length.toString()} sub={`${invoices.filter(i => i.status === 'ACCEPTED').length} accepted`} />
        <StatCard icon={<Wallet className="h-5 w-5 text-status-success" />} label="Paid out" value={KES(totalPaidOut)} sub={`${payouts.filter(p => p.status === 'SUCCESS').length} payouts`} />
      </div>

      {!profile && (
        <Card className="border-status-warning/50 bg-status-warning/5">
          <CardContent className="pt-6 text-sm">
            No driver tax profile on file yet. One will be created automatically on your first recognized ride revenue, defaulting to <strong>Turnover Tax (3%)</strong>. Contact support to elect a different regime.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="liabilities" className="space-y-4">
        <TabsList>
          <TabsTrigger value="liabilities">Tax Liabilities</TabsTrigger>
          <TabsTrigger value="invoices">eTIMS Invoices</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
        </TabsList>

        <TabsContent value="liabilities">
          <Card>
            <CardHeader><CardTitle className="text-base">Period liabilities</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Period</TableHead><TableHead>Scheme</TableHead><TableHead>Rate</TableHead>
                  <TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">Due</TableHead>
                  <TableHead className="text-right">Paid</TableHead><TableHead>Due date</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {liabilities.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No liabilities yet.</TableCell></TableRow>}
                  {liabilities.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.period_start} → {l.period_end}</TableCell>
                      <TableCell>{l.scheme_code}</TableCell>
                      <TableCell>{(l.rate_bps / 100).toFixed(2)}%</TableCell>
                      <TableCell className="text-right">{KES(l.taxable_cents)}</TableCell>
                      <TableCell className="text-right">{KES(l.amount_cents)}</TableCell>
                      <TableCell className="text-right">{KES(l.paid_cents)}</TableCell>
                      <TableCell>{l.due_date}</TableCell>
                      <TableCell><Badge variant={statusVariant[l.status] ?? "outline"}>{l.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardHeader><CardTitle className="text-base">eTIMS invoices</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Invoice #</TableHead><TableHead>Issued</TableHead><TableHead>Scheme</TableHead>
                  <TableHead className="text-right">Net</TableHead><TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">Gross</TableHead><TableHead>KRA #</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {invoices.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No invoices yet.</TableCell></TableRow>}
                  {invoices.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono text-xs">{i.invoice_number}</TableCell>
                      <TableCell>{new Date(i.issued_at).toLocaleDateString()}</TableCell>
                      <TableCell>{i.tax_scheme_code}</TableCell>
                      <TableCell className="text-right">{KES(i.net_cents)}</TableCell>
                      <TableCell className="text-right">{KES(i.tax_cents)}</TableCell>
                      <TableCell className="text-right font-medium">{KES(i.gross_cents)}</TableCell>
                      <TableCell className="font-mono text-xs">{i.kra_invoice_no ?? "—"}</TableCell>
                      <TableCell><Badge variant={statusVariant[i.status] ?? "outline"}>{i.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payouts">
          <Card>
            <CardHeader><CardTitle className="text-base">Payouts</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Reference</TableHead>
                  <TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Tax withheld</TableHead>
                  <TableHead className="text-right">Net</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {payouts.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No payouts yet.</TableCell></TableRow>}
                  {payouts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="font-mono text-xs">{p.reference ?? p.id.slice(0, 8)}</TableCell>
                      <TableCell className="text-right">{KES(p.amount_cents)}</TableCell>
                      <TableCell className="text-right">{KES(p.tax_withheld_cents)}</TableCell>
                      <TableCell className="text-right font-medium">{KES(p.net_payout_cents)}</TableCell>
                      <TableCell><Badge variant={statusVariant[p.status] ?? "outline"}>{p.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {icon}
      </div>
      <p className="text-2xl font-bold mt-2">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}
