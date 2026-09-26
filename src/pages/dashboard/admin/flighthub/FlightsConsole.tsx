import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FlightHubPage, HubSection } from "@/components/charter/FlightHubPage";
import { FlightEventDialog } from "@/components/charter/FlightEventDialog";
import { FlightTimeline } from "@/components/charter/FlightTimeline";
import { useFlightHub } from "@/lib/charter/useFlightHub";
import { buildFlightRows, computePulse } from "@/lib/charter/flightHub";
import { statusLabel } from "@/lib/charter/transitions";
import { charterAccess } from "@/lib/charter/access";
import { useAuth } from "@/hooks/useAuth";
import { AlertTriangle, Lock } from "lucide-react";

const PHASES = ["all", "pre-flight", "airborne", "closed"] as const;

const PHASE_TONE: Record<string, string> = {
  "pre-flight": "bg-primary/10 text-primary",
  airborne: "bg-status-success/12 text-status-success",
  closed: "bg-muted text-muted-foreground",
};

export default function FlightsConsole() {
  const { roles } = useAuth();
  const access = charterAccess(roles);
  const { data, loading, error, reload } = useFlightHub();
  const [phase, setPhase] = useState<(typeof PHASES)[number]>("all");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const pulse = useMemo(() => computePulse(data), [data]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return buildFlightRows(data).filter((r) => {
      if (phase !== "all" && r.phase !== phase) return false;
      if (!term) return true;
      return `${r.booking.reference} ${r.booking.asset_name} ${r.booking.category_slug}`.toLowerCase().includes(term);
    });
  }, [data, phase, q]);

  return (
    <FlightHubPage
      eyebrow="Flight Hub · Operations"
      title="Flights Console"
      subtitle="Real-time flight board with governed status transitions, disruption flags and evidence-backed event capture."
      loading={loading}
      error={error}
      onReload={reload}
      metrics={[
        { label: "Airborne", value: String(pulse.activeFlights) },
        { label: "Scheduled today", value: String(pulse.scheduledToday) },
        { label: "Closed (30d)", value: String(pulse.completed30d) },
        { label: "Stale updates", value: String(rows.filter((r) => r.stale).length) },
      ]}
    >
      <HubSection
        title="Flight board"
        description={`${rows.length} flight${rows.length === 1 ? "" : "s"} in view`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search reference or aircraft"
              className="h-9 w-56"
              aria-label="Search flights"
            />
            <Select value={phase} onValueChange={(v) => setPhase(v as typeof phase)}>
              <SelectTrigger className="h-9 w-40" aria-label="Filter by phase">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHASES.map((p) => (
                  <SelectItem key={p} value={p}>{p === "all" ? "All phases" : p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {!access.canManageFlightStatus && (
          <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Read-only — operator or admin role required to record flight events.
          </p>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Aircraft</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last note</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <>
                  <TableRow
                    key={r.booking.id}
                    className="row-hover cursor-pointer"
                    onClick={() => setExpanded(expanded === r.booking.id ? null : r.booking.id)}
                  >
                    <TableCell className="font-mono text-xs">{r.booking.reference}</TableCell>
                    <TableCell className="font-medium">{r.booking.asset_name}</TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PHASE_TONE[r.phase]}`}>{r.phase}</span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <Badge variant="outline">{statusLabel(r.booking.flight_status)}</Badge>
                        {r.stale && <AlertTriangle className="h-3.5 w-3.5 text-status-warning" aria-label="Stale update" />}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-sm text-muted-foreground">{r.lastNote ?? "—"}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {access.canManageFlightStatus && r.nextAllowed.length > 0
                        ? <FlightEventDialog booking={r.booking} onSaved={reload} />
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                  {expanded === r.booking.id && (
                    <TableRow key={`${r.booking.id}:tl`}>
                      <TableCell colSpan={6} className="bg-muted/30">
                        <FlightTimeline currentStatus={r.booking.flight_status} events={r.booking.flight_events} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    No flights match the current filters.
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
