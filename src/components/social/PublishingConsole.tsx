/**
 * SOCIAL PUBLISHING CONSOLE — one control plane, two entrances.
 *
 * Marketing staff (/staff/marketing/social) and Super Admin
 * (/dashboard/admin/social-distribution → "Publishing") render THIS component
 * against the same backend routines. There is no second source of truth and no
 * client-side authority: every button calls a governed Postgres routine or the
 * service-role worker, and the server refuses anything the caller may not do.
 *
 * Surfaces:
 *   Connections   provider provisioning + account connection state
 *   Content       authoring, two-person approval, stale-approval detection
 *   Scheduling    approved content → publication jobs (incl. dry-run rehearsal)
 *   Job health    queue depth, attempts, failure codes, requeue
 *   Webhooks      delivery integrity (signed vs refused) per provider
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, Clock, PlugZap, RefreshCw, Send, ShieldCheck } from "lucide-react";
import JobTimelineDialog from "@/components/social/JobTimelineDialog";
import ProviderProvisioningPanel from "@/components/social/ProviderProvisioningPanel";

import {
  JOB_TONE,
  POST_TONE,
  approvalIsStale,
  cancelJobs,
  listCapabilities,
  listConnections,
  listJobs,
  listPosts,
  listVariants,
  listWebhookDeliveries,
  diagnoseProviders,
  providerHealth,
  replayWebhook,
  sendSampleWebhook,

  queueSummary,
  requeueJob,
  reviewPost,
  runWorker,
  schedulePost,
  submitPost,
  webhookHealth,
  type ProviderCapability,
  type ProviderHealth,
  type PublicationJob,
  type QueueBucket,
  type SocialConnection,
  type SocialPost,
  type SocialVariant,
  type WebhookDelivery,
  type ProviderDiagnostic,
  type WebhookHealth,

} from "@/lib/social/publishing";

interface Props {
  /** MARKETING = staff portal entrance, PLATFORM = super-admin entrance. */
  scope: "MARKETING" | "PLATFORM";
}

const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "—");

function StateBadge({ value, tone }: { value: string; tone: Record<string, string> }) {
  return (
    <Badge variant="secondary" className={tone[value] ?? "bg-muted text-muted-foreground"}>
      {value}
    </Badge>
  );
}

