/**
 * Customer Operations — Business Line Coverage panel.
 *
 * Proves the cockpit services every commercial line SAFARID sells, and
 * exposes per-line health plus desk load. Composed only from shadcn atoms and
 * frozen dashboard primitives.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import StatCard from "@/components/common/StatCard";
import {
  BUSINESS_LINES,
  DESK_LABEL,
  deskLoad,
  lineCoverage,
  type CoverageCase,
} from "@/lib/customerops/businessLines";


const GROUP_LABEL: Record<string, string> = {
  passenger: "Passenger mobility",
  charter: "Charter & premium",
  corporate: "Corporate mobility",
  freight: "Freight & logistics",
  assets: "Assets & rentals",
  concierge: "Concierge & VIP",
};

export function BusinessLineCoveragePanel({ cases }: { cases: CoverageCase[] }) {
  const rows = useMemo(() => lineCoverage(cases), [cases]);
  const desks = useMemo(() => deskLoad(cases), [cases]);

  const active = rows.filter((r) => r.active).length;
  const breached = rows.reduce((s, r) => s + r.breached, 0);
  const coveragePct = Math.round((active / (BUSINESS_LINES.length || 1)) * 100);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      map.set(row.line.group, [...(map.get(row.line.group) ?? []), row]);
    }
    return [...map.entries()];
  }, [rows]);


  return (
    <SectionErrorBoundary sectionName="Business Line Coverage">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Commercial lines"
            value={BUSINESS_LINES.length}
            icon={<CheckCircle2 className="h-5 w-5 text-primary" />}
            description="Registered in the service catalogue"
          />
          <StatCard
            title="Lines with live cases"
            value={`${active}/${BUSINESS_LINES.length}`}
            icon={<ArrowUpRight className="h-5 w-5 text-primary" />}
            description={`${coveragePct}% of the catalogue is active`}
          />
          <StatCard
            title="Breaches across lines"
            value={breached}
            icon={<AlertTriangle className="h-5 w-5 text-primary" />}
            description="SLA-breached cases in the loaded window"
          />
          <StatCard
            title="Service desks"
            value={desks.length}
            icon={<CheckCircle2 className="h-5 w-5 text-primary" />}
            description="Desks currently carrying queue volume"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Desk load</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {desks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No desk activity in the loaded window.</p>
            ) : (
              desks.map((d) => (
                <div key={d.desk} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{d.label}</span>
                    <span className="text-muted-foreground">
                      {d.open} open · {d.cases} total
                      {d.breached > 0 ? ` · ${d.breached} breached` : ""}
                    </span>
                  </div>
                  <Progress value={Math.min(100, (d.open / Math.max(1, d.cases)) * 100)} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {grouped.map(([group, groupRows]) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle className="text-base">{GROUP_LABEL[group] ?? group}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line of business</TableHead>
                    <TableHead>Desk</TableHead>
                    <TableHead>SLA tier</TableHead>
                    <TableHead className="text-right">Cases</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Breached</TableHead>
                    <TableHead className="text-right">Escalated</TableHead>
                    <TableHead>Workspace</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupRows.map((r) => (
                    <TableRow key={r.line.id}>
                      <TableCell className="font-medium">{r.line.label}</TableCell>
                      <TableCell className="text-muted-foreground">{DESK_LABEL[r.line.desk]}</TableCell>
                      <TableCell>
                        <Badge variant={r.line.slaTier === "vip" ? "default" : r.line.slaTier === "priority" ? "secondary" : "outline"}>
                          {r.line.slaTier}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{r.cases}</TableCell>
                      <TableCell className="text-right">{r.open}</TableCell>
                      <TableCell className="text-right">
                        {r.breached > 0 ? (
                          <Badge variant="destructive">{r.breached}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{r.escalated}</TableCell>
                      <TableCell>
                        <Link to={r.line.route} className="text-sm text-primary underline-offset-4 hover:underline">
                          Open
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}

                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
    </SectionErrorBoundary>
  );
}

export default BusinessLineCoveragePanel;
