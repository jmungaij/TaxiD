import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertTriangle, CheckCircle2, GitBranch, History, Loader2, Lock, RotateCcw, ShieldCheck, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { AppButton } from "@/components/nav/AppButton";
import {
  NavAuditSearchPanel, NavCanaryPanel, NavDriftPanel, NavVersionDiffPanel,
} from "@/components/navigation/GovernanceOpsPanels";

import { useAuth } from "@/hooks/useAuth";
import {
  NAV_LIFECYCLE, blockedReason, captureSnapshot, createDraft, decideVersion, listAudit,
  listVersions, publishVersion, rollbackTo, submitForReview, validateVersion,
  type NavRegistryAuditEntry, type NavRegistryVersion,
} from "@/lib/navigation/registryGovernance";
import type { NavValidationReport } from "@/lib/navigation/registrySnapshot";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  validated: "bg-info/10 text-info",
  in_review: "bg-warning/10 text-warning-foreground",
  approved: "bg-secondary text-secondary-foreground",
  published: "bg-success/10 text-success",
  superseded: "bg-muted text-muted-foreground",
  rejected: "bg-destructive/10 text-destructive",
};

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

/**
 * Navigation Registry Governance.
 *
 * The canonical navigation registry is production configuration: it decides what
 * the platform promises and which backend capability answers each promise. This
 * console makes changes to it governed rather than ambient — a snapshot must be
 * captured, validated against every integrity gate, reviewed, approved by
 * someone other than its author, and only then published. Every transition is
 * recorded, and any previously published version can be restored in one click.
 */
