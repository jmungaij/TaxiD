/**
 * Recruitment 360 — Requirement contract governance (/staff/recruitment/requirements)
 *
 * Audit and governance surface for the document requirement engine. Every
 * requirement version is a row: which vacancy owns it, its lifecycle state,
 * when it took effect, exactly which document keys it resolves, who configured,
 * approved and published it, and how many applications are permanently bound.
 *
 * Laws visible here — all enforced in the database, never by this page:
 *   - A published version is IMMUTABLE. Changing what a vacancy demands means
 *     creating a new draft version (draft → review → approved → published).
 *   - Four eyes: the person who created a version cannot approve or publish it.
 *   - New applicants resolve the latest ACTIVE version; an in-flight application
 *     stays bound to the version active when it was created.
 *   - Publication requires a valid compiled contract; publishing a new version
 *     invalidates end-to-end evidence recorded against the previous contract.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileCheck2, GitCompareArrows, History, Layers, ListChecks, Plus, RefreshCcw, Search,
  ShieldCheck, Sparkles,
} from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import RequirementRuleEditor from "@/components/staff/recruitment/RequirementRuleEditor";
import {
  availableActions, compareRequirementVersions, compileReasonCopy, compileRequirementContract,
  createRequirementDraft, docKeyDiff, groupByOwner, LIFECYCLE_ACTION_LABELS, listRequirementVersions,
  requirementLifecycleAction, runIntegrityCheck, statusLabel, statusTone, stillGoverning,
  versionSearchMatches, type ContractCompileResult, type LifecycleAction,
  type RequirementVersionRow, type VersionCompareResult, type VacancyVersionGroup,
} from "@/lib/recruitment/requirementVersions";

const TONE: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning-foreground border-warning/30",
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-primary/10 text-primary border-primary/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
};

const fmt = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

function KeyChips({ keys, mandatory }: { keys: string[] | null; mandatory: string[] | null }) {
  const mandatorySet = new Set(mandatory ?? []);
  if (!keys || keys.length === 0) {
    return <span className="text-xs text-muted-foreground">Resolves no document keys</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((k) => (
        <Badge key={k} variant="outline" className={mandatorySet.has(k) ? TONE.info : TONE.neutral}>
          {k}{mandatorySet.has(k) ? "" : " (optional)"}
        </Badge>
      ))}
    </div>
  );
}

function CompileReport({ result }: { result: ContractCompileResult }) {
  const valid = result.verdict === "CONTRACT_VALID";
  return (
    <div className="space-y-2 rounded-md border p-3 text-xs">
      <Badge variant="outline" className={valid ? TONE.success : TONE.danger}>
        {valid ? "CONTRACT VALID" : "CONTRACT INVALID"}
      </Badge>
      <p className="text-muted-foreground">
        v{result.version} · {result.mandatory_count} mandatory of {result.rule_count} rules ·
        {" "}{result.verification_required_count} require staff verification · compiled {fmt(result.compiled_at)}
      </p>
      {result.errors.length > 0 && (
        <ul className="list-disc space-y-1 pl-4 text-destructive">
          {result.errors.map((e) => <li key={e}>{compileReasonCopy(e)}</li>)}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-4 text-warning-foreground">
          {result.warnings.map((w) => <li key={w}>{compileReasonCopy(w)}</li>)}
        </ul>
      )}
    </div>
  );
}

function CompareReport({ result }: { result: VersionCompareResult }) {
  const empty = !result.added.length && !result.removed.length && !result.changed.length;
  return (
    <div className="space-y-2 rounded-md border p-3 text-xs">
      {empty && <p className="text-muted-foreground">No requirement differences between these versions.</p>}
      {result.added.map((r) => (
        <p key={`a-${r.doc_key}`} className="text-success">ADDED · {r.doc_key} — {r.label}</p>
      ))}
      {result.removed.map((r) => (
        <p key={`r-${r.doc_key}`} className="text-destructive">REMOVED · {r.doc_key} — {r.label}</p>
      ))}
      {result.changed.map((r) => (
        <p key={`c-${r.doc_key}`} className="text-warning-foreground">
          CHANGED · {r.doc_key} — mandatory {String(r.from.mandatory)} → {String(r.to.mandatory)},
          {" "}verification {String(r.from.requires_verification)} → {String(r.to.requires_verification)}
        </p>
      ))}
    </div>
  );
}

function VersionRow({
  row, previous, onCompile, onCompare, onAction, onEdit, busy,
}: {
  row: RequirementVersionRow;
  previous?: RequirementVersionRow;
  onCompile: (row: RequirementVersionRow) => void;
  onCompare: (row: RequirementVersionRow, previous: RequirementVersionRow) => void;
  onAction: (row: RequirementVersionRow, action: LifecycleAction) => void;
  onEdit: (row: RequirementVersionRow) => void;
  busy: boolean;
}) {

  const diff = previous ? docKeyDiff(previous.doc_keys, row.doc_keys) : null;
  return (
    <TableRow>
      <TableCell className="align-top font-medium">v{row.version}</TableCell>
      <TableCell className="align-top">
        <Badge variant="outline" className={TONE[statusTone(row.status)]}>{statusLabel(row.status)}</Badge>
        {stillGoverning(row) && (
          <p className="mt-1 text-xs text-warning-foreground">
            Still governs {row.bound_applications} bound application{row.bound_applications === 1 ? "" : "s"}
          </p>
        )}
      </TableCell>
      <TableCell className="align-top text-xs">
        <span className="block">from {fmt(row.effective_from)}</span>
        <span className="block text-muted-foreground">until {fmt(row.effective_until)}</span>
      </TableCell>
      <TableCell className="align-top text-xs">
        {row.mandatory_count} mandatory / {row.rule_count} rules
        {row.vacancy_content_version !== null && (
          <span className="block text-muted-foreground">vacancy content v{row.vacancy_content_version}</span>
        )}
        {(row.verification_required_keys?.length ?? 0) > 0 && (
          <span className="block text-muted-foreground">
            {row.verification_required_keys!.length} need verification
          </span>
        )}
      </TableCell>
      <TableCell className="align-top">
        <KeyChips keys={row.doc_keys} mandatory={row.mandatory_doc_keys} />
        {diff && (diff.added.length > 0 || diff.removed.length > 0) && (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <GitCompareArrows className="h-3 w-3" aria-hidden />
            {diff.added.length > 0 && <span>added {diff.added.join(", ")}</span>}
            {diff.removed.length > 0 && <span>removed {diff.removed.join(", ")}</span>}
          </p>
        )}
      </TableCell>
      <TableCell className="align-top text-xs text-muted-foreground">
        <span className="block">approved {fmt(row.approved_at)}</span>
        <span className="block">published {fmt(row.published_at)}</span>
      </TableCell>
      <TableCell className="align-top text-right">{row.bound_applications}</TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap justify-end gap-1">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onCompile(row)} data-analytics="none">
            <FileCheck2 className="mr-1 h-3.5 w-3.5" aria-hidden />Compile
          </Button>
          {row.status === "draft" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(row)} data-analytics="none">
              Edit requirements
            </Button>
          )}

          {previous && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onCompare(row, previous)} data-analytics="none">
              <GitCompareArrows className="mr-1 h-3.5 w-3.5" aria-hidden />Compare
            </Button>
          )}
          {availableActions(row.status).map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === "publish" ? "default" : "outline"}
              disabled={busy}
              onClick={() => onAction(row, action)}
              data-analytics="none"
            >
              {LIFECYCLE_ACTION_LABELS[action]}
            </Button>
          ))}
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function RequirementHistory() {
  const [query, setQuery] = useState("");
  const [compile, setCompile] = useState<ContractCompileResult | null>(null);
  const [compare, setCompare] = useState<VersionCompareResult | null>(null);
  const [pending, setPending] = useState<{ row: RequirementVersionRow; action: LifecycleAction } | null>(null);
  const [editRow, setEditRow] = useState<RequirementVersionRow | null>(null);
  const [note, setNote] = useState("");
  const [integrity, setIntegrity] = useState(false);
  const qc = useQueryClient();

  const versions = useQuery({
    queryKey: ["rec", "requirement-versions"],
    queryFn: listRequirementVersions,
  });

  const integrityQuery = useQuery({
    queryKey: ["rec", "requirement-integrity"],
    queryFn: runIntegrityCheck,
    enabled: integrity,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["rec", "requirement-versions"] });

  const compileMutation = useMutation({
    mutationFn: (row: RequirementVersionRow) => compileRequirementContract(row.set_id),
    onSuccess: (result) => setCompile(result),
    onError: (e: Error) => toast({ title: "Compile failed", description: e.message, variant: "destructive" }),
  });

  const compareMutation = useMutation({
    mutationFn: (input: { from: string; to: string }) => compareRequirementVersions(input.from, input.to),
    onSuccess: (result) => setCompare(result),
    onError: (e: Error) => toast({ title: "Comparison failed", description: e.message, variant: "destructive" }),
  });

  const draftMutation = useMutation({
    mutationFn: (group: VacancyVersionGroup) =>
      createRequirementDraft({ scope: group.scope, vacancyId: group.vacancy_id }),
    onSuccess: (r) => {
      toast({ title: `Draft v${r.version} created`, description: `${r.rules_copied} requirement rows cloned. It is not enforced until published.` });
      refresh();
    },
    onError: (e: Error) => toast({ title: "Could not create draft", description: e.message, variant: "destructive" }),
  });

  const actionMutation = useMutation({
    mutationFn: (input: { setId: string; action: LifecycleAction; note: string }) =>
      requirementLifecycleAction(input.setId, input.action, input.note || undefined),
    onSuccess: (r) => {
      toast({ title: `Requirement version ${r.status}`, description: "Recorded in the append-only requirement audit trail." });
      setPending(null);
      setNote("");
      refresh();
      qc.invalidateQueries({ queryKey: ["rec", "requirement-integrity"] });
    },
    onError: (e: Error) => toast({ title: "Action refused", description: e.message, variant: "destructive" }),
  });

  const groups = useMemo(() => {
    const rows = (versions.data ?? []).filter((r) => versionSearchMatches(r, query));
    return groupByOwner(rows);
  }, [versions.data, query]);

  const totals = useMemo(() => {
    const rows = versions.data ?? [];
    return {
      versions: rows.length,
      active: rows.filter((r) => r.status === "active").length,
      inFlight: rows.filter((r) => ["draft", "review", "approved"].includes(r.status)).length,
      orphanedGovernance: rows.filter(stillGoverning).length,
    };
  }, [versions.data]);

  const busy = actionMutation.isPending || draftMutation.isPending;

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Requirement contract governance"
        lede="Published requirement versions are immutable. To change what a vacancy demands, create a new draft, have a second person approve it, then publish — new applicants resolve the latest active version while in-flight applications stay bound to theirs."
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={TONE.info}>
              <Layers className="mr-1.5 h-3.5 w-3.5" aria-hidden />{totals.versions} version{totals.versions === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline" className={TONE.success}>
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />{totals.active} active
            </Badge>
            {totals.inFlight > 0 && (
              <Badge variant="outline" className={TONE.warning}>{totals.inFlight} in the approval pipeline</Badge>
            )}
            <Button variant="outline" onClick={() => versions.refetch()} disabled={versions.isFetching} data-analytics="none">
              <RefreshCcw className="mr-2 h-4 w-4" aria-hidden />Refresh
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[16rem] flex-1">
            <Label htmlFor="req-search" className="text-xs">Search vacancy, slug or document key</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input
                id="req-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="kcse_certificate, transcript, internship…"
                className="pl-8"
              />
            </div>
          </div>
          {totals.orphanedGovernance > 0 && (
            <Badge variant="outline" className={TONE.warning}>
              <History className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {totals.orphanedGovernance} superseded version{totals.orphanedGovernance === 1 ? "" : "s"} still governing applications
            </Badge>
          )}
          <Button variant="outline" onClick={() => setIntegrity((v) => !v)} data-analytics="none">
            <Sparkles className="mr-2 h-4 w-4" aria-hidden />
            {integrity ? "Hide integrity check" : "Run integrity check"}
          </Button>
          <Button variant="outline" asChild data-analytics="none">
            <Link to="/staff/recruitment/pipeline">
              <ListChecks className="mr-2 h-4 w-4" aria-hidden />Pipeline
            </Link>
          </Button>
        </CardContent>
      </Card>

      {integrity && (
        <Card>
          <CardHeader><CardTitle className="text-base">Requirement integrity check — every published vacancy</CardTitle></CardHeader>
          <CardContent>
            {integrityQuery.isLoading && <Skeleton className="h-24 w-full" />}
            {integrityQuery.error && (
              <p className="text-sm text-destructive" role="alert">{(integrityQuery.error as Error).message}</p>
            )}
            {integrityQuery.data && (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Vacancy</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Mandatory keys</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {integrityQuery.data.map((r) => (
                    <TableRow key={r.vacancy_id}>
                      <TableCell className="text-xs">{r.title}</TableCell>
                      <TableCell className="text-xs">{r.requirement_version ? `v${r.requirement_version}` : "—"}</TableCell>
                      <TableCell className="text-xs">{(r.mandatory_doc_keys ?? []).join(", ") || "—"}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className={r.result === "PASS" ? TONE.success : TONE.danger}>{r.result}</Badge>
                        {(r.reasons ?? []).length > 0 && (
                          <span className="ml-2 text-muted-foreground">
                            {(r.reasons ?? []).map(compileReasonCopy).join(" ")}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {versions.isLoading && <Skeleton className="h-64 w-full" />}
      {versions.error && (
        <p className="text-sm text-destructive" role="alert">{(versions.error as Error).message}</p>
      )}

      {!versions.isLoading && groups.length === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          No requirement versions match this search.
        </CardContent></Card>
      )}

      {groups.map((group) => {
        const hasUnpublished = group.versions.some((v) => ["draft", "review", "approved"].includes(v.status));
        return (
          <Card key={group.key}>
            <CardHeader className="space-y-1">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {group.title}
                <Badge variant="outline" className={TONE.neutral}>{group.scope}</Badge>
                {group.active ? (
                  <Badge variant="outline" className={TONE.success}>active v{group.active.version}</Badge>
                ) : (
                  <Badge variant="outline" className={TONE.warning}>no active version — engine resolves nothing</Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={busy || hasUnpublished}
                  onClick={() => draftMutation.mutate(group)}
                  data-analytics="none"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {hasUnpublished ? "Version in pipeline" : "New draft version"}
                </Button>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {group.public_slug ? `/careers/${group.public_slug} · ` : ""}
                {group.bound_applications} application{group.bound_applications === 1 ? "" : "s"} bound across all versions
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Rules</TableHead>
                  <TableHead>Resolved document keys</TableHead>
                  <TableHead>Provenance</TableHead>
                  <TableHead className="text-right">Bound</TableHead>
                  <TableHead className="text-right">Governance</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {group.versions.map((row, i) => (
                    <VersionRow
                      key={row.set_id}
                      row={row}
                      previous={group.versions[i + 1]}
                      busy={busy}
                      onCompile={(r) => compileMutation.mutate(r)}
                      onCompare={(r, prev) => compareMutation.mutate({ from: prev.set_id, to: r.set_id })}
                      onAction={(r, action) => { setNote(""); setPending({ row: r, action }); }}
                      onEdit={(r) => setEditRow(r)}

                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editRow ? `Requirements — v${editRow.version} (draft)` : ""}
            </DialogTitle>
            <DialogDescription>
              Define each mandatory requirement and the evidence candidates must file against it.
              Only a draft version can be edited; published versions stay immutable.
            </DialogDescription>
          </DialogHeader>
          {editRow && <RequirementRuleEditor setId={editRow.set_id} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!compile} onOpenChange={(o) => !o && setCompile(null)}>

        <DialogContent>
          <DialogHeader>
            <DialogTitle>Compiled requirement contract</DialogTitle>
            <DialogDescription>
              The compiler runs in the database. Publication is refused unless the contract is valid.
            </DialogDescription>
          </DialogHeader>
          {compile && <CompileReport result={compile} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!compare} onOpenChange={(o) => !o && setCompare(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Version comparison</DialogTitle>
            <DialogDescription>Added, removed and changed requirements, computed server-side.</DialogDescription>
          </DialogHeader>
          {compare && <CompareReport result={compare} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending ? `${LIFECYCLE_ACTION_LABELS[pending.action]} — v${pending.row.version}` : ""}
            </DialogTitle>
            <DialogDescription>
              {pending?.action === "publish"
                ? "Publishing supersedes the current active version immutably and invalidates end-to-end evidence recorded against the previous contract. Applications already in flight stay on their bound version."
                : pending?.action === "approve"
                  ? "An admin holds sole-approver authority and may approve a version they created; the decision is recorded as a single-approver action. Other staff still need a second approver."
                  : "This action is recorded in the append-only requirement audit trail."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="lifecycle-note" className="text-xs">Note (optional)</Label>
            <Textarea id="lifecycle-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} data-analytics="none">Cancel</Button>
            <Button
              disabled={actionMutation.isPending}
              onClick={() => pending && actionMutation.mutate({ setId: pending.row.set_id, action: pending.action, note })}
              data-analytics="none"
            >
              {pending ? LIFECYCLE_ACTION_LABELS[pending.action] : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
