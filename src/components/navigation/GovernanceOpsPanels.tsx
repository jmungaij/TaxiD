/**
 * Navigation governance operations panels.
 *
 * Four surfaces that sit beneath the lifecycle console:
 *   • Diff — what a candidate version changes against the published one, before approval.
 *   • Canary — stage a version to a cohort of roles/users/percentage, then promote or abort.
 *   • Drift — triage integrity and capability/RBAC drift alerts raised by the monitor.
 *   • Audit — searchable governance history with CSV export.
 *
 * Authority, cohort resolution and promotion gates are enforced server-side; these
 * panels only issue intents and render persisted results.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell, Download, GitCompareArrows, Loader2, Radar, Search, Users,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AppButton } from "@/components/nav/AppButton";
import * as ops from "@/lib/navigation/governanceOps";

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

interface VersionLite {
  id: string;
  version: number;
  title: string;
  status: string;
  is_active: boolean;
  rollout_mode?: string | null;
  rollout_roles?: string[] | null;
  rollout_user_ids?: string[] | null;
  rollout_percent?: number | null;
  canary_started_at?: string | null;
}

/* ================================================================== diff == */

export function NavVersionDiffPanel({
  versions, selectedId,
}: { versions: VersionLite[]; selectedId: string | null }) {
  const active = versions.find((v) => v.is_active) ?? null;
  const [baseId, setBaseId] = useState<string>("");
  const [diff, setDiff] = useState<ops.RegistryDiff | null>(null);
  const [loading, setLoading] = useState(false);

  const base = baseId || active?.id || "";

  useEffect(() => { setDiff(null); }, [selectedId, baseId]);

  const compare = async () => {
    if (!base || !selectedId) return;
    setLoading(true);
    try {
      setDiff(await ops.diffVersions(base, selectedId));
    } catch (e) {
      toast.error("Could not compute the diff", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const sections: ops.DiffSectionKey[] = ["routes", "capabilities", "rbac", "navigation"];
  const label: Record<ops.DiffSectionKey, string> = {
    routes: "Routes",
    capabilities: "Capabilities",
    rbac: "Access rules",
    navigation: "Navigation entries",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompareArrows className="h-4 w-4 text-primary" aria-hidden="true" />
          Compare before approving
        </CardTitle>
        <CardDescription>
          Route, capability and access-rule changes this version introduces against the baseline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="nav-diff-base">Baseline version</Label>
            <Select value={base} onValueChange={setBaseId}>
              <SelectTrigger id="nav-diff-base">
                <SelectValue placeholder="Published version" />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    v{v.version} · {v.title}{v.is_active ? " (published)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AppButton
            analytics="nav_registry_diff"
            action="submit"
            variant="outline"
            disabled={!base || !selectedId || base === selectedId || loading}
            onClick={compare}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Show navigation diff
          </AppButton>
        </div>

        {!diff ? (
          <p className="text-sm text-muted-foreground">
            {selectedId
              ? "Run the comparison to see exactly what changes before you approve."
              : "Select a version above to compare it."}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Baseline v{diff.base.version} ({diff.base.status}) → candidate v{diff.target.version} ({diff.target.status})
            </p>
            {sections.map((key) => {
              const s = diff.sections[key];
              if (!s) return null;
              const total = s.added_count + s.removed_count + s.changed_count;
              return (
                <section key={key} className="rounded-md border p-3" aria-label={`${label[key]} changes`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{label[key]}</h3>
                    {total === 0 ? (
                      <Badge variant="outline">No change</Badge>
                    ) : (
                      <>
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">+{s.added_count} added</Badge>
                        <Badge variant="outline" className="border-destructive/40 text-destructive">−{s.removed_count} removed</Badge>
                        <Badge variant="outline" className="border-status-warning/40 text-status-warning">{s.changed_count} changed</Badge>
                      </>
                    )}
                  </div>
                  {total > 0 && (
                    <ul className="mt-2 space-y-1 font-mono text-xs">
                      {s.added.slice(0, 12).map((r) => (
                        <li key={`a-${r.key}`} className="text-emerald-700">+ {r.key}</li>
                      ))}
                      {s.removed.slice(0, 12).map((r) => (
                        <li key={`r-${r.key}`} className="text-destructive">− {r.key}</li>
                      ))}
                      {s.changed.slice(0, 12).map((r) => (
                        <li key={`c-${r.key}`} className="text-status-warning">~ {r.key}</li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ================================================================ canary == */

export function NavCanaryPanel({
  version, onChanged,
}: { version: VersionLite | null; onChanged: () => void }) {
  const [roles, setRoles] = useState("");
  const [userIds, setUserIds] = useState("");
  const [percent, setPercent] = useState("25");
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      onChanged();
    } catch (e) {
      toast.error("Rollout action refused", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const staged = version?.rollout_mode === "canary";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-primary" aria-hidden="true" />
          Staged rollout
        </CardTitle>
        <CardDescription>
          Publish an approved version to a cohort first. Users outside the cohort keep serving the
          previously published navigation until you promote it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!version ? (
          <p className="text-sm text-muted-foreground">Select a version to stage.</p>
        ) : staged ? (
          <>
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <p className="font-medium">v{version.version} is live to a canary cohort</p>
              <p className="text-muted-foreground">
                Roles: {version.rollout_roles?.length ? version.rollout_roles.join(", ") : "any"} ·
                {" "}named users: {version.rollout_user_ids?.length ?? 0} ·
                {" "}{version.rollout_percent ?? 100}% of the cohort · started {when(version.canary_started_at)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <AppButton
                analytics="nav_registry_promote_canary"
                action="submit"
                disabled={busy !== null}
                onClick={() => run("promote", () => ops.promoteCanary(version.id), "Rollout promoted to every user")}
              >
                {busy === "promote" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Promote to full rollout
              </AppButton>
              <AppButton
                analytics="nav_registry_abort_canary"
                action="submit"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  run("abort", () => ops.abortCanary(version.id, "Aborted from the governance console"), "Canary aborted and reverted")
                }
              >
                Abort canary
              </AppButton>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="canary-roles">Roles (comma separated)</Label>
                <Input
                  id="canary-roles" value={roles} onChange={(e) => setRoles(e.target.value)}
                  placeholder="super_admin, ops_manager"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="canary-users">Named user ids</Label>
                <Input
                  id="canary-users" value={userIds} onChange={(e) => setUserIds(e.target.value)}
                  placeholder="uuid, uuid"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="canary-percent">Cohort percentage</Label>
                <Input
                  id="canary-percent" type="number" min={1} max={100}
                  value={percent} onChange={(e) => setPercent(e.target.value)}
                />
              </div>
            </div>
            <AppButton
              analytics="nav_registry_publish_canary"
              action="submit"
              disabled={busy !== null || version.status !== "approved"}
              title={version.status !== "approved" ? "Only an approved version can be staged." : undefined}
              onClick={() =>
                run(
                  "stage",
                  () =>
                    ops.publishCanary(version.id, {
                      roles: roles.split(",").map((r) => r.trim()).filter(Boolean),
                      userIds: userIds.split(",").map((r) => r.trim()).filter(Boolean),
                      percent: Number(percent) || 100,
                    }),
                  "Version staged to the canary cohort",
                )
              }
            >
              {busy === "stage" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Stage to canary cohort
            </AppButton>
            {version.status !== "approved" && (
              <p role="note" className="text-xs text-muted-foreground">
                Staged rollout unavailable — the version must be approved by someone other than its author first.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ================================================================= drift == */

export function NavDriftPanel() {
  const [status, setStatus] = useState<ops.DriftAlert["status"]>("open");
  const [alerts, setAlerts] = useState<ops.DriftAlert[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async (s: ops.DriftAlert["status"]) => {
    try {
      setAlerts(await ops.listDriftAlerts(s));
    } catch (e) {
      setAlerts([]);
      toast.error("Could not load drift alerts", { description: (e as Error).message });
    }
  }, []);

  useEffect(() => { void reload(status); }, [reload, status]);

  const triage = async (id: string, next: ops.DriftAlert["status"]) => {
    setBusy(id);
    try {
      await ops.triageDrift(id, next);
      toast.success(next === "resolved" ? "Alert resolved" : "Alert acknowledged");
      await reload(status);
    } catch (e) {
      toast.error("Triage refused", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const scan = async () => {
    setBusy("scan");
    try {
      const r = await ops.runDriftMonitor();
      toast.success(
        r.raised.length ? `${r.raised.length} drift condition(s) raised` : "No drift detected",
        { description: r.notified ? `${r.notified} notification(s) dispatched` : "Integrity checks passed." },
      );
      await reload(status);
    } catch (e) {
      toast.error("Drift scan failed", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radar className="h-4 w-4 text-primary" aria-hidden="true" />
              Drift detection
            </CardTitle>
            <CardDescription>
              Crawler integrity failures and runtime capability or access-rule changes that break protected navigation.
            </CardDescription>
          </div>
          <AppButton analytics="nav_drift_scan" action="submit" variant="outline" disabled={busy !== null} onClick={scan}>
            {busy === "scan" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Bell className="mr-2 h-4 w-4" aria-hidden="true" />}
            Run drift scan
          </AppButton>
        </div>
        <Tabs value={status} onValueChange={(v) => setStatus(v as ops.DriftAlert["status"])}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="acknowledged">Acknowledged</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {alerts === null ? (
          <Skeleton className="h-24 w-full" />
        ) : alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No {status} drift alerts. Protected navigation matches the published contract.
          </p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={ops.SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
                  <Badge variant="outline">{ops.DRIFT_KIND_LABEL[a.kind] ?? a.kind}</Badge>
                  <span className="text-sm font-medium">{a.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {a.occurrences}× · last seen {when(a.last_seen_at)}
                  </span>
                </div>
                {a.status !== "resolved" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {a.status === "open" && (
                      <AppButton
                        analytics="nav_drift_acknowledge"
                        action="submit"
                        variant="outline"
                        size="sm"
                        disabled={busy === a.id}
                        onClick={() => triage(a.id, "acknowledged")}
                      >
                        Acknowledge alert
                      </AppButton>
                    )}
                    <AppButton
                      analytics="nav_drift_resolve"
                      action="submit"
                      variant="ghost"
                      size="sm"
                      disabled={busy === a.id}
                      onClick={() => triage(a.id, "resolved")}
                    >
                      Mark resolved
                    </AppButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ================================================================= audit == */

export function NavAuditSearchPanel({ versions }: { versions: VersionLite[] }) {
  const [action, setAction] = useState("all");
  const [versionId, setVersionId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<ops.AuditSearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(
        await ops.searchAudit({
          action: action === "all" ? null : action,
          versionId: versionId === "all" ? null : versionId,
          from: from || null,
          to: to || null,
          search: search || null,
          limit: 200,
        }),
      );
    } catch (e) {
      toast.error("Could not search the governance audit", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [action, versionId, from, to, search]);

  useEffect(() => { void load(); }, [load]);

  const actions = useMemo(() => result?.actions ?? [], [result]);

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4 text-primary" aria-hidden="true" />
              Governance audit
            </CardTitle>
            <CardDescription>
              Every capture, validation, review, approval, publish, canary and rollback decision.
            </CardDescription>
          </div>
          <AppButton
            analytics="nav_registry_audit_export"
            action="submit"
            variant="outline"
            disabled={!result?.rows.length}
            onClick={() => {
              ops.downloadAuditCsv(result!.rows);
              toast.success("Governance audit exported as CSV");
            }}
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Export audit CSV
          </AppButton>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="audit-action">Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger id="audit-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {actions.map((a) => (
                  <SelectItem key={a} value={a}>{a.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-version">Version</Label>
            <Select value={versionId} onValueChange={setVersionId}>
              <SelectTrigger id="audit-version"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All versions</SelectItem>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>v{v.version} · {v.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-from">From</Label>
            <Input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-to">To</Label>
            <Input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-search">Free text</Label>
            <Input
              id="audit-search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Title, note or actor"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : !result || result.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No governance events match these filters.</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              Showing {result.rows.length} of {result.total} matching events.
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Transition</TableHead>
                    <TableHead>Actor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">{when(r.created_at)}</TableCell>
                      <TableCell className="text-xs">
                        {r.version ? `v${r.version} · ${r.title ?? ""}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs font-medium capitalize">{r.action.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.from_status || r.to_status ? `${r.from_status ?? "—"} → ${r.to_status ?? "—"}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {r.actor ?? "system"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