function NavigationGovernanceInner() {
  const { user, roles } = useAuth();
  const canApprove = roles.includes("super_admin");

  const [versions, setVersions] = useState<NavRegistryVersion[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audit, setAudit] = useState<NavRegistryAuditEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  const live = useMemo(() => captureSnapshot(), []);

  const reload = useCallback(async () => {
    try {
      const rows = await listVersions();
      setVersions(rows);
      setSelectedId((prev) => prev ?? rows[0]?.id ?? null);
    } catch (e) {
      setVersions([]);
      toast.error("Could not load navigation versions", { description: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selected = versions?.find((v) => v.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    listAudit(selectedId).then(setAudit).catch(() => setAudit([]));
  }, [selectedId, versions]);

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      await reload();
    } catch (e) {
      const msg = (e as { message?: string }).message ?? "Action failed";
      toast.error(msg.replace(/^[a-z_]+:\s*/i, ""), { description: msg });
    } finally {
      setBusy(null);
    }
  };

  const activeVersion = versions?.find((v) => v.is_active) ?? null;
  const drift = activeVersion && activeVersion.snapshot_hash !== live.hash;

  const report: NavValidationReport | null = selected?.validation ?? null;

  const stageIndex = (status: string) => NAV_LIFECYCLE.findIndex((s) => s.status === status);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-semibold tracking-tight">Navigation Registry Governance</h1>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Draft, validate, review, approve and publish the canonical navigation contract. Every gate
          is enforced on the server: an unvalidated or self-approved version cannot be published.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Live registry</CardTitle>
            <CardDescription>Computed from the running app</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{live.snapshot.counts.categories} categories · {live.snapshot.counts.publicDestinations} public destinations</p>
            <p>{live.snapshot.counts.protectedEntries} protected portal entries · {live.snapshot.counts.footerLinks} footer links</p>
            <p className="font-mono text-xs text-muted-foreground">hash {live.hash}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Live integrity</CardTitle>
            <CardDescription>All gates, run now</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {live.report.passed ? (
              <p className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Every gate passes</p>
            ) : (
              <p className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4" aria-hidden="true" /> {live.report.gates.filter((g) => !g.passed).length} gate(s) failing</p>
            )}
            <p className="text-muted-foreground">
              {live.report.totals.publicViolations} public · {live.report.totals.protectedViolations} protected violations
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Published version</CardTitle>
            <CardDescription>Active canonical contract</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {activeVersion ? (
              <>
                <p>v{activeVersion.version} — {activeVersion.title}</p>
                <p className="text-muted-foreground">Published {when(activeVersion.published_at)}</p>
                {drift ? (
                  <p role="status" className="text-warning-foreground">
                    Live registry differs from the published snapshot — capture a new draft.
                  </p>
                ) : (
                  <p className="text-success">Live registry matches the published snapshot.</p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No version published yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Capture a draft</CardTitle>
          <CardDescription>
            Snapshots the current registry, footer projection and protected portal surface.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="nav-draft-title">Change title</Label>
            <Input
              id="nav-draft-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Add Marketplace → Fleet Partners"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nav-draft-notes">Reviewer notes</Label>
            <Textarea
              id="nav-draft-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What changed and why"
            />
          </div>
          <AppButton
            analytics="nav_registry_capture_draft"
            action="submit"
            disabled={title.trim().length < 3 || busy === "draft"}
            onClick={() =>
              run("draft", async () => {
                const id = await createDraft(title.trim(), notes.trim() || undefined);
                setSelectedId(id);
                setTitle("");
                setNotes("");
              }, "Draft captured")
            }
          >
            {busy === "draft" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Capture draft
          </AppButton>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Versions</CardTitle>
            <CardDescription>Newest first · last 50</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {versions === null ? (
              <Skeleton className="h-24 w-full" />
            ) : versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No navigation versions recorded yet.</p>
            ) : (
              versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  aria-current={v.id === selectedId ? "true" : undefined}
                  className={`w-full rounded-md border p-3 text-left transition-colors ${
                    v.id === selectedId ? "border-primary bg-accent/40" : "border-border hover:bg-accent/20"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">v{v.version} · {v.title}</span>
                    <Badge className={STATUS_TONE[v.status]}>{v.status.replace("_", " ")}</Badge>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {when(v.created_at)} · {v.snapshot?.counts?.publicDestinations ?? 0} public destinations
                    {v.is_active ? " · ACTIVE" : ""}
                  </span>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selected ? `v${selected.version} — ${selected.title}` : "Select a version"}
            </CardTitle>
            <CardDescription>Lifecycle, gates and audit history</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!selected ? (
              <p className="text-sm text-muted-foreground">Choose a version to inspect its gates and history.</p>
            ) : (
              <>
                <ol className="flex flex-wrap gap-2" aria-label="Lifecycle progress">
                  {NAV_LIFECYCLE.map((stage, i) => {
                    const reached = stageIndex(selected.status) >= i || selected.status === "published";
                    return (
                      <li
                        key={stage.status}
                        className={`rounded-md border px-2.5 py-1 text-xs ${
                          reached ? "border-primary/40 bg-primary/5 text-foreground" : "border-border text-muted-foreground"
                        }`}
                        title={stage.description}
                      >
                        {i + 1}. {stage.label}
                      </li>
                    );
                  })}
                </ol>

                <div className="flex flex-wrap gap-2">
                  {([
                    { key: "validate", label: "Validate", action: () => validateVersion(selected), done: "Validation recorded" },
                    { key: "review", label: "Submit for review", action: () => submitForReview(selected.id), done: "Sent for review" },
                    { key: "approve", label: "Approve", action: () => decideVersion(selected.id, true), done: "Version approved" },
                    { key: "publish", label: "Publish", action: () => publishVersion(selected.id), done: "Navigation published" },
                  ] as const).map((btn) => {
                    const blocked = blockedReason(btn.key, selected, { userId: user?.id, canApprove });
                    return (
                      <AppButton
                        key={btn.key}
                        analytics={`nav_registry_${btn.key}`}
                        action="submit"
                        variant={btn.key === "publish" ? "default" : "outline"}
                        disabled={Boolean(blocked) || busy === btn.key}
                        title={blocked ?? undefined}
                        aria-describedby={blocked ? `nav-blocked-${btn.key}` : undefined}
                        onClick={() => run(btn.key, btn.action, btn.done)}
                      >
                        {blocked ? <Lock className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> : null}
                        {btn.label}
                      </AppButton>
                    );
                  })}
                  {selected.status === "in_review" && canApprove ? (
                    <AppButton
                      analytics="nav_registry_reject"
                      action="submit"
                      variant="ghost"
                      disabled={busy === "reject"}
                      onClick={() => run("reject", () => decideVersion(selected.id, false, "Rejected in review"), "Version rejected")}
                    >
                      Reject
                    </AppButton>
                  ) : null}
                  <AppButton
                    analytics="nav_registry_rollback"
                    action="submit"
                    variant="outline"
                    disabled={Boolean(blockedReason("rollback", selected, { userId: user?.id, canApprove })) || busy === "rollback"}
                    title={blockedReason("rollback", selected, { userId: user?.id, canApprove }) ?? undefined}
                    onClick={() => run("rollback", () => rollbackTo(selected.id, "One-click rollback after failed integrity checks"), "Navigation rolled back")}
                  >
                    <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                    Roll back to this version
                  </AppButton>
                </div>

                <ul className="space-y-1 text-xs text-muted-foreground">
                  {(["validate", "review", "approve", "publish"] as const).map((k) => {
                    const blocked = blockedReason(k, selected, { userId: user?.id, canApprove });
                    return blocked ? (
                      <li key={k} id={`nav-blocked-${k}`} role="note">
                        <span className="font-medium capitalize">{k}</span> unavailable — {blocked}
                      </li>
                    ) : null;
                  })}
                </ul>

                <section aria-labelledby="nav-gates-heading" className="space-y-2">
                  <h2 id="nav-gates-heading" className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Integrity gates
                  </h2>
                  {!report ? (
                    <p className="text-sm text-muted-foreground">Not validated yet — run Validate to record a verdict.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Gate</TableHead>
                          <TableHead>Result</TableHead>
                          <TableHead>Detail</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.gates.map((g) => (
                          <TableRow key={g.key}>
                            <TableCell className="font-medium">{g.label}</TableCell>
                            <TableCell>
                              {g.passed ? (
                                <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Pass</span>
                              ) : (
                                <span className="flex items-center gap-1 text-destructive"><XCircle className="h-4 w-4" aria-hidden="true" /> Fail</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {g.passed ? g.detail : g.failures.slice(0, 5).join(" · ")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </section>

                <section aria-labelledby="nav-audit-heading" className="space-y-2">
                  <h2 id="nav-audit-heading" className="flex items-center gap-2 text-sm font-semibold">
                    <History className="h-4 w-4" aria-hidden="true" /> Audit history
                  </h2>
                  {audit.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No audit entries.</p>
                  ) : (
                    <ol className="space-y-2">
                      {audit.map((a) => (
                        <li key={a.id} className="rounded-md border border-border p-2 text-xs">
                          <span className="font-medium">{a.action.replace(/_/g, " ")}</span>
                          {a.from_status ? <span className="text-muted-foreground"> · {a.from_status} → {a.to_status}</span> : null}
                          <span className="block text-muted-foreground">{when(a.created_at)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <NavVersionDiffPanel versions={versions ?? []} selectedId={selectedId} />
        <NavCanaryPanel version={selected} onChanged={() => void reload()} />
      </div>

      <NavDriftPanel />

      <NavAuditSearchPanel versions={versions ?? []} />
    </div>

  );
}

export default function NavigationGovernance() {
  return (
    <AdminOnly>
      <NavigationGovernanceInner />
    </AdminOnly>
  );
}
