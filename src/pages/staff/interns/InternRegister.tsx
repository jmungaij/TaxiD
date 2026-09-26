import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { UserPlus, Search } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

import * as api from "@/lib/interns/api";
import { INTERN_STATUSES, TALENT_LEVEL_LABEL, money, pct, talentTone } from "@/lib/interns/types";

/**
 * Intern register — the single list of who is on the programme, and the only
 * door in: a selected recruitment application becomes an intern record, which
 * automatically inherits the track's learning pathway.
 */
export default function InternRegister() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const cohortFilter = params.get("cohort") ?? "all";
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [q, setQ] = useState("");

  const cohorts = useQuery({ queryKey: ["interns", "cohorts"], queryFn: api.listCohorts });
  const tracks = useQuery({ queryKey: ["interns", "tracks"], queryFn: api.listTracks });
  const board = useQuery({ queryKey: ["interns", "scoreboard"], queryFn: () => api.listScoreboard() });
  const applications = useQuery({ queryKey: ["interns", "enrollable"], queryFn: api.listEnrollableApplications });

  const [enrol, setEnrol] = useState({ applicationId: "", cohortId: "", trackId: "" });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (board.data ?? []).filter((r) => {
      if (cohortFilter !== "all" && r.cohort_id !== cohortFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!term) return true;
      return [r.full_name, r.institution, r.programme_of_study, r.track_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [board.data, cohortFilter, statusFilter, q]);

  const enrolMutation = useMutation({
    mutationFn: async () => {
      if (!enrol.applicationId) throw new Error("Choose a selected application.");
      if (!enrol.cohortId) throw new Error("Choose the cohort.");
      if (!enrol.trackId) throw new Error("Choose the track.");
      return api.enrolFromApplication({
        applicationId: enrol.applicationId,
        cohortId: enrol.cohortId,
        trackId: enrol.trackId,
      });
    },
    onSuccess: () => {
      toast({ title: "Intern enrolled", description: "The track learning pathway has been assigned automatically." });
      setEnrol({ applicationId: "", cohortId: "", trackId: "" });
      void qc.invalidateQueries({ queryKey: ["interns"] });
    },
    onError: (e: Error) => toast({ title: "Could not enrol", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <StaffPageHeader
        eyebrow="Interns 360"
        title="Intern register"
        lede="Recruitment 360 is the only entry point. Enrolment links the candidate, the application, the cohort and the track into one intern record."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Enrol from recruitment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label htmlFor="enrol-app">Application</Label>
            <Select value={enrol.applicationId} onValueChange={(v) => setEnrol({ ...enrol, applicationId: v })}>
              <SelectTrigger id="enrol-app"><SelectValue placeholder="Select an application" /></SelectTrigger>
              <SelectContent>
                {(applications.data ?? []).slice(0, 100).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.candidate?.full_name ?? "Unnamed candidate"} · {a.stage}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="enrol-cohort">Cohort</Label>
            <Select value={enrol.cohortId} onValueChange={(v) => setEnrol({ ...enrol, cohortId: v })}>
              <SelectTrigger id="enrol-cohort"><SelectValue placeholder="Cohort" /></SelectTrigger>
              <SelectContent>
                {(cohorts.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="enrol-track">Track</Label>
            <Select value={enrol.trackId} onValueChange={(v) => setEnrol({ ...enrol, trackId: v })}>
              <SelectTrigger id="enrol-track"><SelectValue placeholder="Track" /></SelectTrigger>
              <SelectContent>
                {(tracks.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-4">
            <Button disabled={enrolMutation.isPending} onClick={() => enrolMutation.mutate()}>
              <UserPlus className="mr-1.5 h-4 w-4" aria-hidden /> Enrol intern
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">On the programme ({rows.length})</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  className="h-9 w-56 pl-8"
                  placeholder="Search name, institution, track"
                  aria-label="Search interns"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <Select
                value={cohortFilter}
                onValueChange={(v) => {
                  const next = new URLSearchParams(params);
                  if (v === "all") next.delete("cohort");
                  else next.set("cohort", v);
                  setParams(next, { replace: true });
                }}
              >
                <SelectTrigger className="h-9 w-[180px]" aria-label="Filter by cohort"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cohorts</SelectItem>
                  {(cohorts.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-[150px]" aria-label="Filter by status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {INTERN_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {board.isLoading && <Skeleton className="h-32 w-full" />}
          {!board.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No interns match these filters.</p>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Intern</th>
                    <th className="py-2 pr-3">Track</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Level</th>
                    <th className="py-2 pr-3">Index</th>
                    <th className="py-2 pr-3">Learning</th>
                    <th className="py-2 pr-3">Accepted work</th>
                    <th className="py-2 pr-3">Verified revenue</th>
                    <th className="py-2 pr-3">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.intern_id} className="border-t">
                      <td className="py-2 pr-3">
                        <Link className="font-medium underline-offset-2 hover:underline" to={`/staff/interns/${r.intern_id}`}>
                          {r.full_name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {r.institution ?? "institution not recorded"}
                        </span>
                      </td>
                      <td className="py-2 pr-3">{r.track_name ?? "—"}</td>
                      <td className="py-2 pr-3"><Badge variant="outline">{r.status}</Badge></td>
                      <td className="py-2 pr-3">
                        <Badge variant={talentTone(r.talent_level)}>{TALENT_LEVEL_LABEL[r.talent_level]}</Badge>
                      </td>
                      <td className="py-2 pr-3 font-semibold">{pct(r.performance_index)}</td>
                      <td className="py-2 pr-3">{r.validated_modules}</td>
                      <td className="py-2 pr-3">{r.accepted_work}</td>
                      <td className="py-2 pr-3">{money(r.verified_revenue_kes)}</td>
                      <td className="py-2 pr-3">
                        {r.open_integrity_flags > 0 ? (
                          <Badge variant="destructive">{r.open_integrity_flags}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">clear</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