export default function PublishingConsole({ scope }: Props) {
  const { toast } = useToast();
  const [caps, setCaps] = useState<ProviderCapability[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [variants, setVariants] = useState<SocialVariant[]>([]);
  const [jobs, setJobs] = useState<PublicationJob[]>([]);
  const [queue, setQueue] = useState<QueueBucket[]>([]);
  const [hooks, setHooks] = useState<WebhookHealth[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provisioningError, setProvisioningError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProviderDiagnostic[]>([]);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [timelineJob, setTimelineJob] = useState<string | null>(null);
  const [samplePlatform, setSamplePlatform] = useState("linkedin");
  const [sampleStatus, setSampleStatus] = useState("PUBLISHED");

  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, conn, p, v, j, q, wh, wd] = await Promise.all([
        listCapabilities(),
        listConnections(),
        listPosts(),
        listVariants(),
        listJobs(),
        queueSummary(),
        webhookHealth(),
        listWebhookDeliveries(),
      ]);
      setCaps(c);
      setConnections(conn);
      setPosts(p);
      setVariants(v);
      setJobs(j);
      setQueue(q);
      setHooks(wh);
      setDeliveries(wd);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the publishing control plane");
    } finally {
      setLoading(false);
    }
    // Provisioning health and diagnostics are privileged edge reads; a failure
    // here must not blank the console — it is reported inline instead.
    try {
      const health = await providerHealth();
      setProviders(health.providers);
      setProvisioningError(null);
    } catch (e) {
      setProvisioningError(e instanceof Error ? e.message : "Provider provisioning health unavailable");
    }
    try {
      setDiagnostics(await diagnoseProviders());
      setDiagError(null);
    } catch (e) {
      setDiagError(e instanceof Error ? e.message : "Provider diagnostics unavailable");
    }
  }, []);


  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast({ title: label, description: "Recorded in the social content audit trail." });
      setNote("");
      await refresh();
    } catch (e) {
      toast({
        variant: "destructive",
        title: `${label} refused`,
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  const variantsByPost = useMemo(() => {
    const map = new Map<string, SocialVariant[]>();
    for (const v of variants) map.set(v.post_id, [...(map.get(v.post_id) ?? []), v]);
    return map;
  }, [variants]);

  const connectionByAccount = useMemo(
    () => new Map(connections.map((c) => [c.account_id, c])),
    [connections],
  );

  const readyProviders = providers.filter((p) => p.configuration === "READY").length;
  const blockedJobs = jobs.filter((j) => j.state === "FAILED_PERMANENTLY" || j.state === "DEAD_LETTER").length;
  const awaitingReview = posts.filter((p) => p.status === "IN_REVIEW").length;
  const selectedPost = posts.find((p) => p.id === selected) ?? null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Providers publish-ready</CardDescription></CardHeader>
          <CardContent className="text-2xl font-semibold">
            {readyProviders}
            <span className="text-sm text-muted-foreground"> / {providers.length || caps.length}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Awaiting approval</CardDescription></CardHeader>
          <CardContent className="text-2xl font-semibold">{awaitingReview}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Jobs in queue</CardDescription></CardHeader>
          <CardContent className="text-2xl font-semibold">
            {queue.filter((q) => q.state === "QUEUED" || q.state === "RETRY_PENDING").reduce((s, q) => s + q.count, 0)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Blocked / dead-letter</CardDescription></CardHeader>
          <CardContent className="text-2xl font-semibold">{blockedJobs}</CardContent>
        </Card>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden /> Refresh
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            act("Publication worker run", async () => {
              const res = await runWorker(10);
              toast({ title: "Worker finished", description: `${res.claimed} job(s) claimed.` });
            })
          }
        >
          Run publication worker now
        </Button>
        <span className="text-xs text-muted-foreground">
          {scope === "MARKETING" ? "Marketing operations entrance" : "Platform administration entrance"} — identical
          backend authority.
        </span>
      </div>

      <Tabs defaultValue="connections">
        <TabsList className="flex-wrap">
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="provisioning">Provisioning &amp; diagnostics</TabsTrigger>

          <TabsTrigger value="content">Content &amp; approval</TabsTrigger>
          <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
          <TabsTrigger value="jobs">Job health</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        </TabsList>

        {/* ---------------- CONNECTIONS ---------------- */}
        {/* ---------------- PROVISIONING & DIAGNOSTICS ---------------- */}
        <TabsContent value="provisioning" className="mt-4 space-y-4">
          <ProviderProvisioningPanel
            diagnostics={diagnostics}
            loading={loading}
            error={diagError}
            onChanged={refresh}
          />
        </TabsContent>

        <TabsContent value="connections" className="mt-4 space-y-4">

          {provisioningError && (
            <div role="status" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              Provider provisioning health unavailable: {provisioningError}
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Provider provisioning</CardTitle>
              <CardDescription>
                A provider is publish-ready only when its platform application credentials exist as backend secrets.
                Missing credentials show as NOT_CONFIGURED — jobs for that provider are refused rather than attempted.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Configuration</TableHead>
                    <TableHead>Missing secrets</TableHead>
                    <TableHead>Required scopes</TableHead>
                    <TableHead>Publish mode</TableHead>
                    <TableHead>Caption limit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {caps.map((c) => {
                    const p = providers.find((x) => x.platform_slug === c.platform_slug);
                    return (
                      <TableRow key={c.platform_slug}>
                        <TableCell className="font-medium capitalize">{c.platform_slug}</TableCell>
                        <TableCell>
                          {p ? (
                            <Badge
                              variant="secondary"
                              className={
                                p.configuration === "READY" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                              }
                            >
                              {p.configuration}
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">unknown</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {p?.missing_secrets.length ? p.missing_secrets.join(", ") : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {(p?.required_scopes ?? []).join(", ") || "—"}
                        </TableCell>
                        <TableCell className="text-sm">{c.direct_publish ?? "—"}</TableCell>
                        <TableCell className="text-sm">{c.caption_max ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account connections</CardTitle>
              <CardDescription>
                Each official account carries its own connection state, provider account id, granted scopes and token
                expiry. Tokens themselves are never returned to the browser.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Platform</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Provider account</TableHead>
                    <TableHead>Scopes</TableHead>
                    <TableHead>Token expiry</TableHead>
                    <TableHead>Last publication</TableHead>
                    <TableHead>Last error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-muted-foreground">
                        No account is connected yet — publication is NOT_CONFIGURED for every provider.
                      </TableCell>
                    </TableRow>
                  )}
                  {connections.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium capitalize">{c.platform_slug}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            c.state === "CONNECTED" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                          }
                        >
                          <PlugZap className="mr-1 h-3 w-3" aria-hidden />
                          {c.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.external_account_name ?? c.external_account_id ?? "— unresolved —"}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate font-mono text-xs text-muted-foreground">
                        {(c.granted_scopes ?? []).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-sm">{when(c.token_expires_at)}</TableCell>
                      <TableCell className="text-sm">{when(c.last_publication_at)}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-destructive">
                        {c.last_error_code ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- CONTENT & APPROVAL ---------------- */}
        <TabsContent value="content" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Content register</CardTitle>
              <CardDescription>
                Two-person control: an author cannot approve their own content. Editing approved content revokes the
                approval and cancels any stale publication job.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Post</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Variants</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={5} className="text-muted-foreground">Loading…</TableCell></TableRow>
                  )}
                  {!loading && posts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        No content authored yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {posts.map((p) => {
                    const vs = variantsByPost.get(p.id) ?? [];
                    const stale = vs.filter(approvalIsStale).length;
                    return (
                      <TableRow key={p.id} className={selected === p.id ? "bg-muted/40" : undefined}>
                        <TableCell>
                          <button
                            type="button"
                            className="text-left font-medium underline-offset-4 hover:underline"
                            onClick={() => setSelected(p.id === selected ? null : p.id)}
                            aria-expanded={selected === p.id}
                          >
                            {p.title}
                          </button>
                          <div className="text-xs text-muted-foreground">
                            v{p.version} · {p.market} · updated {when(p.updated_at)}
                          </div>
                        </TableCell>
                        <TableCell><StateBadge value={p.status} tone={POST_TONE} /></TableCell>
                        <TableCell className="text-sm">
                          {vs.map((v) => v.platform_slug).join(", ") || "—"}
                          {stale > 0 && (
                            <div className="mt-1 flex items-center gap-1 text-xs text-warning">
                              <AlertTriangle className="h-3 w-3" aria-hidden /> {stale} edited after approval
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{when(p.scheduled_at)}</TableCell>
                        <TableCell className="space-x-2 whitespace-nowrap text-right">
                          {p.status === "DRAFT" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => act("Submitted for approval", () => submitPost(p.id, note || "Submitted for approval"))}
                            >
                              Submit for approval
                            </Button>
                          )}
                          {p.status === "IN_REVIEW" && (
                            <>
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => act("Content approved", () => reviewPost(p.id, "APPROVE", note || "Approved"))}
                              >
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={busy}
                                onClick={() => act("Content rejected", () => reviewPost(p.id, "REJECT", note || "Rejected"))}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {(p.status === "SCHEDULED" || p.status === "PUBLISHING") && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => act("Publication cancelled", () => cancelJobs(p.id, note || "Cancelled by operator"))}
                            >
                              Cancel publication
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="mt-4 max-w-xl">
                <Label htmlFor="social-decision-note">Decision note (stored with the audit event)</Label>
                <Textarea
                  id="social-decision-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why this content is being submitted, approved, rejected or cancelled…"
                />
              </div>
            </CardContent>
          </Card>

          {selectedPost && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{selectedPost.title} — platform variants</CardTitle>
                <CardDescription>
                  Each variant is published independently. A variant whose content hash no longer matches its approved
                  hash is refused by the worker.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Platform</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Connection</TableHead>
                      <TableHead>Caption</TableHead>
                      <TableHead>External post</TableHead>
                      <TableHead>Failure</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(variantsByPost.get(selectedPost.id) ?? []).map((v) => {
                      const conn = v.account_id ? connectionByAccount.get(v.account_id) : undefined;
                      return (
                        <TableRow key={v.id}>
                          <TableCell className="font-medium capitalize">{v.platform_slug}</TableCell>
                          <TableCell>
                            <StateBadge value={v.status} tone={JOB_TONE} />
                            {approvalIsStale(v) && (
                              <div className="mt-1 text-xs text-warning">approval stale — re-submit</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {conn ? conn.state : <span className="text-warning">NOT_CONNECTED</span>}
                          </TableCell>
                          <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">{v.caption}</TableCell>
                          <TableCell className="text-sm">
                            {v.external_url ? (
                              <a href={v.external_url} target="_blank" rel="noreferrer noopener" className="underline">
                                {v.external_post_id}
                              </a>
                            ) : (
                              (v.external_post_id ?? "—")
                            )}
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate text-sm text-destructive">
                            {v.failure_code ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---------------- SCHEDULING ---------------- */}
        <TabsContent value="scheduling" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Schedule approved content</CardTitle>
              <CardDescription>
                Scheduling creates one idempotent publication job per approved variant. A dry-run rehearsal exercises the
                whole path (capability checks, provider draft/inbox where supported) without publishing publicly.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="social-schedule-post">Approved post</Label>
                  <select
                    id="social-schedule-post"
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={selected ?? ""}
                    onChange={(e) => setSelected(e.target.value || null)}
                  >
                    <option value="">Select…</option>
                    {posts
                      .filter((p) => p.status === "APPROVED" || p.status === "SCHEDULED")
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="social-schedule-at">Publish at (local time)</Label>
                  <Input
                    id="social-schedule-at"
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !selected || !scheduleAt}
                  onClick={() =>
                    selected &&
                    act("Publication scheduled", () => schedulePost(selected, new Date(scheduleAt).toISOString(), false))
                  }
                >
                  <Clock className="mr-2 h-3.5 w-3.5" aria-hidden /> Schedule publication
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !selected || !scheduleAt}
                  onClick={() =>
                    selected &&
                    act("Dry-run rehearsal scheduled", () =>
                      schedulePost(selected, new Date(scheduleAt).toISOString(), true),
                    )
                  }
                >
                  <ShieldCheck className="mr-2 h-3.5 w-3.5" aria-hidden /> Schedule dry-run rehearsal
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Only APPROVED content can be scheduled — the database refuses anything else, whichever console it comes
                from.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- JOB HEALTH ---------------- */}
        <TabsContent value="jobs" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Queue depth</CardTitle>
              <CardDescription>Oldest waiting job per state — the earliest signal of a stalled provider.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {queue.length === 0 && <span className="text-sm text-muted-foreground">Queue is empty.</span>}
              {queue.map((q) => (
                <div key={q.state} className="rounded-md border border-border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{q.state}</div>
                  <div className="text-lg font-semibold">{q.count}</div>
                  <div className="text-xs text-muted-foreground">oldest {when(q.oldest)}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publication jobs</CardTitle>
              <CardDescription>
                Failure codes are explicit: NOT_CONFIGURED:* means credentials or a connection are missing; BLOCKED:*
                means the provider would refuse this content. Neither is retried blindly.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Platform</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Attempt</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Next attempt</TableHead>
                    <TableHead>Failure</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-muted-foreground">No jobs yet.</TableCell></TableRow>
                  )}
                  {jobs.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="font-medium capitalize">
                        {j.platform_slug}
                        {j.dry_run && <Badge variant="outline" className="ml-2">dry run</Badge>}
                      </TableCell>
                      <TableCell><StateBadge value={j.state} tone={JOB_TONE} /></TableCell>
                      <TableCell className="text-sm">{j.attempt}/{j.max_attempts}</TableCell>
                      <TableCell className="text-sm">{when(j.scheduled_for)}</TableCell>
                      <TableCell className="text-sm">{when(j.next_attempt_at)}</TableCell>
                      <TableCell className="max-w-[320px] text-sm text-destructive">
                        {j.error_code ? (
                          <>
                            <span className="font-mono text-xs">{j.error_code}</span>
                            <div className="truncate text-xs text-muted-foreground">{j.error_message}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="space-x-2 whitespace-nowrap text-right">
                        <Button size="sm" variant="ghost" onClick={() => setTimelineJob(j.id)}>
                          Timeline
                        </Button>
                        {["FAILED_PERMANENTLY", "DEAD_LETTER", "RETRY_PENDING"].includes(j.state) && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => act("Job requeued", () => requeueJob(j.id, note || "Requeued by operator"))}
                          >
                            Requeue
                          </Button>
                        )}
                      </TableCell>

                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- WEBHOOKS ---------------- */}
        <TabsContent value="webhooks" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Webhook rehearsal</CardTitle>
              <CardDescription>
                Sends a synthetic, correctly signed provider callback through the real receiver so you can prove the
                status and analytics path end to end without waiting for a live post. Rehearsals are marked as synthetic
                in the delivery log and never overwrite a real external id.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="sample-platform">Provider</Label>
                <select
                  id="sample-platform"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={samplePlatform}
                  onChange={(e) => setSamplePlatform(e.target.value)}
                >
                  {(diagnostics.length ? diagnostics.map((d) => d.platform_slug) : ["linkedin"]).map((slug) => (
                    <option key={slug} value={slug}>
                      {slug}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sample-status">Simulated outcome</Label>
                <select
                  id="sample-status"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={sampleStatus}
                  onChange={(e) => setSampleStatus(e.target.value)}
                >
                  <option value="PUBLISHED">Published</option>
                  <option value="FAILED">Failed</option>
                  <option value="METRICS">Metrics update</option>
                </select>
              </div>
              <Button
                disabled={busy}
                onClick={() =>
                  act("Sample delivered", async () => {
                    const r = await sendSampleWebhook({
                      provider: samplePlatform,
                      eventKind: sampleStatus === "METRICS" ? "METRICS" : "STATUS",
                      status: sampleStatus,
                    });
                    toast({
                      title: "Sample callback delivered",
                      description: `Event ${r.event_key} · ${
                        r.matched_variant ? "matched an existing variant" : "no variant matched (synthetic post id)"
                      }.`,
                    });
                  })
                }

              >
                <Send className="mr-2 h-4 w-4" aria-hidden /> Send sample callback
              </Button>
            </CardContent>
          </Card>


          <Card>
            <CardHeader>
              <CardTitle className="text-base">Delivery integrity</CardTitle>
              <CardDescription>
                Every callback is signature-verified against the raw body and deduplicated on the provider event id, so a
                replayed delivery can never double-count analytics. Refused deliveries are still recorded for forensics.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Deliveries</TableHead>
                    <TableHead>Refused (bad signature)</TableHead>
                    <TableHead>Last received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hooks.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        No callbacks received yet — no provider subscription is active.
                      </TableCell>
                    </TableRow>
                  )}
                  {hooks.map((h) => (
                    <TableRow key={h.platform_slug}>
                      <TableCell className="font-medium capitalize">{h.platform_slug}</TableCell>
                      <TableCell>{h.deliveries}</TableCell>
                      <TableCell className={h.rejected > 0 ? "text-destructive" : undefined}>{h.rejected}</TableCell>
                      <TableCell className="text-sm">{when(h.last_received)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent deliveries</CardTitle>
              <CardDescription>Append-only inbox — deliveries cannot be edited or deleted.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Signed</TableHead>
                    <TableHead>External post</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead className="text-right">Replay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-muted-foreground">Nothing received yet.</TableCell></TableRow>
                  )}
                  {deliveries.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="whitespace-nowrap text-sm">{when(d.received_at)}</TableCell>
                      <TableCell className="capitalize">{d.provider}</TableCell>
                      <TableCell className="font-mono text-xs">{d.event_kind}</TableCell>
                      <TableCell>{d.signature_valid ? "Yes" : <span className="text-destructive">No</span>}</TableCell>
                      <TableCell className="max-w-[180px] truncate font-mono text-xs">
                        {d.external_post_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">{d.result}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            act("Delivery replayed", async () => {
                              const r = await replayWebhook(d.id);
                              toast({
                                title: "Delivery replayed",
                                description: `Re-ingested under ${r.event_key} — original event id preserved.`,
                              });
                            })
                          }
                        >
                          Replay
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}

                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <JobTimelineDialog jobId={timelineJob} onClose={() => setTimelineJob(null)} />
    </div>

  );
}
