/**
 * Recruitment 360 — Communications & Letter Centre.
 *
 * The operational console for official candidate correspondence: request a
 * letter, approve it under maker-checker, watch it render, dispatch and reach a
 * terminal delivery state, and inspect the full evidence trail (documents,
 * dispatch attempts, provider events, candidate responses).
 *
 * Nothing here writes lifecycle state directly — every action calls a governed
 * database function, and "delivered" is only ever asserted by a provider event.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2, FileText, Loader2, RefreshCw, ShieldCheck, XCircle,
} from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import * as letters from "@/lib/recruitment/letters";
import * as rec from "@/lib/recruitment/api";
import DeliveryTrackingPanel from "@/components/recruitment/DeliveryTrackingPanel";


const STATE_TONE: Record<string, string> = {
  pending_approval: "border-warning/50 text-warning",
  delivered: "border-success/50 text-success",
  failed: "border-destructive/50 text-destructive",
  cancelled: "border-muted text-muted-foreground",
  superseded: "border-muted text-muted-foreground",
};

function StateBadge({ state }: { state: string }) {
  return (
    <Badge variant="outline" className={`text-[10px] ${STATE_TONE[state] ?? "border-primary/30 text-primary"}`}>
      {letters.STATE_LABEL[state] ?? state}
    </Badge>
  );
}

export default function LetterCentre() {
  const qc = useQueryClient();
  const [openRequest, setOpenRequest] = useState<letters.LetterRequest | null>(null);
  const [reason, setReason] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [issue, setIssue] = useState({ applicationId: "", commType: "interview_invitation" });

  const requests = useQuery({ queryKey: ["rec", "letters"], queryFn: () => letters.listLetterRequests() });
  const templates = useQuery({ queryKey: ["rec", "letterTemplates"], queryFn: letters.listLetterTemplates });
  const applications = useQuery({ queryKey: ["rec", "applications"], queryFn: () => rec.listApplications() });
  const documents = useQuery({ queryKey: ["rec", "letterDocuments"], queryFn: () => letters.listLetterDocuments() });

  const attempts = useQuery({
    queryKey: ["rec", "letterAttempts", openRequest?.id],
    queryFn: () => letters.listLetterAttempts(openRequest!.id),
    enabled: Boolean(openRequest),
  });
  const events = useQuery({
    queryKey: ["rec", "letterEvents", openRequest?.id],
    queryFn: () => letters.listProviderEvents(openRequest!.id),
    enabled: Boolean(openRequest),
  });
  const actions = useQuery({
    queryKey: ["rec", "letterActions", openRequest?.id],
    queryFn: () => letters.listCandidateActions(openRequest!.id),
    enabled: Boolean(openRequest),
  });

  const rows = requests.data ?? [];
  const health = useMemo(() => letters.letterHealth(rows), [rows]);
  const activeTemplates = (templates.data ?? []).filter((t) => t.status === "active");
  const docFor = (requestId: string) => (documents.data ?? []).find((d) => d.request_id === requestId);

  const refresh = () => qc.invalidateQueries({ queryKey: ["rec"] });

  const create = useMutation({
    mutationFn: () => {
      if (!issue.applicationId) throw new Error("Choose the application this letter belongs to.");
      return letters.createLetterRequest({
        comm_type: issue.commType,
        application_id: issue.applicationId,
        idempotency_key: `${issue.commType}:${issue.applicationId}`,
      });
    },
    onSuccess: () => { toast.success("Letter requested and queued for approval."); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: (r: letters.LetterRequest) => letters.approveLetterRequest(r.id, approvalNote || undefined),
    onSuccess: () => { toast.success("Letter approved — the worker will seal and dispatch it."); setApprovalNote(""); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: (r: letters.LetterRequest) => letters.cancelLetterRequest(r.id, reason),
    onSuccess: () => { toast.success("Letter cancelled."); setReason(""); setOpenRequest(null); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const supersede = useMutation({
    mutationFn: (r: letters.LetterRequest) =>
      letters.supersedeLetterRequest({
        request_id: r.id,
        reason,
        replacement: {
          comm_type: r.comm_type,
          template_key: r.template_key,
          application_id: r.application_id,
          interview_id: r.interview_id,
          offer_id: r.offer_id,
        },
      }),
    onSuccess: () => {
      toast.success("Replacement letter created; the original is preserved as superseded.");
      setReason(""); setOpenRequest(null); refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const worker = useMutation({
    mutationFn: (action: letters.WorkerAction) => letters.runLetterWorker(action),
    onSuccess: (data) => { toast.success(`Worker run complete: ${JSON.stringify(data)}`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const openDocument = useMutation({
    mutationFn: async (r: letters.LetterRequest) => {
      const doc = docFor(r.id);
      if (!doc) throw new Error("No sealed document exists for this letter yet.");
      return letters.signedLetterUrl(doc);
    },
    onSuccess: (url) => window.open(url, "_blank", "noopener,noreferrer"),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Communications & letters"
        lede="Official candidate correspondence under maker-checker control: requested, approved, sealed, dispatched and reconciled to a terminal state."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => worker.mutate("all")} disabled={worker.isPending}>
              {worker.isPending
                ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
                : <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />}
              Run letter worker now
            </Button>
            <Button variant="ghost" size="sm" onClick={refresh}>Refresh letter queue</Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Letters", value: health.total },
          { label: "Awaiting approval", value: health.awaiting_approval },
          { label: "In flight", value: health.in_flight },
          { label: "Delivered", value: health.delivered },
          { label: "Failed", value: health.failed },
          { label: "Delivery rate", value: `${health.delivery_rate}%` },
        ].map((k) => (
          <Card key={k.label}><CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold">{k.value}</div>
          </CardContent></Card>
        ))}
      </div>

      {health.stalled > 0 && (
        <p className="mb-4 text-sm text-warning" role="status">
          {health.stalled} letter{health.stalled === 1 ? "" : "s"} have been in flight longer than expected.
          Run the worker to reconcile them.
        </p>
      )}

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Letter queue</TabsTrigger>
          <TabsTrigger value="issue">Request a letter</TabsTrigger>
          <TabsTrigger value="delivery">Delivery tracking</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="delivery" className="mt-4">
          <DeliveryTrackingPanel />
        </TabsContent>


        <TabsContent value="queue" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">All letters</CardTitle></CardHeader>
            <CardContent className="p-0">
              {requests.isLoading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
                </div>
              ) : rows.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  No letters have been requested yet. Use “Request a letter” to issue the first one.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {rows.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {letters.COMM_TYPE_LABEL[r.comm_type] ?? r.comm_type} · {r.recipient_name}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {r.document_ref} · revision {r.revision} · template {r.template_key} v{r.template_version}
                          {r.attempts ? ` · ${r.attempts} dispatch attempt${r.attempts === 1 ? "" : "s"}` : ""}
                        </p>
                        {r.last_error && (
                          <p className="mt-1 text-xs text-destructive">Last error: {r.last_error}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StateBadge state={r.state} />
                        {r.state === "pending_approval" && (
                          <Button size="sm" onClick={() => approve.mutate(r)} disabled={approve.isPending}>
                            <ShieldCheck className="mr-1 h-4 w-4" aria-hidden="true" />
                            Approve this letter
                          </Button>
                        )}
                        {docFor(r.id) && (
                          <Button size="sm" variant="outline"
                            onClick={() => openDocument.mutate(r)} disabled={openDocument.isPending}>
                            <FileText className="mr-1 h-4 w-4" aria-hidden="true" />
                            Open sealed letter
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => { setOpenRequest(r); setReason(""); }}>
                          View evidence trail
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="issue" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Request an official letter</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="letter-app">Application</Label>
                  <select
                    id="letter-app"
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={issue.applicationId}
                    onChange={(e) => setIssue({ ...issue, applicationId: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {(applications.data ?? []).map((a: { id: string; application_no: string; stage: string }) => (
                      <option key={a.id} value={a.id}>{a.application_no} · {a.stage}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="letter-type">Letter type</Label>
                  <select
                    id="letter-type"
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={issue.commType}
                    onChange={(e) => setIssue({ ...issue, commType: e.target.value })}
                  >
                    {Object.entries(letters.COMM_TYPE_LABEL).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Label htmlFor="letter-approval-note">Approval note (optional, recorded on approval)</Label>
                <Textarea id="letter-approval-note" rows={2} value={approvalNote}
                  onChange={(e) => setApprovalNote(e.target.value)} />
              </div>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Request this letter
              </Button>
              <p className="text-xs text-muted-foreground">
                The letter body is rendered server-side from authoritative records only. Repeating this
                request for the same application and letter type returns the existing letter rather than
                issuing a duplicate.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Letter templates</CardTitle></CardHeader>
            <CardContent className="p-0">
              {templates.isLoading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {(templates.data ?? []).map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-medium">{t.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.template_key} v{t.version} · {t.classification}
                          {t.requires_approval ? " · approval required" : ""}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{t.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <p className="mt-3 text-xs text-muted-foreground">
            {activeTemplates.length} active template{activeTemplates.length === 1 ? "" : "s"}. Active
            templates are frozen — corrections are issued as a new version, and historical letters keep
            the exact text that was sent.
          </p>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(openRequest)} onOpenChange={(o) => !o && setOpenRequest(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {openRequest ? `${letters.COMM_TYPE_LABEL[openRequest.comm_type] ?? openRequest.comm_type} — ${openRequest.document_ref}` : ""}
            </DialogTitle>
            <DialogDescription>
              Append-only evidence trail: dispatch attempts, provider events and the candidate's own response.
            </DialogDescription>
          </DialogHeader>

          {openRequest && (
            <div className="space-y-5 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <div><span className="text-xs text-muted-foreground">State</span><div><StateBadge state={openRequest.state} /></div></div>
                <div>
                  <span className="text-xs text-muted-foreground">Recipient</span>
                  <div>{openRequest.recipient_name} · {openRequest.recipient_email}</div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Approved</span>
                  <div>{openRequest.approved_at ? new Date(openRequest.approved_at).toLocaleString() : "Not yet"}</div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Delivered</span>
                  <div>{openRequest.delivered_at ? new Date(openRequest.delivered_at).toLocaleString() : "Not confirmed by provider"}</div>
                </div>
              </div>

              <section>
                <h3 className="mb-2 font-semibold">Dispatch attempts</h3>
                {(attempts.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No dispatch attempted yet.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {(attempts.data ?? []).map((a) => (
                      <li key={a.id} className="flex items-center gap-2">
                        {a.outcome === "sent"
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                          : <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />}
                        Attempt {a.attempt} · {a.outcome} · {a.provider ?? "—"} ·{" "}
                        {new Date(a.created_at).toLocaleString()}
                        {a.error ? ` · ${a.error}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-2 font-semibold">Provider events</h3>
                {(events.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No provider events received.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {(events.data ?? []).map((e) => (
                      <li key={e.id}>
                        {new Date(e.occurred_at).toLocaleString()} · {e.provider} · {e.event_type}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-2 font-semibold">Candidate response</h3>
                {(actions.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No response link issued.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {(actions.data ?? []).map((a) => (
                      <li key={a.id}>
                        {a.responded_at
                          ? `${a.action?.replace(/_/g, " ") ?? "responded"} on ${new Date(a.responded_at).toLocaleString()}`
                          : `awaiting response — link expires ${new Date(a.expires_at).toLocaleString()}`}
                        {a.note ? ` · “${a.note}”` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2 border-t pt-4">
                <Label htmlFor="letter-reason">Reason (required to cancel or supersede)</Label>
                <Textarea id="letter-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline"
                    onClick={() => supersede.mutate(openRequest)} disabled={supersede.isPending}>
                    Issue a replacement letter
                  </Button>
                  <Button size="sm" variant="ghost"
                    onClick={() => cancel.mutate(openRequest)} disabled={cancel.isPending}>
                    Cancel this letter
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Issued letters are never rewritten. A replacement creates a new revision and marks this
                  one superseded, so verification of the old reference still resolves truthfully.
                </p>
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
