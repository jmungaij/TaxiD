import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";

import * as api from "@/lib/interns/api";
import { INTEGRITY_SIGNAL_LABEL } from "@/lib/interns/types";

/**
 * Integrity and audit — anti-gaming signals awaiting human judgement, and the
 * complete decision trail for the programme. Substantiating a signal reduces
 * the intern's conduct score at the next calculation.
 */
export default function InternGovernance() {
  const qc = useQueryClient();
  const flags = useQuery({ queryKey: ["interns", "flags"], queryFn: () => api.listFlags() });
  const audit = useQuery({ queryKey: ["interns", "auditAll"], queryFn: () => api.listAudit(undefined, 150) });

  const resolve = useMutation({
    mutationFn: (v: { id: string; status: "CLEARED" | "SUBSTANTIATED" }) => api.resolveFlag(v.id, v.status),
    onSuccess: () => {
      toast({ title: "Signal reviewed" });
      void qc.invalidateQueries({ queryKey: ["interns"] });
    },
    onError: (e: Error) => toast({ title: "Could not review", description: e.message, variant: "destructive" }),
  });

  const certRuns = useQuery({ queryKey: ["interns", "certRuns"], queryFn: () => api.listCertificationRuns() });
  const certify = useMutation({
    mutationFn: () => api.runCertificationSuite(),
    onSuccess: (r) => {
      toast({
        title: r.verdict === "CERTIFIED" ? "Certified for release" : "Gaps found",
        description: `${r.total_checks - r.gaps}/${r.total_checks} controls passed.`,
        variant: r.verdict === "CERTIFIED" ? undefined : "destructive",
      });
      void qc.invalidateQueries({ queryKey: ["interns"] });
    },
    onError: (e: Error) => toast({ title: "Certification could not run", description: e.message, variant: "destructive" }),
  });

  const open = (flags.data ?? []).filter((f) => f.status === "REVIEW_REQUIRED");
  const closed = (flags.data ?? []).filter((f) => f.status !== "REVIEW_REQUIRED");
  const lastRun = certRuns.data?.[0];
  const lastChecks =
    ((lastRun?.result as { checks?: Array<{ check: string; passed: boolean }> } | undefined)?.checks) ?? [];

  return (
    <div className="space-y-6">
      <StaffPageHeader
        eyebrow="Interns 360"
        title="Integrity & audit"
        lede="The programme measures real contribution. Duplicate claims, unverified revenue, work accepted without a deliverable and competencies validated without applied evidence are surfaced here for human judgement."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base">Release certification</CardTitle>
          <Button size="sm" disabled={certify.isPending} onClick={() => certify.mutate()}>
            {certify.isPending ? "Running…" : "Run certification suite"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            A synthetic intern is created, put through permissions, state transitions, score integrity, audit logging and
            anti-gaming controls, then removed. Nothing touches live records.
          </p>
          {lastRun && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={lastRun.verdict === "CERTIFIED" ? "default" : "destructive"}>{lastRun.verdict}</Badge>
              <span className="text-muted-foreground">
                {lastRun.total_checks - lastRun.gaps}/{lastRun.total_checks} controls passed ·{" "}
                {new Date(lastRun.created_at).toLocaleString()}
              </span>
            </div>
          )}
          <div className="grid gap-1 md:grid-cols-2">
            {lastChecks.map((c) => (
              <div key={c.check} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                <span>{c.check.replace(/_/g, " ")}</span>
                <Badge variant={c.passed ? "outline" : "destructive"}>{c.passed ? "pass" : "fail"}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>


      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Awaiting review ({open.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {flags.isLoading && <Skeleton className="h-24 w-full" />}
          {!flags.isLoading && open.length === 0 && (
            <p className="text-sm text-muted-foreground">No open integrity signals.</p>
          )}
          {open.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{INTEGRITY_SIGNAL_LABEL[f.signal] ?? f.signal.replace(/_/g, " ")}</div>
                <span className="text-xs text-muted-foreground">
                  <Link className="underline" to={`/staff/interns/${f.intern_id}`}>Open intern record</Link>
                  {" · "}{f.severity} severity · {new Date(f.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: f.id, status: "CLEARED" })}>
                  Clear
                </Button>
                <Button size="sm" variant="destructive" onClick={() => resolve.mutate({ id: f.id, status: "SUBSTANTIATED" })}>
                  Substantiate
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Reviewed signals</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {closed.length === 0 && <p className="text-sm text-muted-foreground">Nothing reviewed yet.</p>}
            {closed.slice(0, 30).map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-xs">
                <span>{INTEGRITY_SIGNAL_LABEL[f.signal] ?? f.signal.replace(/_/g, " ")}</span>
                <Badge variant={f.status === "SUBSTANTIATED" ? "destructive" : "outline"}>{f.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Programme decision trail</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {audit.isLoading && <Skeleton className="h-24 w-full" />}
            {(audit.data ?? []).map((a) => (
              <div key={a.id} className="rounded-md border px-3 py-2 text-xs">
                <div className="font-medium">{a.action.replace(/_/g, " ")}</div>
                <span className="text-muted-foreground">
                  {new Date(a.created_at).toLocaleString()} · {a.entity}
                  {a.intern_id ? " · " : ""}
                  {a.intern_id && (
                    <Link className="underline" to={`/staff/interns/${a.intern_id}`}>intern record</Link>
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
