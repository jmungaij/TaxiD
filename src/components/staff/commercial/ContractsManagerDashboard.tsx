/**
 * CONTRACTS DASHBOARD (manager view).
 *
 * Every figure is read from the contract system of record: contract pipeline by
 * stage, value awaiting signature, revenue already recognised, amendment
 * activity and the next action each contract is waiting on. Nothing is
 * estimated here.
 */
import * as React from "react";
import { AlertTriangle, FileSignature, Loader2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CONTRACT_STATUS_LABEL,
  fetchContractManagerDashboard,
  formatContractValue,
  type ContractManagerDashboard,
} from "@/lib/commercial/contractExecution";

const money = (n: number, currency = "KES") => formatContractValue(n, currency);

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

export default function ContractsManagerDashboard() {
  const [data, setData] = React.useState<ContractManagerDashboard | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [q, setQ] = React.useState("");

  React.useEffect(() => {
    void (async () => {
      const res = await fetchContractManagerDashboard();
      if (!res || res.ok === false) {
        setError(res && "error" in res ? String(res.error) : "Contracts are not released to your account");
      } else {
        setData(res as ContractManagerDashboard);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the contract register…
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="py-8 text-center">
          <p className="text-sm font-semibold">The contracts dashboard is not released to your account</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Commercial or finance read access is required. Nothing is shown rather than an approximation.
          </p>
        </CardContent>
      </Card>
    );
  }

  const rows = data.contracts.filter((c) => {
    if (!q.trim()) return true;
    const t = q.toLowerCase();
    return (
      (c.customer ?? "").toLowerCase().includes(t) ||
      (c.contract_number ?? "").toLowerCase().includes(t) ||
      (c.owner_name ?? "").toLowerCase().includes(t) ||
      c.status.toLowerCase().includes(t)
    );
  });

  const openValue = data.contracts
    .filter((c) => !c.activated_at)
    .reduce((s, c) => s + (c.value_amount ?? 0), 0);
  const recognised = data.contracts.reduce((s, c) => s + c.recognised_revenue, 0);
  const overdueTasks = data.contracts.filter(
    (c) => c.next_task_due && new Date(c.next_task_due) < new Date(),
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Contracts in play" value={String(data.contracts.length)} note="Excludes test records" />
        <Metric label="Value not yet counted" value={money(openValue)} note="Signed or in progress, awaiting activation" />
        <Metric label="Revenue recognised" value={money(recognised)} note="Posted from activations and amendments" />
        <Metric
          label="Contracted this month"
          value={money(data.centre?.contracted_revenue_month ?? 0)}
          note={data.month}
        />
      </div>

      {overdueTasks > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-center gap-2 py-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            {overdueTasks} contract {overdueTasks === 1 ? "task is" : "tasks are"} past its deadline in the owner's work
            queue.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">By owner</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Contracts</TableHead>
                <TableHead className="text-right">Awaiting signature</TableHead>
                <TableHead className="text-right">Value in progress</TableHead>
                <TableHead className="text-right">Revenue recognised</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.by_owner.map((o) => (
                <TableRow key={o.owner_staff_id ?? "unassigned"}>
                  <TableCell className="font-medium">{o.owner_name}</TableCell>
                  <TableCell className="text-right">{o.contracts}</TableCell>
                  <TableCell className="text-right">{o.awaiting_signature}</TableCell>
                  <TableCell className="text-right">{money(o.open_value)}</TableCell>
                  <TableCell className="text-right">{money(o.recognised_revenue)}</TableCell>
                </TableRow>
              ))}
              {data.by_owner.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No contracts are recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileSignature className="h-4 w-4" /> Every contract, with its next action
          </CardTitle>
          <div className="relative w-56">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input className="pl-7" placeholder="Customer, number, owner" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contract</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead>Next action</TableHead>
                <TableHead>Task deadline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.contract_id}>
                  <TableCell>
                    <p className="font-medium">{c.customer ?? "Customer not recorded"}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.contract_number ?? "No number"}
                      {c.amendments > 0 ? ` · ${c.amendments} amendment${c.amendments === 1 ? "" : "s"}` : ""}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm">{c.owner_name ?? "Unassigned"}</TableCell>
                  <TableCell>
                    <Badge variant={c.activated_at ? "default" : "secondary"} className="text-[10px]">
                      {CONTRACT_STATUS_LABEL[c.status] ?? c.status}
                    </Badge>
                    {!c.has_executed_document && c.status === "executed" && (
                      <Badge variant="outline" className="ml-1 text-[10px]">
                        No signed copy
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {formatContractValue(c.value_amount, c.currency)}
                  </TableCell>
                  <TableCell className="text-right text-sm">{money(c.recognised_revenue, c.currency)}</TableCell>
                  <TableCell className="max-w-[240px] text-xs">{c.next_action}</TableCell>
                  <TableCell className="text-xs">
                    {c.next_task_due ? (
                      <span className={new Date(c.next_task_due) < new Date() ? "font-semibold text-destructive" : ""}>
                        {new Date(c.next_task_due).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No open task</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No contracts match that search.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data.amendment_activity.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent amendments and their revenue effect</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.amendment_activity.map((a) => (
              <div key={a.amendment_id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-xs last:border-0">
                <div>
                  <p className="font-medium">
                    {a.customer ?? "Customer"} · {a.contract_number ?? "no number"} · amendment #{a.amendment_no}
                  </p>
                  <p className="text-muted-foreground">
                    {a.changed_fields.map((f) => f.replace(/_/g, " ")).join(", ")} — {a.reason}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">
                    {a.value_delta != null && a.value_delta !== 0
                      ? `${a.value_delta > 0 ? "+" : ""}${money(a.value_delta, a.currency)}`
                      : "No revenue change"}
                  </p>
                  <p className="text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
