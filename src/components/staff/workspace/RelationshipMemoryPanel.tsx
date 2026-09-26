import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Brain } from "lucide-react";
import { fetchRelationshipMemory, type RelationshipMemory } from "@/lib/workspace/relationshipMemory";
import type { PersonalCommitment } from "@/lib/workspace/personalOs";

/**
 * RELATIONSHIP MEMORY.
 *
 * What the platform already knows about this customer, so the employee never
 * opens a conversation cold. It reloads whenever an outcome is recorded, because
 * the outcome itself becomes part of the memory.
 */
export function RelationshipMemoryPanel({
  accountId,
  accountName,
  commitments,
  refreshKey,
}: {
  accountId: string | null;
  accountName: string | null;
  commitments: PersonalCommitment[];
  refreshKey?: number;
}) {
  const [memory, setMemory] = useState<RelationshipMemory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accountId) {
      setMemory(null);
      return;
    }
    setLoading(true);
    fetchRelationshipMemory(accountId, { accountName, commitments })
      .then((m) => {
        setMemory(m);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Could not load the relationship history"),
      )
      .finally(() => setLoading(false));
    // commitments intentionally excluded: identity churns on every reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, accountName, refreshKey]);

  useEffect(load, [load]);

  if (!accountId) return null;

  return (
    <Card data-testid="relationship-memory">
      <CardContent className="pt-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Brain className="h-3.5 w-3.5 text-primary" /> Relationship memory
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>

        <p className="mt-2 text-sm font-semibold">{accountName ?? "This account"}</p>
        {memory?.daysSinceContact !== null && memory?.daysSinceContact !== undefined && (
          <p className="text-xs text-muted-foreground">
            Last contact {memory.daysSinceContact === 0 ? "today" : `${memory.daysSinceContact} day(s) ago`}
          </p>
        )}

        {loading && <div className="mt-3 h-20 animate-pulse rounded-lg bg-muted" />}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        {memory && !loading && (
          <>
            {memory.suggestions.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {memory.suggestions.map((s, i) => (
                  <li key={i} className="rounded-md bg-muted/50 px-2 py-1.5">
                    {s}
                  </li>
                ))}
              </ul>
            )}

            {memory.openPromises.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Open promises
                </div>
                <ul className="mt-1 space-y-1 text-xs">
                  {memory.openPromises.map((p, i) => (
                    <li key={i}>· {p.commitment}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Recent interactions
              </div>
              {memory.entries.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  No interaction has been recorded with this account yet.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1.5">
                  {memory.entries.map((e) => (
                    <li key={e.id} className="text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          {e.type.replace(/_/g, " ")}
                        </Badge>
                        <span className="text-muted-foreground">
                          {new Date(e.at).toLocaleDateString()}
                        </span>
                        {e.sentiment && (
                          <span className="text-muted-foreground">· {e.sentiment}</span>
                        )}
                      </div>
                      <p className="mt-0.5">{e.outcome ?? e.summary ?? e.subject}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
