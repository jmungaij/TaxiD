/**
 * Funding lifecycle table — shows pending funding, STK sent / awaiting
 * callback, and paid / failed / cancelled / expired outcomes with the same
 * vocabulary on every corporate and finance surface. Pending rows are shown as
 * KSh 0 spendable so nobody mistakes an unconfirmed request for cleared funds.
 */
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FUNDING_STATUS_LABEL, isCleared, isPending, type FundingRequestRow } from "@/lib/charter/walletFunding";

const money = (n: number | string | null | undefined) =>
  `KSh ${new Intl.NumberFormat("en-KE").format(Math.round(Number(n ?? 0)))}`;

function tone(status: FundingRequestRow["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (isCleared(status)) return "default";
  if (isPending(status)) return "secondary";
  return "destructive";
}

export function FundingLifecycleTable({
  requests, emptyLabel = "No funding requests yet.",
}: { requests: FundingRequestRow[]; emptyLabel?: string }) {
  return (
    <div className="rounded-xl border border-border" data-testid="funding-lifecycle-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Reference</TableHead>
            <TableHead>Cost centre</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Requested</TableHead>
            <TableHead className="text-right">Cleared</TableHead>
            <TableHead>Receipt</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.reference}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.cost_center}</TableCell>
              <TableCell>
                <Badge variant={tone(r.status)}>{FUNDING_STATUS_LABEL[r.status]}</Badge>
                {r.result_desc && !isCleared(r.status) && (
                  <span className="ml-2 text-xs text-muted-foreground">{r.result_desc}</span>
                )}
              </TableCell>
              <TableCell className="text-right">{money(r.amount_kes)}</TableCell>
              <TableCell className="text-right font-medium">
                {isCleared(r.status) ? money(r.amount_kes) : money(0)}
              </TableCell>
              <TableCell className="font-mono text-xs">{r.mpesa_receipt ?? "—"}</TableCell>
            </TableRow>
          ))}
          {requests.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{emptyLabel}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export default FundingLifecycleTable;
