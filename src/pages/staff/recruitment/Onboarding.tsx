import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import * as rec from "@/lib/recruitment/api";
import { titleise } from "@/lib/recruitment/types";

/**
 * Offer-to-Day-1 handover: pre-employment checks, the onboarding checklist and
 * the governed close-out that provisions the Staff 360 record exactly once.
 */
export default function RecruitmentOnboarding() {
  const qc = useQueryClient();
  const cases = useQuery({ queryKey: ["rec", "onboarding"], queryFn: rec.listOnboardingCases });
  const tasks = useQuery({ queryKey: ["rec", "onboarding-tasks"], queryFn: () => rec.listOnboardingTasks() });
  const checks = useQuery({ queryKey: ["rec", "preemployment"], queryFn: () => rec.listPreemploymentChecks() });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rec"] });

  const setTask = useMutation({
    mutationFn: ({ id }: { id: string }) => rec.setOnboardingTaskStatus(id),
    onSuccess: () => { toast.success("Task completed"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const decideCheck = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "passed" | "failed" | "waived" }) =>
      rec.decidePreemploymentCheck({ check_id: id, status }),
    onSuccess: () => { toast.success("Check recorded"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const complete = useMutation({
    mutationFn: ({ caseId }: { caseId: string }) => rec.completeOnboarding(caseId),
    onSuccess: (r) => {
      toast.success(
        r.idempotent
          ? `Already provisioned as ${r.staff_no}`
          : `Onboarding closed — staff record ${r.staff_no} created`,
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Pre-employment & onboarding"
        lede="Blocking checks must clear before an accepted offer can be closed into the staff register."
      />

      {cases.isLoading ? (
        <div className="space-y-4">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : cases.error ? (
        <p className="text-sm text-destructive">Onboarding could not be loaded: {(cases.error as Error).message}</p>
      ) : (cases.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <GraduationCap className="h-6 w-6 mx-auto text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">No onboarding in flight</p>
            <p className="text-sm text-muted-foreground mt-1">
              Cases open automatically when a candidate accepts an offer.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {(cases.data ?? []).map((c) => {
            const rows = (tasks.data ?? []).filter((t) => t.case_id === c.id);
            const done = rows.filter((t) => t.status === "completed" || t.status === "waived").length;
            const caseChecks = (checks.data ?? []).filter((k) => k.application_id === c.application_id);
            const blocking = caseChecks.filter((k) => k.is_blocking && !["passed", "waived"].includes(k.status));
            return (
              <Card key={c.id}>
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <CardTitle className="text-base">
                    {c.case_no}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      Start {c.start_date ?? "TBC"} · {done}/{rows.length} tasks · {blocking.length} blocking check(s) open
                    </span>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{titleise(c.status)}</Badge>
                    {c.status !== "completed" && (
                      <Button
                        size="sm"
                        disabled={blocking.length > 0 || (rows.length > 0 && done < rows.length)}
                        onClick={() => complete.mutate({ caseId: c.id })}
                      >
                        <ShieldCheck className="mr-1 h-4 w-4" aria-hidden="true" /> Close & provision staff record
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div>
                    <p className="text-sm font-medium mb-2">Pre-employment checks</p>
                    {caseChecks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No checks recorded for this case.</p>
                    ) : (
                      <ul className="divide-y divide-border rounded-md border">
                        {caseChecks.map((k) => (
                          <li key={k.id} className="flex items-center justify-between gap-3 p-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{titleise(k.check_type)}</p>
                              <p className="text-xs text-muted-foreground">
                                {k.is_blocking ? "Blocking" : "Advisory"}
                                {k.decided_at ? ` · decided ${new Date(k.decided_at).toLocaleDateString()}` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant="outline">{titleise(k.status)}</Badge>
                              {!["passed", "waived"].includes(k.status) && (
                                <>
                                  <Button size="sm" variant="outline"
                                    onClick={() => decideCheck.mutate({ id: k.id, status: "passed" })}>
                                    Pass
                                  </Button>
                                  <Button size="sm" variant="ghost"
                                    onClick={() => decideCheck.mutate({ id: k.id, status: "waived" })}>
                                    Waive
                                  </Button>
                                  <Button size="sm" variant="ghost" className="text-destructive"
                                    onClick={() => decideCheck.mutate({ id: k.id, status: "failed" })}>
                                    Fail
                                  </Button>
                                </>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-medium mb-2">Onboarding checklist</p>
                    <ul className="divide-y divide-border">
                      {rows.map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{t.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {titleise(t.category)}{t.due_date ? ` · due ${t.due_date}` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline">{titleise(t.status)}</Badge>
                            {t.status !== "completed" && (
                              <Button size="sm" variant="ghost" onClick={() => setTask.mutate({ id: t.id })}>
                                Mark done
                              </Button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
