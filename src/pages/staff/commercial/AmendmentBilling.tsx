/**
 * AMENDMENT BILLING — every agreed contract change that increases value is
 * billed and collected, not merely recorded. Raising the invoice also creates the
 * payment task; both are created by the database in one step.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Loader2, ReceiptText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  billAmendment,
  fetchAmendmentBillingBoard,
  formatCents,
  formatKes,
  type AmendmentBillResult,
  type AmendmentBillingBoard,
  type AmendmentBillingRow,
} from "@/lib/commercial/clientPortal";
import RevenueByEmployeePanel from "@/components/staff/commercial/RevenueByEmployeePanel";

export default function AmendmentBilling() {
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(true);
  const [board, setBoard] = React.useState<AmendmentBillingBoard | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = (await fetchAmendmentBillingBoard()) as AmendmentBillingBoard;
    setBoard(res);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function bill(row: AmendmentBillingRow) {
    setBusy(row.amendment_id);
    const res = (await billAmendment(row.amendment_id)) as AmendmentBillResult;
    setBusy(null);
    if (!res.ok) {
      toast.error(res.detail ?? res.error ?? "The invoice could not be raised");
      return;
    }
    toast.success("Draft invoice and payment task created");
    void load();
  }

  const rows = board?.rows ?? [];
  const unbilled = rows.filter((r) => r.needs_invoice);
  const billedValue = rows.reduce((s, r) => s + (r.billing_id ? Number(r.total_cents ?? 0) : 0), 0);
  const collected = rows.reduce((s, r) => s + Number(r.paid_cents ?? 0), 0);

  return (
    <div className="space-y-5">
      <header className="hero-band px-6 py-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">Commercial &amp; pricing</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Amendment billing</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-85">
          Every agreed change to a contract that increases its value is invoiced and chased here, so uplift is
          collected and not only recorded. {unbilled.length} change{unbilled.length === 1 ? "" : "s"} still need an
          invoice.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Changes awaiting an invoice</p>
            <p className="mt-1 text-2xl font-bold">{unbilled.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Invoiced from amendments</p>
            <p className="mt-1 text-2xl font-bold">{formatCents(billedValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground">Collected</p>
            <p className="mt-1 text-2xl font-bold">{formatCents(collected)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="h-4 w-4" /> Contract changes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading contract changes…
            </div>
          )}

          {!loading && board?.ok === false && (
            <p className="py-6 text-sm text-muted-foreground">
              This view is not released to your account, so nothing is shown.
            </p>
          )}

          {!loading && board?.ok && rows.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">No contract has been amended yet.</p>
          )}

          {!loading &&
            rows.map((r) => (
              <div key={r.amendment_id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {r.customer ?? "Customer"} · {r.contract_number ?? "Contract"} · change {r.amendment_no}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.reason ?? "No reason recorded"}
                    {r.effective_date ? ` · effective ${new Date(r.effective_date).toLocaleDateString()}` : ""}
                    {r.owner_name ? ` · ${r.owner_name}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      Change {formatKes(r.value_delta, r.currency ?? "KES")}
                    </Badge>
                    {r.invoice_no && (
                      <Badge variant="secondary" className="text-[10px]">
                        {r.invoice_no} · {r.invoice_status ?? "draft"} · {formatCents(r.total_cents, r.currency ?? "KES")}
                      </Badge>
                    )}
                    {r.billing_id && Number(r.paid_cents ?? 0) >= Number(r.total_cents ?? 0) && Number(r.total_cents ?? 0) > 0 && (
                      <Badge className="text-[10px]">Paid</Badge>
                    )}
                    {r.needs_invoice && (
                      <Badge variant="destructive" className="text-[10px]">
                        No invoice raised
                      </Badge>
                    )}
                    {!r.needs_invoice && !r.billing_id && (
                      <Badge variant="outline" className="text-[10px]">
                        No extra value to bill
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {r.needs_invoice ? (
                    <Button size="sm" onClick={() => void bill(r)} disabled={busy === r.amendment_id}>
                      {busy === r.amendment_id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                      Raise invoice &amp; payment task
                    </Button>
                  ) : r.invoice_id ? (
                    <Button size="sm" variant="ghost" onClick={() => navigate("/staff/commercial/invoices")}>
                      Open invoice <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
        </CardContent>
      </Card>

      <RevenueByEmployeePanel />
    </div>
  );
}
