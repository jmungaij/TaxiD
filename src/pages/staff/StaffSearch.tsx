import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Loader2, RotateCcw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { StaffPageHeader, StaffSection } from "@/components/staff/primitives";
import { SavedViewsBar } from "@/components/staff/SavedViewsBar";
import { ResultActions } from "@/components/staff/ResultActions";
import {
  runUniversalSearch, SEARCH_ADAPTERS, SEARCH_CLASS_STATE_LABEL, STATUS_FACET_OPTIONS,
  type SearchClassResult, type SearchEntityId,
} from "@/lib/staff/universalSearch";
import { WORKFLOW_STAGES, type WorkflowStageId } from "@/lib/staff/marketplaceWorkflow";

interface FacetState {
  entities: SearchEntityId[];
  statuses: string[];
  from: string;
  to: string;
  orgUnit: string;
  stage: WorkflowStageId | "";
}

const EMPTY: FacetState = { entities: [], statuses: [], from: "", to: "", orgUnit: "", stage: "" };

/**
 * SAFARID Universal Search — one field, every authorised entity class, with
 * faceted narrowing, permission-aware actions, saved/shared views and a direct
 * jump into the Demand → CLV workflow trace. Classes outside the employee's
 * scope, or without a wired source, say so plainly.
 */
export default function StaffSearch() {
  const { roles } = useAuth();
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(params.get("q") ?? "");
  const [facets, setFacets] = useState<FacetState>(EMPTY);
  const [results, setResults] = useState<SearchClassResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const debounced = useDebouncedValue(term, 300);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set("q", debounced);
    else next.delete("q");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  useEffect(() => {
    let cancelled = false;
    if (!debounced.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    runUniversalSearch(debounced, roles, {
      entities: facets.entities.length ? facets.entities : undefined,
      statuses: facets.statuses.length ? facets.statuses : undefined,
      from: facets.from || undefined,
      to: facets.to || undefined,
      orgUnit: facets.orgUnit.trim() || undefined,
      stage: facets.stage || undefined,
    })
      .then((r) => !cancelled && setResults(r))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, roles, facets]);

  const ordered = useMemo(() => {
    const rank: Record<SearchClassResult["state"], number> = {
      ok: 0, empty: 1, unavailable: 2, out_of_scope: 3, error: 4,
    };
    return (results ?? []).slice().sort((a, b) => rank[a.state] - rank[b.state]);
  }, [results]);

  const toggleEntity = (id: SearchEntityId) =>
    setFacets((f) => ({
      ...f,
      entities: f.entities.includes(id) ? f.entities.filter((x) => x !== id) : [...f.entities, id],
    }));

  const toggleStatus = (s: string) =>
    setFacets((f) => ({
      ...f,
      statuses: f.statuses.includes(s) ? f.statuses.filter((x) => x !== s) : [...f.statuses, s],
    }));

  const applySaved = useCallback((config: Record<string, unknown>) => {
    const c = config as Partial<FacetState> & { term?: string };
    setFacets({ ...EMPTY, ...c } as FacetState);
    if (typeof c.term === "string") setTerm(c.term);
  }, []);

  const activeFacetCount =
    facets.entities.length + facets.statuses.length +
    (facets.from ? 1 : 0) + (facets.to ? 1 : 0) + (facets.orgUnit ? 1 : 0) + (facets.stage ? 1 : 0);

  return (
    <>
      <StaffPageHeader
        eyebrow="SAFARID Universal Search"
        title="Search everything you are authorised to see"
        lede="Customers, leads, contracts, bookings, transactions, marketplace partners, documents, tasks, projects, policies, knowledge and people — resolved class by class, with the governing scope stated, and actionable where your role permits."
      />

      <SavedViewsBar
        kind="search"
        currentConfig={{ term, ...facets }}
        onApply={applySaved}
        emptyHint="Save a search once you have a query and facets you return to — then share it with the roles that run the same review."
      />

      <div className="mb-6 max-w-3xl">
        <label className="relative block">
          <span className="sr-only">Search all authorised entities</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search a customer, reference, invoice, operator, document or person…"
            className="pl-9 h-11"
            aria-label="Search all authorised entities"
          />
        </label>

        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter entity classes">
          {SEARCH_ADAPTERS.map((a) => (
            <Button
              key={a.id}
              size="sm"
              variant={facets.entities.includes(a.id) ? "default" : "outline"}
              className="h-7 rounded-full px-3 text-xs"
              aria-pressed={facets.entities.includes(a.id)}
              onClick={() => toggleEntity(a.id)}
            >
              {a.label}
            </Button>
          ))}
        </div>

        <div className="mt-4 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Advanced filters {activeFacetCount > 0 && `· ${activeFacetCount} active`}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setFacets(EMPTY)}
              disabled={activeFacetCount === 0}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Clear filters
            </Button>
          </div>

          <div className="mt-3 space-y-3">
            <fieldset>
              <legend className="text-xs font-medium">Status</legend>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {STATUS_FACET_OPTIONS.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={facets.statuses.includes(s) ? "default" : "outline"}
                    className="h-6 rounded-full px-2.5 text-[11px]"
                    aria-pressed={facets.statuses.includes(s)}
                    onClick={() => toggleStatus(s)}
                  >
                    {s.replace(/_/g, " ")}
                  </Button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-xs font-medium">Workflow stage</legend>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {WORKFLOW_STAGES.map((s) => (
                  <Button
                    key={s.id}
                    size="sm"
                    variant={facets.stage === s.id ? "default" : "outline"}
                    className="h-6 rounded-full px-2.5 text-[11px]"
                    aria-pressed={facets.stage === s.id}
                    onClick={() => setFacets((f) => ({ ...f, stage: f.stage === s.id ? "" : s.id }))}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="facet-from" className="text-xs">From date</Label>
                <Input
                  id="facet-from"
                  type="date"
                  value={facets.from}
                  onChange={(e) => setFacets((f) => ({ ...f, from: e.target.value }))}
                  className="h-9"
                />
              </div>
              <div>
                <Label htmlFor="facet-to" className="text-xs">To date</Label>
                <Input
                  id="facet-to"
                  type="date"
                  value={facets.to}
                  onChange={(e) => setFacets((f) => ({ ...f, to: e.target.value }))}
                  className="h-9"
                />
              </div>
              <div>
                <Label htmlFor="facet-org" className="text-xs">Organisation unit (account id)</Label>
                <Input
                  id="facet-org"
                  value={facets.orgUnit}
                  onChange={(e) => setFacets((f) => ({ ...f, orgUnit: e.target.value }))}
                  placeholder="Corporate account id"
                  className="h-9"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Resolving authorised classes…
        </div>
      )}

      {!results && !loading && (
        <p className="text-sm text-muted-foreground">
          Start typing to search. Nothing is guessed — each class reports whether it matched, is empty, is
          outside your scope, or has no wired data source.
        </p>
      )}

      {results && (
        <StaffSection title="Results by entity class">
          <div className="space-y-4">
            {ordered.map((r) => (
              <Card key={r.entity}>
                <CardContent className="pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{r.label}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px] tracking-wide">
                        {SEARCH_CLASS_STATE_LABEL[r.state]}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        stage: {WORKFLOW_STAGES.find((s) => s.id === r.stage)?.label ?? r.stage}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">scope: {r.scope}</span>
                    </div>
                  </div>

                  {r.hits.length > 0 ? (
                    <ul className="mt-3 divide-y">
                      {r.hits.map((h) => (
                        <li key={h.id} className="py-2 flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{h.title}</div>
                            {h.subtitle && (
                              <div className="truncate text-xs text-muted-foreground">{h.subtitle}</div>
                            )}
                            {h.meta && <div className="text-[11px] text-muted-foreground">{h.meta}</div>}
                          </div>
                          <ResultActions entity={r.entity} hit={h} stage={r.stage} roles={roles} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {r.note ?? "No matches in this class for your access."}
                    </p>
                  )}

                  <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                    {r.source && <div>Source: {r.source}</div>}
                    {r.appliedFacets.length > 0 && <div>Filters applied: {r.appliedFacets.join(", ")}</div>}
                    {r.ignoredFacets.length > 0 && (
                      <div>
                        Filters this class cannot honour: {r.ignoredFacets.join(", ")} — results are unnarrowed
                        for that facet rather than silently dropped.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </StaffSection>
      )}
    </>
  );
}
