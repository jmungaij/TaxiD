/**
 * Publication gate panel — the operator view of the three gates a vacancy must
 * clear before it can go public. Evidence is read from the database; this panel
 * offers no override and no "mark pass" control.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fetchGateRuns,
  fetchPublicationGate,
  GATE_DESCRIPTIONS,
  GATE_LABELS,
  gateOrder,
} from "@/lib/recruitment/publicationGate";

export default function PublicationGatePanel({ vacancyId: initial = "" }: { vacancyId?: string }) {
  const [vacancyId, setVacancyId] = useState(initial);
  const [applied, setApplied] = useState(initial);

  const gate = useQuery({
    queryKey: ["staff", "publication-gate", applied],
    queryFn: () => fetchPublicationGate(applied),
    enabled: applied.length > 20,
  });

  const runs = useQuery({
    queryKey: ["staff", "publication-gate-runs", applied],
    queryFn: () => fetchGateRuns(applied),
    enabled: applied.length > 20,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          Publication gate
        </CardTitle>
        <CardDescription>
          A vacancy goes public only after validation, the contract handshake and a live end-to-end run all pass for
          the current vacancy version. Publishing is blocked in the database, not in the interface.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(vacancyId.trim());
          }}
        >
          <div className="flex-1 min-w-[260px]">
            <Label htmlFor="gate-vacancy">Vacancy ID</Label>
            <Input
              id="gate-vacancy"
              value={vacancyId}
              onChange={(e) => setVacancyId(e.target.value)}
              placeholder="Paste the vacancy identifier"
            />
          </div>
          <Button type="submit" disabled={vacancyId.trim().length < 20}>Check gate</Button>
        </form>

        {gate.isFetching && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Evaluating gates…
          </p>
        )}

        {gate.error && (
          <p className="text-sm text-destructive">{(gate.error as Error).message}</p>
        )}

        {gate.data && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={gate.data.verdict === "READY" ? "default" : "destructive"}>
                {gate.data.verdict === "READY" ? "READY TO PUBLISH" : "PUBLICATION BLOCKED"}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {gate.data.vacancy_no} · {gate.data.title} · content v{gate.data.content_version ?? "?"} ·{" "}
                {gate.data.publication_status}
              </span>
            </div>

            <div className="grid gap-3">
              {gateOrder().map((name) => {
                const g = gate.data!.gates[name];
                return (
                  <div key={name} className="rounded-lg border border-border p-4">
                    <div className="flex items-start gap-3">
                      {g.passed ? (
                        <CheckCircle2 className="h-5 w-5 mt-0.5 text-primary" aria-hidden="true" />
                      ) : (
                        <XCircle className="h-5 w-5 mt-0.5 text-destructive" aria-hidden="true" />
                      )}
                      <div className="flex-1">
                        <p className="font-medium">{GATE_LABELS[name]}</p>
                        <p className="text-sm text-muted-foreground">{GATE_DESCRIPTIONS[name]}</p>
                        {name === "e2e" && g.run_id && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {g.suite} · {g.cases_passed ?? 0}/{g.cases_total ?? 0} cases ·{" "}
                            {g.executed_at ? new Date(g.executed_at).toLocaleString() : ""}
                          </p>
                        )}
                        {g.blockers?.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {g.blockers.map((b) => (
                              <li key={b} className="flex items-start gap-2 text-sm">
                                <AlertTriangle className="h-4 w-4 mt-0.5 text-warning" aria-hidden="true" />
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {runs.data && runs.data.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Gate evidence (append-only)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-4">Recorded</th>
                        <th className="py-2 pr-4">Gate</th>
                        <th className="py-2 pr-4">Outcome</th>
                        <th className="py-2 pr-4">Content v</th>
                        <th className="py-2 pr-4">Cases</th>
                        <th className="py-2">Build</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.data.map((r) => (
                        <tr key={r.id} className="border-t border-border">
                          <td className="py-2 pr-4">{new Date(r.created_at).toLocaleString()}</td>
                          <td className="py-2 pr-4">{r.gate}</td>
                          <td className="py-2 pr-4">
                            <Badge variant={r.outcome === "PASS" ? "default" : "destructive"}>{r.outcome}</Badge>
                          </td>
                          <td className="py-2 pr-4 tabular-nums">{r.content_version ?? "—"}</td>
                          <td className="py-2 pr-4 tabular-nums">
                            {r.cases_passed ?? "—"}/{r.cases_total ?? "—"}
                          </td>
                          <td className="py-2 font-mono text-xs">{r.build_id ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
