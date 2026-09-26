/**
 * Evidence panel — the audit surface behind every intelligence recommendation.
 *
 * Opens beside any recommendation and discloses, without leaving the page:
 *  · the exact source fields (table.column, value read, scoping record),
 *  · seed batch provenance for those tables (simulated vs production rows),
 *  · the confidence rationale as weighted, named factors.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { Database, FlaskConical, Gauge, Info, ScrollText } from "lucide-react";
import { DataStateBadge } from "@/components/staff/primitives";
import {
  confidenceLabel, fetchSeedProvenance, provenanceStatement, seededShare,
  type EvidenceBundle, type SeedProvenance,
} from "@/lib/staff/evidence";

export function EvidencePanel({
  bundle,
  triggerLabel = "Evidence",
  triggerClassName,
}: {
  bundle: EvidenceBundle;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [provenance, setProvenance] = useState<SeedProvenance[] | null>(null);

  const tables = bundle.provenanceTables ?? Array.from(new Set(bundle.fields.map((f) => f.table)));

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await fetchSeedProvenance(tables);
    setProvenance(rows);
    setLoading(false);
  }, [tables.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && provenance === null && !loading) void load();
  }, [open, provenance, loading, load]);

  const share = provenance ? seededShare(provenance) : null;
  const conf = bundle.confidence;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={triggerClassName ?? "h-7 px-2 text-xs"}
          aria-label={`Show evidence for ${bundle.title}`}
        >
          <ScrollText className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {triggerLabel}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-base">Evidence · {bundle.title}</SheetTitle>
          <SheetDescription>
            The exact fields read, their seed batch provenance, and how the confidence figure was derived.
          </SheetDescription>
        </SheetHeader>

        <section className="mt-6 space-y-3">
          <SectionTitle icon={<Database className="h-3.5 w-3.5" aria-hidden="true" />}>
            Source fields ({bundle.fields.length})
          </SectionTitle>
          {bundle.fields.length === 0 ? (
            <Empty>No source fields are declared for this recommendation.</Empty>
          ) : (
            <ul className="space-y-2">
              {bundle.fields.map((f, i) => (
                <li key={`${f.table}.${f.column}-${i}`} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <code className="text-xs font-medium">
                      {f.table}.{f.column}
                    </code>
                    <DataStateBadge state={f.state} />
                  </div>
                  <div className="mt-1 text-sm">
                    {f.value ?? <span className="text-muted-foreground">not resolved</span>}
                  </div>
                  {f.recordRef && (
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">Scope: {f.recordRef}</div>
                  )}
                  {f.readAt && (
                    <div className="text-[11px] text-muted-foreground">
                      Read {new Date(f.readAt).toLocaleString()}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 space-y-3">
          <SectionTitle icon={<FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />}>
            Seed batch provenance
          </SectionTitle>
          {loading && <Skeleton className="h-20 w-full" />}
          {!loading && provenance && (
            <>
              <p className="text-xs text-muted-foreground">{provenanceStatement(provenance)}</p>
              {share !== null && share > 0 && (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-warning">
                  Contains seeded rows
                </Badge>
              )}
              <ul className="space-y-2">
                {provenance.map((p) => (
                  <li key={p.table} className="rounded-md border p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <code className="font-medium">{p.table}</code>
                      {p.unknown ? (
                        <Badge variant="outline" className="text-[10px] uppercase">Provenance unknown</Badge>
                      ) : (
                        <span className="text-muted-foreground">{p.productionRows} production row(s)</span>
                      )}
                    </div>
                    {p.unknown ? (
                      <p className="mt-1 text-muted-foreground">
                        No seed_batch column is available, or the read was not permitted — seeded rows cannot be ruled out.
                      </p>
                    ) : p.batches.length === 0 ? (
                      <p className="mt-1 text-muted-foreground">No seed batch rows found.</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {p.batches.map((b) => (
                          <li key={b.batch} className="flex justify-between gap-2 text-muted-foreground">
                            <span className="truncate">{b.batch}</span>
                            <span>{b.rows} row(s)</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {!loading && provenance?.length === 0 && <Empty>No provenance tables are declared.</Empty>}
        </section>

        <section className="mt-6 space-y-3">
          <SectionTitle icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}>Confidence rationale</SectionTitle>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Stated confidence</span>
            <span className="font-medium">
              {conf.confidence == null
                ? "Withheld"
                : `${confidenceLabel(conf.confidence)} · ${Math.round(conf.confidence * 100)}%`}
            </span>
          </div>
          <Progress value={conf.confidence == null ? 0 : conf.confidence * 100} className="h-1.5" />
          <p className="text-xs text-muted-foreground">{conf.rationale}</p>
          {conf.factors.length > 0 && (
            <ul className="space-y-2">
              {conf.factors.map((f) => (
                <li key={f.label} className="rounded-md border p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{f.label}</span>
                    <span className="text-muted-foreground">
                      weight {f.weight} · {Math.round(f.score * 100)}%
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{f.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {bundle.limitations && bundle.limitations.length > 0 && (
          <section className="mt-6 space-y-2">
            <SectionTitle icon={<Info className="h-3.5 w-3.5" aria-hidden="true" />}>What this does not cover</SectionTitle>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {bundle.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {icon}
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{children}</p>;
}
