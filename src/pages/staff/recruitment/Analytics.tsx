import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import {
  assignAttentionItem,
  buildAttentionQueue,
  dismissAttentionItem,
  resolveAttentionItem,
  SEVERITY_TONE,
  type AttentionItem,
} from "@/lib/recruitment/attention";
import { listStaff } from "@/lib/staff/org/api";
import { AskYallaRecruitment } from "@/components/staff/recruitment/AskYallaRecruitment";
import { APPLICATION_STAGES, CLOSED_STAGES, STAGE_LABEL, daysSince, titleise } from "@/lib/recruitment/types";

type PendingAction = { item: AttentionItem; kind: "resolve" | "dismiss" };

export default function RecruitmentAnalytics() {
  const qc = useQueryClient();

  const [vacancies, applications, interviews, offers, slas, audit, pool] = useQueries({
    queries: [
      { queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies },
      { queryKey: ["rec", "applications"], queryFn: () => rec.listApplications() },
      { queryKey: ["rec", "interviews"], queryFn: rec.listInterviews },
      { queryKey: ["rec", "offers"], queryFn: rec.listOffers },
      { queryKey: ["rec", "slas"], queryFn: rec.listSlaPolicies },
      { queryKey: ["rec", "audit"], queryFn: () => rec.listAuditEvents() },
      { queryKey: ["rec", "talentPool"], queryFn: rec.listTalentPoolEntries },
    ],
  });

  const staff = useQuery({ queryKey: ["rec", "staffOptions"], queryFn: listStaff });

  const loading = [vacancies, applications, interviews, offers, slas, audit].some((q) => q.isLoading);

  const queue = useMemo(
    () =>
      buildAttentionQueue({
        vacancies: vacancies.data ?? [],
        applications: applications.data ?? [],
        interviews: interviews.data ?? [],
        offers: offers.data ?? [],
        slaPolicies: slas.data ?? [],
        auditEvents: (audit.data ?? []).map((e) => ({ action: e.action, context: (e.context ?? {}) as Record<string, unknown> })),
      }),
    [vacancies.data, applications.data, interviews.data, offers.data, slas.data, audit.data],
  );

  const kpis = useMemo(() => {
    const apps = applications.data ?? [];
    const active = apps.filter((a) => a.status === "active");
    const openVacancies = (vacancies.data ?? []).filter((v) => v.status === "open");
    const hired = apps.filter((a) => a.stage === "hired");
    const closed = apps.filter((a) => CLOSED_STAGES.includes(a.stage as (typeof CLOSED_STAGES)[number]) || a.stage === "hired");
    const acceptedOffers = (offers.data ?? []).filter((o) => o.status === "accepted");
    const decidedOffers = (offers.data ?? []).filter((o) => ["accepted", "declined"].includes(o.status));
    const fillDays = openVacancies.map((v) => daysSince(v.opened_at));
    return [
      { label: "Open vacancies", value: String(openVacancies.length), hint: `${(vacancies.data ?? []).length} total in register` },
      { label: "Active applications", value: String(active.length), hint: `${apps.length} lifetime` },
      {
        label: "Avg. days open",
        value: fillDays.length ? String(Math.round(fillDays.reduce((a, b) => a + b, 0) / fillDays.length)) : "—",
        hint: fillDays.length ? "Across open vacancies" : "No open vacancies",
      },
      {
        label: "Offer acceptance",
        value: decidedOffers.length ? `${Math.round((acceptedOffers.length / decidedOffers.length) * 100)}%` : "—",
        hint: decidedOffers.length ? `${acceptedOffers.length}/${decidedOffers.length} decided offers` : "No decided offers yet",
      },
      {
        label: "Hire conversion",
        value: closed.length ? `${Math.round((hired.length / closed.length) * 100)}%` : "—",
        hint: closed.length ? `${hired.length} hired of ${closed.length} concluded` : "No concluded applications",
      },
      { label: "Attention items", value: String(queue.length), hint: `${queue.filter((q) => q.severity === "critical").length} critical` },
    ];
  }, [applications.data, vacancies.data, offers.data, queue]);

  const funnel = useMemo(() => {
    const apps = applications.data ?? [];
    return APPLICATION_STAGES.filter((s) => !CLOSED_STAGES.includes(s as (typeof CLOSED_STAGES)[number])).map((stage) => ({
      stage,
      count: apps.filter((a) => a.stage === stage).length,
    }));
  }, [applications.data]);

  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [note, setNote] = useState("");
  const [assigning, setAssigning] = useState<AttentionItem | null>(null);
  const [assignee, setAssignee] = useState("");

  const act = useMutation({
    mutationFn: async ({ item, kind }: PendingAction) => {
      if (!note.trim()) throw new Error("Add a note so the decision is explainable.");
      if (kind === "resolve") await resolveAttentionItem(item, note.trim());
      else await dismissAttentionItem(item, note.trim());
    },
    onSuccess: () => {
      toast.success("Recorded in the recruitment audit trail.");
      setPending(null);
      setNote("");
      qc.invalidateQueries({ queryKey: ["rec"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assign = useMutation({
    mutationFn: async () => {
      if (!assigning || !assignee) throw new Error("Choose a recruiter to own this item.");
      await assignAttentionItem(assigning, assignee);
    },
    onSuccess: () => {
      toast.success("Recruiter assigned as the owner of this application.");
      setAssigning(null);
      setAssignee("");
      qc.invalidateQueries({ queryKey: ["rec"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Analytics & attention queue"
        lede="Live pipeline performance from authoritative recruitment records, and the work that is breaching a configured target."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          : kpis.map((k) => (
              <Card key={k.label}>
                <CardContent className="pt-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{k.label}</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight">{k.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>
                </CardContent>
              </Card>
            ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Pipeline funnel</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {funnel.map((f) => (
              <div key={f.stage} className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-xs text-muted-foreground">{STAGE_LABEL[f.stage] ?? titleise(f.stage)}</span>
                <div className="h-3 flex-1 rounded-full bg-muted">
                  <div className="h-3 rounded-full bg-primary" style={{ width: `${(f.count / maxFunnel) * 100}%` }} />
                </div>
                <span className="w-8 shrink-0 text-right text-xs font-medium">{f.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <AskYallaRecruitment
          vacancies={vacancies.data ?? []}
          applications={applications.data ?? []}
          interviews={interviews.data ?? []}
          offers={offers.data ?? []}
          attention={queue}
          talentPoolIdle={(pool.data ?? []).filter((p) => daysSince(p.last_engaged_at) > 90).length}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" /> Attention queue ({queue.length})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Derived from records against configured SLA targets. Resolving or dismissing an item is audited and replayable.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : queue.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Nothing is breaching a configured target. Adjust the thresholds in{" "}
              <Link to="/staff/recruitment/settings" className="text-primary underline">Settings</Link> if this looks too quiet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {queue.map((item) => (
                <li key={item.key} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-[240px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${SEVERITY_TONE[item.severity]}`}>
                        {item.severity.toUpperCase()}
                      </Badge>
                      <p className="text-sm font-medium">{item.title}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link to={item.to}>Open <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></Link>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setPending({ item, kind: "resolve" }); setNote(""); }}>
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Resolve
                    </Button>
                    {item.applicationId && (
                      <Button size="sm" variant="ghost" onClick={() => { setAssigning(item); setAssignee(""); }}>
                        <UserPlus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Assign
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => { setPending({ item, kind: "dismiss" }); setNote(""); }}>
                      <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.kind === "resolve" ? "Resolve item" : "Dismiss item"}</DialogTitle>
            <DialogDescription>{pending?.item.title}</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="attn-note">Note</Label>
            <Textarea id="attn-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={pending?.kind === "resolve" ? "What was done?" : "Why is this not a concern?"} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
            <Button onClick={() => pending && act.mutate(pending)} disabled={act.isPending || !note.trim()}>
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assigning} onOpenChange={(o) => !o && setAssigning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign owner</DialogTitle>
            <DialogDescription>{assigning?.title}</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="attn-assignee">Recruiter</Label>
            <select id="attn-assignee" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Select…</option>
              {(staff.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssigning(null)}>Cancel</Button>
            <Button onClick={() => assign.mutate()} disabled={assign.isPending || !assignee}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
