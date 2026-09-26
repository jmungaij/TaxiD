/**
 * PUBLICATION JOB FORENSICS
 *
 * The step-by-step life of one publication attempt: scheduled → claimed →
 * readiness assessed → media resolved / provider called → published with an
 * external id → provider callback received. Milestones that never happened are
 * shown as such, because a MISSING step is usually the diagnosis.
 *
 * Everything shown is drawn from the append-only content event trail plus the
 * webhook inbox — no state is inferred client-side.
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, Circle, Clock } from "lucide-react";
import { JOB_MILESTONES, fetchJobTimeline, type JobTimeline } from "@/lib/social/publishing";

const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "—");

export default function JobTimelineDialog({
  jobId,
  onClose,
}: {
  jobId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<JobTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!jobId) {
      setData(null);
      setError(null);
      return;
    }
    let live = true;
    setLoading(true);
    fetchJobTimeline(jobId)
      .then((r) => live && (setData(r), setError(null)))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Unable to load the job timeline"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [jobId]);

  const events = data?.events ?? [];

  return (
    <Dialog open={!!jobId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publication job timeline</DialogTitle>
          <DialogDescription>
            Every recorded step for this job and its variant, including provider callbacks matched on the external post
            id.
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border p-3 text-sm">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Job</div>
                <div className="mt-1 space-y-1">
                  <div className="capitalize">
                    {data.job.platform_slug}
                    {data.job.dry_run && <Badge variant="outline" className="ml-2">dry run</Badge>}
                  </div>
                  <div>State: <span className="font-medium">{data.job.state}</span></div>
                  <div className="text-muted-foreground">
                    Attempt {data.job.attempt}/{data.job.max_attempts} · scheduled {when(data.job.scheduled_for)}
                  </div>
                  {data.job.error_code && (
                    <div className="text-destructive">
                      <span className="font-mono text-xs">{data.job.error_code}</span>
                      <div className="text-xs">{data.job.error_message}</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-md border border-border p-3 text-sm">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Variant outcome</div>
                <div className="mt-1 space-y-1">
                  <div>Status: <span className="font-medium">{data.variant?.status ?? "—"}</span></div>
                  <div className="break-all">
                    External id:{" "}
                    <span className="font-mono text-xs">{data.variant?.external_post_id ?? "not stored"}</span>
                  </div>
                  {data.variant?.external_url && (
                    <a href={data.variant.external_url} target="_blank" rel="noreferrer noopener" className="underline">
                      Open published post
                    </a>
                  )}
                  <div className="text-muted-foreground">Published {when(data.variant?.published_at)}</div>
                </div>
              </div>
            </div>

            {/* -------- milestone chain -------- */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Milestones</h3>
              <ol className="space-y-2">
                {JOB_MILESTONES.map((m) => {
                  const hit = events.find((e) => m.matches(e.action));
                  const delivered = m.id === "webhook" ? (data.deliveries.length > 0 ? data.deliveries[0] : null) : null;
                  const done = !!hit || !!delivered;
                  return (
                    <li key={m.id} className="flex items-start gap-3 text-sm">
                      {done ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" aria-hidden />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
                      )}
                      <div>
                        <span className={done ? "font-medium" : "text-muted-foreground"}>{m.label}</span>
                        <div className="text-xs text-muted-foreground">
                          {done ? when(hit?.created_at ?? delivered?.received_at) : "not reached"}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* -------- raw event trail -------- */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Recorded events</h3>
              {events.length === 0 && <p className="text-sm text-muted-foreground">No events recorded yet.</p>}
              <ul className="space-y-2">
                {events.map((e) => (
                  <li key={e.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      <span className="font-mono text-xs">{e.action}</span>
                      {e.result && <Badge variant="outline">{e.result}</Badge>}
                      <span className="text-xs text-muted-foreground">{when(e.created_at)}</span>
                    </div>
                    {e.detail && Object.keys(e.detail).length > 0 && (
                      <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/40 p-2 text-xs">
                        {JSON.stringify(e.detail, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* -------- webhook leg -------- */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Provider callbacks for this post</h3>
              {data.deliveries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  None received. Use the webhook test tool to prove the callback path independently.
                </p>
              ) : (
                <ul className="space-y-2">
                  {data.deliveries.map((d) => (
                    <li key={d.id} className="rounded-md border border-border p-3 text-sm">
                      <span className="capitalize">{d.provider}</span> ·{" "}
                      <span className="font-mono text-xs">{d.event_kind ?? "DELIVERY"}</span> ·{" "}
                      {d.signature_valid ? "signed" : <span className="text-destructive">unsigned</span>} ·{" "}
                      {d.result ?? "—"}
                      <div className="text-xs text-muted-foreground">{when(d.received_at)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
