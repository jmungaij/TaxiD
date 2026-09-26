import { useMemo } from "react";
import { FlightHubPage, HubSection } from "@/components/charter/FlightHubPage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFlightHub } from "@/lib/charter/useFlightHub";
import { buildLifecycle, money } from "@/lib/charter/flightHub";
import { statusLabel } from "@/lib/charter/transitions";

export default function Lifecycle() {
  const { data, loading, error, reload } = useFlightHub();
  const funnel = useMemo(() => buildLifecycle(data), [data]);
  const leak = funnel.reduce((worst, s) => (s.dropOff > worst.dropOff ? s : worst), funnel[0]);

  const recent = useMemo(
    () => data.quotes.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 12),
    [data.quotes],
  );

  return (
    <FlightHubPage
      eyebrow="Flight Hub · Lifecycle"
      title="Demand Lifecycle"
      subtitle="Where air mobility demand is created, priced, contracted and flown — and exactly where it leaks."
      loading={loading}
      error={error}
      onReload={reload}
      metrics={funnel.map((s) => ({ label: s.label, value: String(s.count) }))}
    >
      <HubSection title="Conversion funnel" description={leak ? `Largest drop-off: ${leak.label} (−${leak.dropOff})` : undefined}>
        <ol className="space-y-4">
          {funnel.map((s, i) => (
            <li key={s.key} className="flex items-center gap-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{s.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {s.count} · {s.share}%
                    {s.dropOff > 0 && <span className="ml-2 text-status-warning">−{s.dropOff} lost</span>}
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 rounded-full bg-muted">
                  <div className="h-2.5 rounded-full bg-gradient-hero transition-all" style={{ width: `${Math.max(4, s.share)}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      </HubSection>

      <HubSection title="Recent enquiries" description="Latest quotes entering the lifecycle.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((q) => (
                <TableRow key={q.id} className="row-hover">
                  <TableCell className="font-mono text-xs">{q.reference}</TableCell>
                  <TableCell className="font-medium">{q.asset_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{q.category_slug}</TableCell>
                  <TableCell><Badge variant="outline">{statusLabel(q.status)}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{money(q.total, q.currency)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(q.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
              {recent.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No enquiries yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </HubSection>
    </FlightHubPage>
  );
}
