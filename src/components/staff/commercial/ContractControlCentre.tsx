/**
 * SALES MANAGER CONTRACT CONTROL CENTRE.
 * Every exception the manager must clear, computed in the database:
 * contracts waiting for activation, values that disagree, revenue posted but
 * not activated, missing signed copies and revenue nobody has reviewed.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { kes } from "@/lib/commercial/pipelineValue";
import {
  fetchContractControlExceptions,
  type ContractControlExceptions,
  type ControlException,
} from "@/lib/commercial/revenueReconciliation";

type GroupKey =
  | "pending_activation"
  | "value_mismatch"
  | "missing_value"
  | "missing_signed_copy"
  | "contracted_without_revenue";

const GROUPS: { key: GroupKey; label: string; help: string }[] = [
  {
    key: "pending_activation",
    label: "Waiting for activation",
    help: "Signed and executed, but revenue has not been posted yet.",
  },
  {
    key: "value_mismatch",
    label: "Value disagreements",
    help: "Posted revenue does not match the recorded contract value.",
  },
  { key: "missing_value", label: "No contract value", help: "A value must be recorded before activation." },
  {
    key: "missing_signed_copy",
    label: "No signed copy on file",
    help: "The executed document has not been uploaded.",
  },
  {
    key: "contracted_without_revenue",
    label: "Contracted with no revenue",
    help: "Marked contracted but no revenue entry exists.",
  },
];

function ExceptionTable({ rows }: { rows: ControlException[] }) {
  if (rows.length === 0) return <p className="p-4 text-sm text-muted-foreground">Nothing outstanding here.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Contract</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead>What it needs</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={r.contract_id ?? `${r.contract_number}-${i}`}>
            <TableCell className="font-medium">
              {r.contract_number ?? "—"}
              {r.status && <div className="text-xs text-muted-foreground">{r.status}</div>}
            </TableCell>
            <TableCell>{r.customer ?? "—"}</TableCell>
            <TableCell>{r.owner_name ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">
              {kes(r.value_amount ?? r.contract_value)}
              {r.opportunity_value != null && (
                <div className="text-xs text-muted-foreground">expected {kes(r.opportunity_value)}</div>
              )}
            </TableCell>
            <TableCell className="max-w-[22rem] text-sm text-muted-foreground">
              {r.variance
                ? `${kes(r.variance)} away from the expected value${r.variance_reason ? ` — ${r.variance_reason}` : ""}`
                : r.blockers
                  ? `${r.blockers} check${r.blockers === 1 ? "" : "s"} still to clear`
                  : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ContractControlCentre() {
  const [state, setState] = useState<ContractControlExceptions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchContractControlExceptions()
      .then((d) => alive && setState(d))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!state?.ok) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          {state?.error === "NOT_AUTHORISED"
            ? "The contract control centre is open to sales managers and finance only."
            : `The control centre is unavailable${state?.error ? `: ${state.error}` : ""}.`}
        </AlertDescription>
      </Alert>
    );
  }

  const counts = Object.fromEntries(GROUPS.map((g) => [g.key, (state[g.key] ?? []).length])) as Record<
    GroupKey,
    number
  >;
  const unreviewed = state.unreviewed_revenue ?? 0;
  const open = GROUPS.reduce((sum, g) => sum + counts[g.key], 0) + unreviewed;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Open exceptions</CardDescription>
            <CardTitle className="text-2xl">{open}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Across all contract checks</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Waiting for activation</CardDescription>
            <CardTitle className="text-2xl">{counts.pending_activation}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Signed, revenue not yet posted</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Revenue pending activation</CardDescription>
            <CardTitle className="text-2xl">{kes(state.revenue_pending_activation_kes ?? 0)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Money the book has not recognised yet</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Awaiting finance review</CardDescription>
            <CardTitle className="text-2xl">{unreviewed}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Entries with no decision recorded</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {open === 0 ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            Contract control centre
          </CardTitle>
          <CardDescription>Open a group to see the contracts and what each one needs.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full">
            {GROUPS.map((g) => {
              const rows = (state[g.key] as ControlException[] | undefined) ?? [];
              return (
                <AccordionItem key={String(g.key)} value={String(g.key)}>
                  <AccordionTrigger>
                    <span className="flex items-center gap-3 text-left">
                      <Badge variant={rows.length ? "destructive" : "outline"}>{rows.length}</Badge>
                      <span>
                        <span className="font-medium">{g.label}</span>
                        <span className="block text-xs text-muted-foreground">{g.help}</span>
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="p-0">
                    <ExceptionTable rows={rows} />
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}

export default ContractControlCentre;
