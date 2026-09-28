/**
 * Document Templates Registry — /staff/commercial/templates
 *
 * The single register of every master document TaxiD issues: the Mobility
 * Service Contract, the Charter Rate Card and the Tax Invoice. Every version
 * carries its own content, its fill-in fields, a content fingerprint and a
 * permanent history. The database owns the gates:
 *
 *   - a version must be reviewed before it can be approved;
 *   - the person who wrote a version cannot approve it (admins may act alone,
 *     recorded as sole approver);
 *   - only an approved version can be published, and publishing retires the
 *     version it replaces;
 *   - a version whose authoritative source document is missing cannot be
 *     reviewed or published at all.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck, ChevronDown, ChevronRight, FileStack, Fingerprint, Loader2, Plus, ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { toneClasses } from "@/lib/design/statusTone";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  KIND_LABEL, STATUS_LABEL, STATUS_TONE,
  availableActions, clauseCount, createTemplateVersion, fetchTemplateRegistry, runTemplateAction,
  type TemplateAction, type TemplateRecord, type TemplateRegistry, type TemplateVersion,
} from "@/lib/commercial/templateRegistry";

const ACTION_LABEL: Record<TemplateAction, string> = {
  SUBMIT: "Send for review",
  APPROVE: "Approve",
  REJECT: "Send back",
  PUBLISH: "Publish",
  RETIRE: "Retire",
};

const NEEDS_NOTE: TemplateAction[] = ["REJECT", "RETIRE"];

function badgeTone(tone: string): string {
  const t = toneClasses(tone);
  return cn(t.bg, t.text, t.border, "border");
}

function when(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

export default function DocumentTemplates() {
  const { user } = useAuth();
  const [registry, setRegistry] = useState<TemplateRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [newVersion, setNewVersion] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRegistry(await fetchTemplateRegistry());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The template registry could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const ctx = useMemo(
    () => ({
      canManage: registry?.can_manage ?? false,
      isAdmin: registry?.is_admin ?? false,
      userId: user?.id ?? null,
    }),
    [registry, user],
  );

  const act = async (v: TemplateVersion, action: TemplateAction) => {
    const note = notes[v.id] ?? "";
    if (NEEDS_NOTE.includes(action) && !note.trim()) {
      toast({
        title: "A reason is required",
        description: `Write why you are choosing "${ACTION_LABEL[action]}" before continuing.`,
        variant: "destructive",
      });
      return;
    }
    setBusy(`${v.id}-${action}`);
    try {
      const res = await runTemplateAction(v.id, action, note);
      toast({
        title: `${ACTION_LABEL[action]} recorded`,
        description: res.sole_approver
          ? `Version ${v.version} is now ${STATUS_LABEL[res.status].toLowerCase()} — approved by you alone and recorded as such.`
          : `Version ${v.version} is now ${STATUS_LABEL[res.status].toLowerCase()}.`,
      });
      setNotes((prev) => ({ ...prev, [v.id]: "" }));
      await load();
    } catch (e) {
      toast({
        title: `${ACTION_LABEL[action]} refused`,
        description: e instanceof Error ? e.message : "The database refused the change.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const draft = async (t: TemplateRecord) => {
    const version = (newVersion[t.id] ?? "").trim();
    if (!version) {
      toast({ title: "Name the new version", description: "For example v1.1.", variant: "destructive" });
      return;
    }
    setBusy(`draft-${t.id}`);
    try {
      await createTemplateVersion(t.id, version, "Drafted from the current published version.");
      toast({
        title: "New draft created",
        description: `${t.name} ${version} copies the current wording, ready for editing and review.`,
      });
      setNewVersion((prev) => ({ ...prev, [t.id]: "" }));
      await load();
    } catch (e) {
      toast({
        title: "Draft refused",
        description: e instanceof Error ? e.message : "The database refused the new version.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6" data-testid="document-templates">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <FileStack className="h-6 w-6 text-primary" aria-hidden />
          Document templates
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The master wording behind every contract, rate card and invoice TaxiD issues. Each version is
          reviewed and approved before it can be published, and only one version of a document is live at a time.
        </p>
      </header>

      <AsyncState loading={loading} error={error} onRetry={() => void load()}>
        {registry && (
          <div className="space-y-5">
            {registry.templates.map((t) => {
              const live = t.versions.find((v) => v.status === "PUBLISHED") ?? null;
              return (
                <Card key={t.id}>
                  <CardHeader className="gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        {t.name}
                        <Badge variant="outline">{KIND_LABEL[t.kind]}</Badge>
                        {live ? (
                          <Badge className={badgeTone("success")}>
                            <BadgeCheck className="mr-1 h-3 w-3" aria-hidden /> Live {live.version}
                          </Badge>
                        ) : (
                          <Badge className={badgeTone("warning")}>No live version</Badge>
                        )}
                      </CardTitle>
                      {ctx.canManage && (
                        <div className="flex items-center gap-2">
                          <Input
                            value={newVersion[t.id] ?? ""}
                            onChange={(e) => setNewVersion((p) => ({ ...p, [t.id]: e.target.value }))}
                            placeholder="v1.1"
                            className="h-9 w-24"
                            aria-label={`New version number for ${t.name}`}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === `draft-${t.id}`}
                            onClick={() => void draft(t)}
                          >
                            {busy === `draft-${t.id}` ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                            )}
                            New draft
                          </Button>
                        </div>
                      )}
                    </div>
                    {t.description && (
                      <p className="text-sm text-muted-foreground">{t.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t.legal_entity} · {t.jurisdiction} · {t.classification}
                      {t.source_reference ? ` · Source: ${t.source_reference}` : ""}
                    </p>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    {t.versions.map((v) => {
                      const actions = availableActions(v, ctx);
                      const isOpen = !!open[v.id];
                      return (
                        <div key={v.id} className="rounded-lg border border-border/70 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <button
                              type="button"
                              className="flex items-center gap-2 text-left text-sm font-medium text-foreground"
                              onClick={() => setOpen((p) => ({ ...p, [v.id]: !isOpen }))}
                              aria-expanded={isOpen}
                            >
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4" aria-hidden />
                              ) : (
                                <ChevronRight className="h-4 w-4" aria-hidden />
                              )}
                              Version {v.version}
                              <Badge className={badgeTone(STATUS_TONE[v.status])}>
                                {STATUS_LABEL[v.status]}
                              </Badge>
                              {v.source_status === "SOURCE_DOCUMENT_REQUIRED" && (
                                <Badge className={badgeTone("danger")}>
                                  <ShieldAlert className="mr-1 h-3 w-3" aria-hidden /> Source document required
                                </Badge>
                              )}
                            </button>
                            <div className="flex flex-wrap items-center gap-2">
                              {actions.map((a) => (
                                <Button
                                  key={a}
                                  size="sm"
                                  variant={a === "APPROVE" || a === "PUBLISH" ? "default" : "outline"}
                                  disabled={busy === `${v.id}-${a}`}
                                  onClick={() => void act(v, a)}
                                >
                                  {busy === `${v.id}-${a}` && (
                                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                                  )}
                                  {ACTION_LABEL[a]}
                                </Button>
                              ))}
                            </div>
                          </div>

                          <p className="mt-2 text-xs text-muted-foreground">
                            {v.section_count} sections · {clauseCount(v)} clauses · {v.variable_count} fill-in fields ·
                            written by {v.author_name ?? "seeded"} · created {when(v.created_at)}
                          </p>
                          {v.notes && <p className="mt-1 text-xs text-muted-foreground">{v.notes}</p>}
                          {v.content_fingerprint && (
                            <p className="mt-1 flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                              <Fingerprint className="h-3 w-3" aria-hidden />
                              {v.content_fingerprint.slice(0, 24)}…
                            </p>
                          )}

                          {ctx.canManage && actions.some((a) => NEEDS_NOTE.includes(a)) && (
                            <Textarea
                              value={notes[v.id] ?? ""}
                              onChange={(e) => setNotes((p) => ({ ...p, [v.id]: e.target.value }))}
                              placeholder="Reason (required to send back or retire)"
                              className="mt-2 min-h-[60px] text-sm"
                              aria-label={`Reason for acting on version ${v.version}`}
                            />
                          )}

                          {isOpen && (
                            <div className="mt-3 space-y-4 border-t border-border/60 pt-3">
                              {v.variables.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Fill-in fields
                                  </p>
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {v.variables.map((f) => (
                                      <Badge key={f.key} variant="outline" className="text-[11px]">
                                        {f.label}{f.required ? " *" : ""}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="space-y-3">
                                {v.body.map((s, i) => (
                                  <div key={`${v.id}-s${i}`}>
                                    <p className="text-sm font-semibold text-foreground">
                                      {s.article ? `${s.article}. ` : ""}{s.title}
                                    </p>
                                    <div className="mt-1 space-y-2">
                                      {(s.clauses ?? []).map((c, j) => (
                                        <div key={`${v.id}-s${i}-c${j}`} className="text-sm text-muted-foreground">
                                          <span className="font-medium text-foreground">
                                            {c.no}{c.heading ? ` ${c.heading}` : ""}
                                          </span>{" "}
                                          {c.text}
                                          {c.table && (
                                            <p className="mt-1 text-xs italic">
                                              Table: {c.table.caption ?? "—"} ({(c.table.rows ?? []).length} rows)
                                            </p>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {v.approvals.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Approvals
                                  </p>
                                  <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                                    {v.approvals.map((a, i) => (
                                      <li key={`${v.id}-a${i}`}>
                                        {a.decision === "APPROVED" ? "Approved" : "Sent back"} by{" "}
                                        {a.decided_by_name ?? "—"} on {when(a.created_at)}
                                        {a.sole_approver ? " (sole approver)" : ""}
                                        {a.note ? ` — ${a.note}` : ""}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  History
                                </p>
                                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                                  {v.events.map((e, i) => (
                                    <li key={`${v.id}-e${i}`}>
                                      {when(e.created_at)} · {e.event}
                                      {e.status_after ? ` → ${e.status_after}` : ""}
                                      {e.actor_name ? ` · ${e.actor_name}` : ""}
                                      {e.note ? ` — ${e.note}` : ""}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </AsyncState>
    </div>
  );
}
