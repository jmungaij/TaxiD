import { useMemo, useState } from "react";
import { FlightHubPage, HubSection } from "@/components/charter/FlightHubPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFlightHub } from "@/lib/charter/useFlightHub";
import { buildSupportQueue } from "@/lib/charter/flightHub";
import { cn } from "@/lib/utils";

const PRIORITY = {
  p1: { label: "P1 · Critical", cls: "bg-status-danger/12 text-status-danger" },
  p2: { label: "P2 · High", cls: "bg-status-warning/12 text-status-warning" },
  p3: { label: "P3 · Normal", cls: "bg-primary/10 text-primary" },
} as const;

const ORIGINS = ["all", "flight", "payment", "quote"] as const;

export default function SupportDesk() {
  const { data, loading, error, reload } = useFlightHub();
  const [origin, setOrigin] = useState<(typeof ORIGINS)[number]>("all");
  const all = useMemo(() => buildSupportQueue(data), [data]);
  const queue = origin === "all" ? all : all.filter((t) => t.origin === origin);
  const count = (p: keyof typeof PRIORITY) => all.filter((t) => t.priority === p).length;

  return (
    <FlightHubPage
      eyebrow="Flight Hub · Service"
      title="Customer Support Desk"
      subtitle="A prioritised exception queue generated directly from live flight, payment and quote operations — no manual triage required."
      loading={loading}
      error={error}
      onReload={reload}
      metrics={[
        { label: "Open exceptions", value: String(all.length) },
        { label: "P1 critical", value: String(count("p1")) },
        { label: "P2 high", value: String(count("p2")) },
        { label: "P3 normal", value: String(count("p3")) },
      ]}
    >
      <HubSection
        title="Exception queue"
        description="Sorted by severity, then age."
        actions={
          <div className="flex flex-wrap gap-1.5">
            {ORIGINS.map((o) => (
              <Button
                key={o}
                size="sm"
                variant={origin === o ? "default" : "outline"}
                onClick={() => setOrigin(o)}
                className="capitalize"
              >
                {o}
              </Button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Priority</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead>Opened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map((t) => (
                <TableRow key={t.id} className="row-hover">
                  <TableCell>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", PRIORITY[t.priority].cls)}>
                      {PRIORITY[t.priority].label}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                  <TableCell className="font-medium">{t.subject}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{t.origin}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(t.openedAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
              {queue.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No open exceptions — operations are clean.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </HubSection>
    </FlightHubPage>
  );
}
