import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BadgeCheck, Calculator, Plus, ShieldAlert, Sparkles } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

import * as api from "@/lib/interns/api";
import {
  ATTRIBUTION_LABEL, ATTRIBUTION_TYPES, INTERN_STATUSES, PERFORMANCE_DIMENSIONS,
  TALENT_LEVEL_LABEL, TALENT_LEVEL_THRESHOLD, defaultPeriod, money, nextTalentLevel, pct, talentTone,
} from "@/lib/interns/types";

/**
 * INTERN 360 — one person, one record, one truth.
 *
 * Capability, learning, produced work, verified commercial contribution,
 * performance with a visible calculation, capstone, integrity and the decision
 * trail. Nothing on this page can be scored by the intern themselves.
 */
export default function Intern360() {
  const { internId = "" } = useParams();
  const qc = useQueryClient();
  const period = useMemo(defaultPeriod, []);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["interns"] });

  const profile = useQuery({ queryKey: ["interns", "profile", internId], queryFn: () => api.getIntern(internId) });
  const skills = useQuery({ queryKey: ["interns", "skills", internId], queryFn: () => api.listSkills(internId) });
  const learning = useQuery({ queryKey: ["interns", "learning", internId], queryFn: () => api.listLearning(internId) });
  const work = useQuery({ queryKey: ["interns", "work", internId], queryFn: () => api.listWork(internId) });
  const attributions = useQuery({ queryKey: ["interns", "attr", internId], queryFn: () => api.listAttributions(internId) });
  const scores = useQuery({ queryKey: ["interns", "scores", internId], queryFn: () => api.listScores(internId) });
  const capstones = useQuery({ queryKey: ["interns", "capstones", internId], queryFn: () => api.listCapstones(internId) });
  const flags = useQuery({ queryKey: ["interns", "flags", internId], queryFn: () => api.listFlags(internId) });
  const audit = useQuery({ queryKey: ["interns", "audit", internId], queryFn: () => api.listAudit(internId, 50) });
  const reviews = useQuery({ queryKey: ["interns", "reviews", internId], queryFn: () => api.listReviews(internId) });
  const matches = useQuery({ queryKey: ["interns", "match", internId], queryFn: () => api.matchTracks(internId) });

  const latest = scores.data?.[0] ?? null;
  const breakdown = (latest?.breakdown ?? {}) as Record<string, Record<string, unknown>>;

  const fail = (e: Error) => toast({ title: "Action refused", description: e.message, variant: "destructive" });

  const compute = useMutation({
    mutationFn: () => api.computePerformance(internId, period.start, period.end),
    onSuccess: () => { toast({ title: "Performance recalculated from evidence" }); invalidate(); },
    onError: fail,
  });

  const promote = useMutation({
    mutationFn: (level: string) => api.promoteLevel(internId, level, "Promoted from Intern 360"),
    onSuccess: () => { toast({ title: "Talent level updated" }); invalidate(); },
    onError: fail,
  });

  const scan = useMutation({
    mutationFn: () => api.scanIntegrity(internId),
    onSuccess: (r) => { toast({ title: "Integrity scan complete", description: `${r.flags_raised} signal(s) raised for review.` }); invalidate(); },
    onError: fail,
  });

  const recommend = useMutation({
    mutationFn: () => api.recommendConversion(internId),
    onSuccess: (r) => { toast({ title: "Conversion recommendation", description: `Recommended: ${r.recommended_outcome}` }); invalidate(); },
    onError: fail,
  });

  const setStatus = useMutation({
    mutationFn: (status: string) => api.updateIntern(internId, { status: status as never }),
    onSuccess: invalidate,
    onError: fail,
  });

  const validate = useMutation({
    mutationFn: ({ id, score }: { id: string; score: number | null }) => api.validateCompetency(id, score),
    onSuccess: () => { toast({ title: "Competency validated" }); invalidate(); },
    onError: fail,
  });

  const [deliverables, setDeliverables] = useState<Record<string, string>>({});
  const [qualities, setQualities] = useState<Record<string, string>>({});
  const [capEvidence, setCapEvidence] = useState<Record<string, string>>({});

  const submitCapstone = useMutation({
    mutationFn: (v: { id: string }) => api.submitCapstone(v.id, capEvidence[v.id] ?? ""),
    onSuccess: () => { toast({ title: "Capstone sealed", description: "The submission is now immutable until a mentor returns it." }); invalidate(); },
    onError: fail,
  });

  const reviewCapstone = useMutation({
    mutationFn: (v: { id: string; decision: "under_review" | "returned" | "scored"; notes?: string }) =>
      api.reviewCapstone(
        v.id,
        v.decision,
        v.decision === "scored"
          ? { score_problem: 80, score_solution: 80, score_execution: 80, score_impact: 80 }
          : undefined,
        v.notes ?? null,
      ),
    onSuccess: () => { toast({ title: "Capstone reviewed" }); invalidate(); },
    onError: fail,
  });


  const submitWork = useMutation({
    mutationFn: (v: { id: string }) => api.submitWork(v.id, deliverables[v.id] ?? ""),
    onSuccess: () => { toast({ title: "Work submitted", description: "Evidence recorded and sent for validation." }); invalidate(); },
    onError: fail,
  });

  const reviewWork = useMutation({
    mutationFn: (v: { id: string; status: "ACCEPTED" | "REWORK"; quality_score: number }) =>
      api.reviewWork(v.id, { status: v.status, quality_score: v.quality_score }),
    onSuccess: () => { toast({ title: "Work reviewed" }); invalidate(); },
    onError: fail,
  });


  const verify = useMutation({
    mutationFn: ({ id, source }: { id: string; source: string }) => api.verifyAttribution(id, source),
    onSuccess: () => { toast({ title: "Contribution verified", description: "It now counts towards the commercial score." }); invalidate(); },
    onError: fail,
  });

  const [newWork, setNewWork] = useState({ title: "", deadline: "", quality_criteria: "", complexity: "2", impact: "2" });
  const addWork = useMutation({
    mutationFn: () => {
      if (!newWork.title.trim()) throw new Error("Give the work a title.");
      return api.createWork({
        intern_id: internId,
        title: newWork.title.trim(),
        deadline: newWork.deadline ? new Date(newWork.deadline).toISOString() : null,
        quality_criteria: newWork.quality_criteria.trim() || null,
        complexity: Number(newWork.complexity),
        impact: Number(newWork.impact),
      });
    },
    onSuccess: () => {
      setNewWork({ title: "", deadline: "", quality_criteria: "", complexity: "2", impact: "2" });
      toast({ title: "Work assigned" });
      invalidate();
    },
    onError: fail,
  });

  const [newAttr, setNewAttr] = useState({ attribution_type: "LEAD_CREATED", subject_ref: "", amount_kes: "" });
  const addAttr = useMutation({
    mutationFn: () =>
      api.createAttribution({
        intern_id: internId,
        attribution_type: newAttr.attribution_type,
        subject_ref: newAttr.subject_ref.trim() || null,
        amount_kes: newAttr.amount_kes ? Number(newAttr.amount_kes) : null,
      }),
    onSuccess: () => {
      setNewAttr({ attribution_type: "LEAD_CREATED", subject_ref: "", amount_kes: "" });
      toast({ title: "Contribution recorded", description: "It counts only once verified against a source system." });
      invalidate();
    },
    onError: fail,
  });

  const [review, setReview] = useState({ strengths: "", concerns: "", coaching: "", rating: "3" });
  const addReview = useMutation({
    mutationFn: () =>
      api.createReview({
        intern_id: internId,
        review_type: "weekly",
        strengths: review.strengths.trim() || null,
        concerns: review.concerns.trim() || null,
        coaching: review.coaching.trim() || null,
        subjective_rating: Number(review.rating),
      }),
    onSuccess: () => {
      setReview({ strengths: "", concerns: "", coaching: "", rating: "3" });
      toast({ title: "Weekly review recorded" });
      invalidate();
    },
    onError: fail,
  });

  if (profile.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const p = profile.data;
  if (!p) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm">This intern record is not available to you, or does not exist.</p>
          <Button asChild size="sm" variant="outline">
            <Link to="/staff/interns/register"><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Back to register</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const next = nextTalentLevel(p.talent_level);

  return (
    <div className="space-y-6">
      <StaffPageHeader
        eyebrow="Interns 360"
        title={p.full_name}
        lede={`${p.programme_of_study ?? "Course not recorded"} · ${p.institution ?? "Institution not recorded"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={talentTone(p.talent_level)}>{TALENT_LEVEL_LABEL[p.talent_level]}</Badge>
            <Select value={p.status} onValueChange={(v) => setStatus.mutate(v)}>
              <SelectTrigger className="h-9 w-[160px]" aria-label="Intern lifecycle status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERN_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={compute.isPending} onClick={() => compute.mutate()}>
              <Calculator className="mr-1.5 h-4 w-4" aria-hidden /> Recalculate
            </Button>
            <Button size="sm" variant="outline" disabled={scan.isPending} onClick={() => scan.mutate()}>
              <ShieldAlert className="mr-1.5 h-4 w-4" aria-hidden /> Integrity scan
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Performance index {latest ? pct(latest.performance_index) : "not yet calculated"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!latest && (
              <p className="text-sm text-muted-foreground">
                No score yet. Recalculate to derive it from validated learning, accepted work,
                verified contribution, on-time delivery and conduct.
              </p>
            )}
            {latest && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PERFORMANCE_DIMENSIONS.map((d) => (
                    <div key={d.key}>
                      <div className="flex items-center justify-between text-xs">
                        <span>{d.label}</span>
                        <span className="font-semibold">{pct(latest[d.key])}</span>
                      </div>
                      <Progress className="mt-1 h-1.5" value={Math.min(100, Number(latest[d.key] ?? 0))} />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Period {latest.period_start} → {latest.period_end} · evidence confidence{" "}
                  {pct(latest.evidence_confidence)} · weighted by the track's own weightings.
                </p>
                <details className="rounded-md border bg-muted/30 p-3 text-xs">
                  <summary className="cursor-pointer font-medium">How each number was calculated</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(breakdown, null, 2)}</pre>
                </details>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Talent decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Current level</div>
              <div className="font-semibold">{TALENT_LEVEL_LABEL[p.talent_level]}</div>
            </div>
            {next && (
              <div className="rounded-md border p-3 text-xs">
                <div className="font-medium">Next: {TALENT_LEVEL_LABEL[next]}</div>
                <p className="mt-1 text-muted-foreground">
                  Requires index ≥ {TALENT_LEVEL_THRESHOLD[next]}, validated learning and accepted work.
                </p>
                <Button className="mt-2 w-full" size="sm" disabled={promote.isPending} onClick={() => promote.mutate(next)}>
                  <BadgeCheck className="mr-1.5 h-4 w-4" aria-hidden /> Promote
                </Button>
              </div>
            )}
            <Button className="w-full" size="sm" variant="outline" disabled={recommend.isPending} onClick={() => recommend.mutate()}>
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden /> Recommend conversion
            </Button>
            <div className="text-xs text-muted-foreground">
              Open integrity flags:{" "}
              {(flags.data ?? []).filter((f) => f.status === "REVIEW_REQUIRED").length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="learn">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="learn">Learn</TabsTrigger>
          <TabsTrigger value="produce">Produce</TabsTrigger>
          <TabsTrigger value="sell">Sell</TabsTrigger>
          <TabsTrigger value="capability">Capability</TabsTrigger>
          <TabsTrigger value="rhythm">Rhythm</TabsTrigger>
          <TabsTrigger value="capstone">Capstone</TabsTrigger>
          <TabsTrigger value="trail">Decision trail</TabsTrigger>
        </TabsList>

        <TabsContent value="learn" className="mt-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Learning pathway</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(learning.data ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No modules assigned — set the intern's track to assign a pathway.</p>
              )}
              {(learning.data ?? []).map((lp) => (
                <div key={lp.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="text-sm">
                    <div className="font-medium">
                      {lp.intern_learning_modules?.code} · {lp.intern_learning_modules?.title}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {lp.intern_learning_modules?.competency} · {lp.intern_learning_modules?.hours}h
                      {lp.application_evidence ? " · applied evidence attached" : " · no applied evidence"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={lp.status === "validated" ? "default" : "outline"}>{lp.status}</Badge>
                    {lp.status !== "validated" && (
                      <Button size="sm" variant="outline" onClick={() => validate.mutate({ id: lp.id, score: lp.assessment_score ?? 80 })}>
                        Validate
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="produce" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Assign work</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-5">
              <div className="md:col-span-2">
                <Label htmlFor="work-title">Title</Label>
                <Input id="work-title" value={newWork.title} onChange={(e) => setNewWork({ ...newWork, title: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="work-deadline">Deadline</Label>
                <Input id="work-deadline" type="date" value={newWork.deadline} onChange={(e) => setNewWork({ ...newWork, deadline: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="work-complexity">Complexity 1–5</Label>
                <Input id="work-complexity" type="number" min={1} max={5} value={newWork.complexity} onChange={(e) => setNewWork({ ...newWork, complexity: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="work-impact">Impact 1–5</Label>
                <Input id="work-impact" type="number" min={1} max={5} value={newWork.impact} onChange={(e) => setNewWork({ ...newWork, impact: e.target.value })} />
              </div>
              <div className="md:col-span-4">
                <Label htmlFor="work-criteria">Quality criteria</Label>
                <Input id="work-criteria" value={newWork.quality_criteria} onChange={(e) => setNewWork({ ...newWork, quality_criteria: e.target.value })} />
              </div>
              <div className="flex items-end">
                <Button className="w-full" disabled={addWork.isPending} onClick={() => addWork.mutate()}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Assign
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Work produced</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(work.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No work assigned yet.</p>}
              {(work.data ?? []).map((w) => (
                <div key={w.id} className="space-y-2 rounded-md border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <div className="font-medium">{w.title}</div>
                      <span className="text-xs text-muted-foreground">
                        {w.deadline ? `due ${new Date(w.deadline).toLocaleDateString()}` : "no deadline"} · complexity {w.complexity} ·
                        impact {w.impact} · rework {w.rework_count}
                        {w.quality_score !== null ? ` · quality ${w.quality_score}` : ""}
                      </span>
                    </div>
                    <Badge variant={w.status === "ACCEPTED" || w.status === "COMPLETED" ? "default" : "outline"}>{w.status}</Badge>
                  </div>

                  {["BACKLOG", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "REWORK"].includes(w.status) && (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[220px] flex-1">
                        <Label htmlFor={`deliverable-${w.id}`} className="text-xs">Deliverable evidence (link)</Label>
                        <Input
                          id={`deliverable-${w.id}`}
                          placeholder="https://…"
                          value={deliverables[w.id] ?? w.deliverable_url ?? ""}
                          onChange={(e) => setDeliverables({ ...deliverables, [w.id]: e.target.value })}
                        />
                      </div>
                      <Button size="sm" disabled={submitWork.isPending} onClick={() => submitWork.mutate({ id: w.id })}>
                        Submit for validation
                      </Button>
                    </div>
                  )}

                  {["SUBMITTED", "UNDER_REVIEW"].includes(w.status) && (
                    <div className="flex flex-wrap items-end gap-2">
                      {w.deliverable_url && (
                        <a href={w.deliverable_url} target="_blank" rel="noreferrer" className="text-xs underline">
                          Open deliverable
                        </a>
                      )}
                      <div className="w-32">
                        <Label htmlFor={`quality-${w.id}`} className="text-xs">Quality (0–100)</Label>
                        <Input
                          id={`quality-${w.id}`}
                          type="number"
                          min={0}
                          max={100}
                          value={qualities[w.id] ?? "80"}
                          onChange={(e) => setQualities({ ...qualities, [w.id]: e.target.value })}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reviewWork.mutate({ id: w.id, status: "ACCEPTED", quality_score: Number(qualities[w.id] ?? 80) })}
                      >
                        Accept
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => reviewWork.mutate({ id: w.id, status: "REWORK", quality_score: 50 })}>
                        Return for rework
                      </Button>
                    </div>
                  )}
                </div>

              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sell" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Record a commercial contribution</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <div>
                <Label htmlFor="attr-type">Type</Label>
                <Select value={newAttr.attribution_type} onValueChange={(v) => setNewAttr({ ...newAttr, attribution_type: v })}>
                  <SelectTrigger id="attr-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ATTRIBUTION_TYPES.map((t) => <SelectItem key={t} value={t}>{ATTRIBUTION_LABEL[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="attr-ref">Source reference</Label>
                <Input id="attr-ref" placeholder="Lead / quote / booking reference" value={newAttr.subject_ref} onChange={(e) => setNewAttr({ ...newAttr, subject_ref: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="attr-amount">Amount (KES)</Label>
                <Input id="attr-amount" type="number" min={0} value={newAttr.amount_kes} onChange={(e) => setNewAttr({ ...newAttr, amount_kes: e.target.value })} />
              </div>
              <div className="flex items-end">
                <Button className="w-full" disabled={addAttr.isPending} onClick={() => addAttr.mutate()}>Record</Button>
              </div>
              <p className="md:col-span-4 text-xs text-muted-foreground">
                Recorded claims are unverified. Revenue only counts once verified against an
                authoritative source system — a declaration alone never scores.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Contribution ledger</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(attributions.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>}
              {(attributions.data ?? []).map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{ATTRIBUTION_LABEL[a.attribution_type]}</div>
                    <span className="text-xs text-muted-foreground">
                      {a.subject_ref ?? "no reference"} · {a.amount_kes ? money(a.amount_kes) : "no value"} · source {a.source_system}
                    </span>
                  </div>
                  {a.verified ? (
                    <Badge>Verified</Badge>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => verify.mutate({ id: a.id, source: "crm" })}>
                      Verify against CRM
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="capability" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Skills graph</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(skills.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No assessed skills yet.</p>}
              {(skills.data ?? []).map((s) => (
                <div key={s.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{s.skill}</span>
                    <Badge variant="outline">level {s.level}/5</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {s.category} · {s.classification} · confidence {s.confidence}
                    {s.evidence ? ` · evidence: ${s.evidence}` : " · no evidence recorded"}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Track fit</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(matches.data ?? []).slice(0, 6).map((m) => (
                <div key={m.track_id}>
                  <div className="flex items-center justify-between text-xs">
                    <span>{m.track_name}</span>
                    <span className="font-semibold">{pct(m.score)}</span>
                  </div>
                  <Progress className="mt-1 h-1.5" value={Math.min(100, m.score)} />
                  <p className="mt-1 text-[11px] text-muted-foreground">{m.reason}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rhythm" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Weekly review</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="rv-strengths">What went well</Label>
                <Textarea id="rv-strengths" rows={2} value={review.strengths} onChange={(e) => setReview({ ...review, strengths: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="rv-concerns">Concerns</Label>
                <Textarea id="rv-concerns" rows={2} value={review.concerns} onChange={(e) => setReview({ ...review, concerns: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="rv-coaching">Coaching for next week</Label>
                <Textarea id="rv-coaching" rows={2} value={review.coaching} onChange={(e) => setReview({ ...review, coaching: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="rv-rating">Supervisor rating (1–5)</Label>
                <Input id="rv-rating" type="number" min={1} max={5} value={review.rating} onChange={(e) => setReview({ ...review, rating: e.target.value })} />
              </div>
              <Button disabled={addReview.isPending} onClick={() => addReview.mutate()}>Record review</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Review history</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(reviews.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No reviews recorded yet.</p>}
              {(reviews.data ?? []).map((r) => (
                <div key={r.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.review_type}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()} · rating {r.subjective_rating ?? "—"}/5
                    </span>
                  </div>
                  {r.strengths && <p className="mt-1 text-xs">Strengths: {r.strengths}</p>}
                  {r.concerns && <p className="text-xs">Concerns: {r.concerns}</p>}
                  {r.coaching && <p className="text-xs">Coaching: {r.coaching}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="capstone" className="mt-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Capstone</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(capstones.data ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No capstone submitted. Every intern must solve one real business problem with a
                  measured outcome and a recommendation.
                </p>
              )}
              {(capstones.data ?? []).map((c) => (
                <div key={c.id} className="space-y-2 rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.title}</span>
                    <Badge variant={c.status === "scored" ? "default" : "outline"}>{c.status}</Badge>
                  </div>
                  {c.problem && <p className="mt-1 text-xs text-muted-foreground">Problem: {c.problem}</p>}
                  {c.measured_impact && <p className="text-xs text-muted-foreground">Measured impact: {c.measured_impact}</p>}
                  {c.total_score !== null && <p className="mt-1 text-xs">Score: {pct(c.total_score)}</p>}
                  {(c as { seal_fingerprint?: string | null }).seal_fingerprint && (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      Seal {(c as { seal_fingerprint?: string | null }).seal_fingerprint?.slice(0, 16)}…
                    </p>
                  )}

                  {["draft", "returned"].includes(c.status) && (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[220px] flex-1">
                        <Label htmlFor={`cap-evidence-${c.id}`} className="text-xs">Evidence (link)</Label>
                        <Input
                          id={`cap-evidence-${c.id}`}
                          placeholder="https://…"
                          value={capEvidence[c.id] ?? c.evidence_url ?? ""}
                          onChange={(e) => setCapEvidence({ ...capEvidence, [c.id]: e.target.value })}
                        />
                      </div>
                      <Button size="sm" disabled={submitCapstone.isPending} onClick={() => submitCapstone.mutate({ id: c.id })}>
                        Submit &amp; seal
                      </Button>
                    </div>
                  )}

                  {["submitted", "under_review"].includes(c.status) && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" disabled={reviewCapstone.isPending}
                        onClick={() => reviewCapstone.mutate({ id: c.id, decision: "scored" })}>
                        Score at rubric defaults
                      </Button>
                      <Button size="sm" variant="ghost" disabled={reviewCapstone.isPending}
                        onClick={() => reviewCapstone.mutate({ id: c.id, decision: "returned", notes: "Returned for revision" })}>
                        Return for revision
                      </Button>
                    </div>
                  )}
                </div>
              ))}

            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trail" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Integrity signals</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(flags.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No integrity signals raised.</p>}
              {(flags.data ?? []).map((f) => (
                <div key={f.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{f.signal.replace(/_/g, " ")}</span>
                    <Badge variant={f.status === "SUBSTANTIATED" ? "destructive" : "outline"}>{f.status}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(f.created_at).toLocaleString()} · {f.severity}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Decision trail</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(audit.data ?? []).map((a) => (
                <div key={a.id} className="rounded-md border px-3 py-2 text-xs">
                  <div className="font-medium">{a.action.replace(/_/g, " ")}</div>
                  <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()} · {a.entity}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
