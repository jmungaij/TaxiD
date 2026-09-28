import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarPlus } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

import * as api from "@/lib/interns/api";
import { money, pct } from "@/lib/interns/types";

const COHORT_STATUSES = [
  "PLANNED", "RECRUITING", "SELECTION", "ONBOARDING", "ACTIVE", "ASSESSMENT", "COMPLETION", "CLOSED",
] as const;

/**
 * Cohort management — an intake is a governed object with a calendar, an
 * intended size and an operating status, so the weekly rhythm has something
 * concrete to run against.
 */
export default function InternCohorts() {
  const qc = useQueryClient();
  const programmes = useQuery({ queryKey: ["interns", "programmes"], queryFn: api.listProgrammes });
  const health = useQuery({ queryKey: ["interns", "cohortHealth"], queryFn: api.listCohortHealth });
  const tracks = useQuery({ queryKey: ["interns", "tracks"], queryFn: api.listTracks });

  const [form, setForm] = useState({
    name: "",
    start_date: "",
    end_date: "",
    duration_weeks: "12",
    intake_size: "10",
    target_outcomes: "",
  });

  const create = useMutation({
    mutationFn: async () => {
      const programme = programmes.data?.[0];
      if (!programme) throw new Error("No programme found.");
      if (!form.name.trim()) throw new Error("Give the cohort a name.");
      return api.createCohort({
        programme_id: programme.id,
        name: form.name.trim(),
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        duration_weeks: form.duration_weeks ? Number(form.duration_weeks) : null,
        intake_size: form.intake_size ? Number(form.intake_size) : null,
        target_outcomes: form.target_outcomes.trim() || null,
      });
    },
    onSuccess: () => {
      toast({ title: "Cohort created", description: "Enrol selected candidates from the intern register." });
      setForm({ name: "", start_date: "", end_date: "", duration_weeks: "12", intake_size: "10", target_outcomes: "" });
      void qc.invalidateQueries({ queryKey: ["interns"] });
    },
    onError: (e: Error) => toast({ title: "Could not create cohort", description: e.message, variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.setCohortStatus(id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["interns"] }),
    onError: (e: Error) => toast({ title: "Could not update cohort", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <StaffPageHeader
        eyebrow="Interns 360"
        title="Cohorts"
        lede="Every intern belongs to one intake with a start, an end and an intended size. Cohort health is calculated from intern records, never entered by hand."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cohort register</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {health.isLoading && <Skeleton className="h-24 w-full" />}
            {!health.isLoading && (health.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No cohorts yet.</p>
            )}
            {(health.data ?? []).map((c) => (
              <div key={c.cohort_id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{c.cohort_name}</div>
                    <p className="text-xs text-muted-foreground">
                      {c.start_date ?? "start TBC"} → {c.end_date ?? "end TBC"} ·{" "}
                      {c.enrolled} enrolled{c.intake_size ? ` of ${c.intake_size}` : ""} · {c.active} active ·{" "}
                      {c.completed} completed · {c.exited} exited
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">avg index {pct(c.avg_performance_index)}</Badge>
                    <Select value={c.status} onValueChange={(v) => setStatus.mutate({ id: c.cohort_id, status: v })}>
                      <SelectTrigger className="h-8 w-[150px]" aria-label={`Cohort status for ${c.cohort_name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COHORT_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span>Verified revenue: <strong className="text-foreground">{money(c.verified_revenue_kes)}</strong></span>
                  <span>TaxiD Talent: <strong className="text-foreground">{c.yalla_talent}</strong></span>
                  <span>Open integrity flags: <strong className="text-foreground">{c.open_integrity_flags}</strong></span>
                  <Link className="underline" to={`/staff/interns/register?cohort=${c.cohort_id}`}>
                    View interns
                  </Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New intake</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="cohort-name">Cohort name</Label>
              <Input
                id="cohort-name"
                value={form.name}
                placeholder="YMEITA 2026 Cohort 1"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cohort-start">Start</Label>
                <Input id="cohort-start" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="cohort-end">End</Label>
                <Input id="cohort-end" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="cohort-weeks">Duration (weeks)</Label>
                <Input id="cohort-weeks" type="number" min={1} value={form.duration_weeks} onChange={(e) => setForm({ ...form, duration_weeks: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="cohort-size">Intake size</Label>
                <Input id="cohort-size" type="number" min={1} value={form.intake_size} onChange={(e) => setForm({ ...form, intake_size: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="cohort-outcomes">Intended outcomes</Label>
              <Textarea
                id="cohort-outcomes"
                rows={3}
                value={form.target_outcomes}
                placeholder="What this intake must deliver by the end date"
                onChange={(e) => setForm({ ...form, target_outcomes: e.target.value })}
              />
            </div>
            <Button className="w-full" disabled={create.isPending} onClick={() => create.mutate()}>
              <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden /> Create cohort
            </Button>
            <p className="text-xs text-muted-foreground">
              Learning pathways are assigned automatically on enrolment from the intern's track.
              Tracks available: {(tracks.data ?? []).length}.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
