/**
 * Quotation acceptance — the quoted (negotiated) price becomes the transaction
 * price. The database creates the booked service records, the draft invoice at
 * the quoted value and the commission entry in one guarded, idempotent call.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { type QuotationRow, acceptQuotation, fetchQuotations } from "@/lib/pricing/competitive";

const money = (n: number, currency = "KES") =>
  `${currency} ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export function QuotationAcceptance({
  accountName,
  onAccepted,
}: {
  accountName: (id: string) => string;
  onAccepted?: () => void;
}) {
  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [serviceFrom, setServiceFrom] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await fetchQuotations(40));
    } catch (e) {
      toast.error("Quotations could not be loaded", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (q: QuotationRow) => {
    setBusy(q.id);
    try {
      const res = await acceptQuotation({
        quotationId: q.id,
        serviceFrom,
        customerReference: reference || null,
      });
      toast.success(`${res.quote_number} accepted at ${money(res.transaction_value, q.currency)}`, {
        description: [
          `${res.bookings_created} booking(s) scheduled`,
          res.invoice_created ? "draft invoice raised" : "existing invoice reused",
          res.commission_event_id ? "commission recorded" : res.commission_note ?? "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
      await load();
      onAccepted?.();
    } catch (e) {
      toast.error("Quotation not accepted", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading quotations…
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Accept a quotation</CardTitle>
        <CardDescription>
          Accepting books the service, raises a draft invoice at the quoted price and records the
          specialist&apos;s commission. A quotation awaiting price approval cannot be accepted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>First service date</Label>
            <Input type="date" value={serviceFrom} onChange={(e) => setServiceFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Customer reference (optional)</Label>
            <Input
              placeholder="e.g. purchase order or email confirmation"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No quotations recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quotation</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Quoted value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((q) => {
                const blocked =
                  q.approval_status === "pending" ||
                  ["declined", "expired", "superseded"].includes(q.status);
                return (
                  <TableRow key={q.id}>
                    <TableCell className="font-medium">{q.quote_number}</TableCell>
                    <TableCell>{accountName(q.account_id)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(Number(q.total_amount), q.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{q.status.replace(/_/g, " ")}</Badge>
                      {q.approval_status === "pending" && (
                        <Badge variant="outline" className="ml-1.5 border-warning/40 text-warning">
                          approval pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {q.status === "accepted" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> accepted
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => void accept(q)}
                          disabled={blocked || busy === q.id}
                        >
                          {busy === q.id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                          Accept &amp; book
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
