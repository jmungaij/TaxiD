/**
 * REVENUE BY EMPLOYEE — contracted value against activated revenue for every
 * employee who owns commercial records. Every figure is computed in the
 * database from contracts and revenue entries; nothing is estimated here.
 */
import * as React from "react";
import { Loader2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  fetchRevenueByEmployee,
  formatKes,
  type EmployeeRevenueBoard,
  type EmployeeRevenueRow,
} from "@/lib/commercial/clientPortal";

export default function RevenueByEmployeePanel() {
  const [loading, setLoading] = React.useState(true);
  const [board, setBoard] = React.useState<EmployeeRevenueBoard | null>(null);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const res = (await fetchRevenueByEmployee()) as EmployeeRevenueBoard;
      if (!live) return;
      setBoard(res);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  const rows: EmployeeRevenueRow[] = board?.rows ?? [];
  const currency = board?.currency ?? "KES";
  const totalContracted = rows.reduce((s, r) => s + Number(r.contracted_value || 0), 0);
  const totalActivated = rows.reduce((s, r) => s + Number(r.activated_revenue_total || 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" /> Revenue by employee
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Contracted value is what each employee has signed up; activated revenue is what has been recorded once a
          contract went live. {board?.month ? `Month shown: ${board.month}.` : ""}
        </p>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading contracts and revenue…
          </div>
        )}

        {!loading && board?.ok === false && (
          <p className="py-6 text-sm text-muted-foreground">
            This view is not released to your account, so no figures are shown.
          </p>
        )}

        {!loading && board?.ok && rows.length === 0 && (
          <p className="py-6 text-sm text-muted-foreground">
            No employee owns a live contract yet, so there is nothing to show.
          </p>
        )}

        {!loading && board?.ok && rows.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Contracted value</TableHead>
                  <TableHead className="text-right">Activated revenue</TableHead>
                  <TableHead className="text-right">This month</TableHead>
                  <TableHead className="text-right">Waiting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.owner_staff_id ?? r.owner_name}>
                    <TableCell>
                      <p className="text-sm font-semibold">{r.owner_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.contracts} contracts · {r.activated_contracts} live
                      </p>
                    </TableCell>
                    <TableCell className="text-right text-sm">{formatKes(r.contracted_value, currency)}</TableCell>
                    <TableCell className="text-right text-sm font-semibold">
                      {formatKes(r.activated_revenue_total, currency)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatKes(r.activated_revenue_month, currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {r.awaiting_signature > 0 && (
                          <Badge variant="secondary" className="text-[10px]">
                            {r.awaiting_signature} to sign
                          </Badge>
                        )}
                        {r.awaiting_activation > 0 && (
                          <Badge variant="outline" className="text-[10px]">
                            {r.awaiting_activation} to activate
                          </Badge>
                        )}
                        {r.awaiting_signature === 0 && r.awaiting_activation === 0 && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="text-sm font-semibold">All employees</TableCell>
                  <TableCell className="text-right text-sm font-semibold">{formatKes(totalContracted, currency)}</TableCell>
                  <TableCell className="text-right text-sm font-semibold">{formatKes(totalActivated, currency)}</TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
