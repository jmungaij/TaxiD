import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Sparkles, BadgeCheck, Calculator } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";

import * as api from "@/lib/interns/api";
import {
  CONVERSION_LABEL, TALENT_LEVEL_LABEL, TALENT_LEVEL_THRESHOLD, defaultPeriod, money, nextTalentLevel, pct, talentTone,
} from "@/lib/interns/types";

/**
 * TALENT DISCOVERY — who has actually proven capability, and what the business
 * should do about it. Recommendations are computed from records; the decision
 * stays with a human and is written to the trail.
 */
export default function TalentDiscovery() {
  const qc = useQueryClient();
  const period = useMemo(defaultPeriod, []);
  const [busy, setBusy] = useState<string | null>(null);

  const board = useQuery({ queryKey: ["interns", "scoreboard"], queryFn: () => api.listScoreboard() });
  const recs = useQuery({ queryKey: ["interns", "conversions"], queryFn: () => api.listConversionRecommendations() });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["interns"] });
  const fail = (e: Error) => toast({ title: "Action refused", description: e.message, variant: "destructive" });

  const compute = useMutation({
    mutationFn: (id: string) => api.computePerformance(id, period.start, period.end),
    onMutate: setBusy,
    onSettled: () => setBusy(null),
    onSuccess: () => { toast({ title: "Recalculated from evidence" }); invalidate(); },
    onError: fail,
  });

  const promote = useMutation({
    mutationFn: (v: { id: string; level: string }) => api.promoteLevel(v.id, v.level, "Promoted from Talent Discovery"),
    onSuccess: () => { toast({ title: "Talent level updated" }); invalidate(); },
    onError: fail,
  });

  const recommend = useMutation({
    mutationFn: (id: string) => api.recommendConversion(id),
    onSuccess: (r) => { toast({ title: "Recommendation ready", description: `Recommended: ${CONVERSION_LABEL[r.recommended_outcome] ?? r.recommended_outcome}` }); invalidate(); },
    onError: fail,
  });

  const decide = useMutation({
    mutationFn: (v: { id: string; outcome: string; decision: "APPROVED" | "DECLINED" }) =>
      api.decideConversion({ id: v.id, decision: v.decision, outcome: v.outcome, rationale: "Decided in talent review" }),
    onSuccess: () => { toast({ title: "Decision recorded" }); invalidate(); },
    onError: fail,
  });

  const ranked = (board.data ?? [])
    .slice()
    .sort((a, b) => Number(b.performance_index ?? -1) - Number(a.performance_index ?? -1));
  const pending = (recs.data ?? []).filter((r) => !r.decision);

  return (
    <div className="space-y-6">
      <StaffPageHeader
        eyebrow="Interns 360"
        title="Talent discovery"
        lede="Ranked on the calculated performance index, evidence confidence and verified commercial contribution. Promotion and conversion require the evidence to exist."
      />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Talent review queue ({pending.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {pending.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing awaiting a decision. Generate a recommendation from any intern below.
            </p>
          )}
          {pending.map((r) => {
            const intern = ranked.find((x) => x.intern_id === r.intern_id);
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <div>
                  <Link className="font-medium underline-offset-2 hover:underline" to={`/staff/interns/${r.intern_id}`}>
                    {intern?.full_name ?? "Intern"}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    Recommended: {CONVERSION_LABEL[r.recommended_outcome] ?? r.recommended_outcome} ·{" "}
                    index {pct(Number((r.evidence as Record<string, number>)?.performance_index ?? 0))} ·{" "}
                    capstone {pct(Number((r.evidence as Record<string, number>)?.capstone_score ?? 0))}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => decide.mutate({ id: r.id, outcome: r.recommended_outcome, decision: "APPROVED" })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, outcome: "NOT_PROGRESSED", decision: "DECLINED" })}>
                    Decline
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Ranked talent</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {board.isLoading && <Skeleton className="h-32 w-full" />}
          {!board.isLoading && ranked.length === 0 && (
            <p className="text-sm text-muted-foreground">No interns on the register yet.</p>
          )}
          {ranked.map((r) => {
            const next = nextTalentLevel(r.talent_level);
            const eligible = next ? Number(r.performance_index ?? 0) >= TALENT_LEVEL_THRESHOLD[next]
              && r.validated_modules > 0 && r.accepted_work > 0 : false;
            return (
              <div key={r.intern_id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link className="text-sm font-semibold underline-offset-2 hover:underline" to={`/staff/interns/${r.intern_id}`}>
                      {r.full_name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {r.track_name ?? "no track"} · {r.cohort_name ?? "no cohort"} · {r.status}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={talentTone(r.talent_level)}>{TALENT_LEVEL_LABEL[r.talent_level]}</Badge>
                    <Badge variant="outline">{CONVERSION_LABEL[r.conversion_status] ?? r.conversion_status}</Badge>
                    <Button size="sm" variant="outline" disabled={busy === r.intern_id} onClick={() => compute.mutate(r.intern_id)}>
                      <Calculator className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Recalculate
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => recommend.mutate(r.intern_id)}>
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Recommend
                    </Button>
                    {next && (
                      <Button size="sm" disabled={!eligible} onClick={() => promote.mutate({ id: r.intern_id, level: next })}>
                        <BadgeCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        {eligible ? `Promote to ${TALENT_LEVEL_LABEL[next]}` : `Needs index ${TALENT_LEVEL_THRESHOLD[next]}`}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 text-xs sm:grid-cols-5">
                  <div>
                    <div className="text-muted-foreground">Performance index</div>
                    <div className="font-semibold">{pct(r.performance_index)}</div>
                    <Progress className="mt-1 h-1.5" value={Math.min(100, Number(r.performance_index ?? 0))} />
                  </div>
                  <div>
                    <div className="text-muted-foreground">Evidence confidence</div>
                    <div className="font-semibold">{pct(r.evidence_confidence)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Validated learning</div>
                    <div className="font-semibold">{r.validated_modules}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Accepted work</div>
                    <div className="font-semibold">{r.accepted_work}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Verified revenue</div>
                    <div className="font-semibold">{money(r.verified_revenue_kes)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
