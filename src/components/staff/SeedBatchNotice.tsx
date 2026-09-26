import { Badge } from "@/components/ui/badge";

/**
 * Visible provenance notice for the seeded intelligence batch. Seeded numbers
 * are demonstration data and must never be read as actual Yalla performance.
 */
export function SeedBatchNotice({ batch, className }: { batch: string; className?: string }) {
  return (
    <div className={className ?? "mb-8 rounded-lg border border-info/30 bg-info/5 p-4"}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-info/40 text-[10px] tracking-wide text-info">
          MODELLED
        </Badge>
        <span className="text-sm font-semibold">Seeded experiment batch</span>
        <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{batch}</code>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Figures on this surface come from a labelled seed batch so the intelligence chain can be
        exercised end to end. They are demonstration values, not recorded Yalla performance, and are
        replaced automatically once the corresponding live data source is connected to your scope.
      </p>
    </div>
  );
}
