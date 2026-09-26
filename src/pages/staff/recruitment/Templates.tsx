import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Workflow, Plus } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import { titleise } from "@/lib/recruitment/types";

const TEMPLATE_KINDS = ["application_ack", "screening_outcome", "interview_invite", "offer", "rejection", "talent_pool", "general"];
const TRIGGER_EVENTS = [
  "application_created",
  "screening_recorded",
  "shortlist_decision",
  "interview_scheduled",
  "evaluation_decision",
  "offer_status_changed",
  "onboarding_completed",
];

/**
 * Templates & workflows — the configured message library and the event-triggered
 * automation rules Recruitment 360 may apply. Nothing here fires without an
 * active flag, and every save is audited.
 */
export default function RecruitmentTemplates() {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ["rec", "templates"], queryFn: rec.listTemplates });
  const workflows = useQuery({ queryKey: ["rec", "workflows"], queryFn: rec.listWorkflows });

  const [tplOpen, setTplOpen] = useState(false);
  const [tpl, setTpl] = useState({ template_key: "", name: "", kind: "general", subject: "", body: "", variables: "" });

  const [wfOpen, setWfOpen] = useState(false);
  const [wf, setWf] = useState({ workflow_key: "", name: "", trigger_event: TRIGGER_EVENTS[0], template_key: "", note: "" });

  const saveTpl = useMutation({
    mutationFn: () => {
      if (!tpl.template_key.trim() || !tpl.name.trim()) throw new Error("A template needs a key and a name.");
      return rec.saveTemplate({
        template_key: tpl.template_key.trim(),
        name: tpl.name.trim(),
        kind: tpl.kind,
        subject: tpl.subject.trim() || null,
        body: tpl.body,
        variables: tpl.variables.split(",").map((v) => v.trim()).filter(Boolean),
        is_active: true,
      });
    },
    onSuccess: () => {
      toast.success("Template saved.");
      setTplOpen(false);
      setTpl({ template_key: "", name: "", kind: "general", subject: "", body: "", variables: "" });
      qc.invalidateQueries({ queryKey: ["rec", "templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleTpl = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => rec.setTemplateActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rec", "templates"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const saveWf = useMutation({
    mutationFn: () => {
      if (!wf.workflow_key.trim() || !wf.name.trim()) throw new Error("A workflow needs a key and a name.");
      return rec.saveWorkflow({
        workflow_key: wf.workflow_key.trim(),
        name: wf.name.trim(),
        trigger_event: wf.trigger_event,
        conditions: {},
        actions: { notify_template: wf.template_key || null, note: wf.note.trim() || null },
        is_active: false,
      });
    },
    onSuccess: () => {
      toast.success("Workflow saved as inactive — activate it when you are ready.");
      setWfOpen(false);
      setWf({ workflow_key: "", name: "", trigger_event: TRIGGER_EVENTS[0], template_key: "", note: "" });
      qc.invalidateQueries({ queryKey: ["rec", "workflows"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleWf = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => rec.setWorkflowActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rec", "workflows"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Templates & workflows"
        lede="The approved candidate message library and the event-triggered rules that keep the pipeline moving."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setWfOpen(true)}>
              <Workflow className="mr-1 h-4 w-4" aria-hidden="true" /> New workflow
            </Button>
            <Button onClick={() => setTplOpen(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> New template
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" aria-hidden="true" /> Templates ({(templates.data ?? []).length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {templates.isLoading ? (
              <div className="space-y-3 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : (templates.data ?? []).length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No templates configured. Create one so recruiters send consistent, approved wording.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {(templates.data ?? []).map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.template_key} · {titleise(t.kind)}
                      </p>
                      {t.subject && <p className="mt-1 text-xs text-muted-foreground truncate">{t.subject}</p>}
                      {t.variables?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {t.variables.map((v) => (
                            <Badge key={v} variant="outline" className="text-[10px]">{`{{${v}}}`}</Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{t.is_active ? "Active" : "Off"}</span>
                      <Switch
                        checked={t.is_active}
                        aria-label={`Toggle ${t.name}`}
                        onCheckedChange={(v) => toggleTpl.mutate({ id: t.id, active: v })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Workflow className="h-4 w-4" aria-hidden="true" /> Workflows ({(workflows.data ?? []).length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {workflows.isLoading ? (
              <div className="space-y-3 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : (workflows.data ?? []).length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No workflows configured. Workflows react to recruitment events such as a recorded screening decision.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {(workflows.data ?? []).map((w) => (
                  <li key={w.id} className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{w.name}</p>
                      <p className="text-xs text-muted-foreground">
                        On {titleise(w.trigger_event)} · {w.workflow_key}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{w.is_active ? "Active" : "Off"}</span>
                      <Switch
                        checked={w.is_active}
                        aria-label={`Toggle ${w.name}`}
                        onCheckedChange={(v) => toggleWf.mutate({ id: w.id, active: v })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New template</DialogTitle>
            <DialogDescription>
              Use {"{{variable}}"} placeholders — Communications fills them from the candidate and vacancy record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="tpl-key">Key</Label>
                <Input id="tpl-key" value={tpl.template_key}
                  onChange={(e) => setTpl({ ...tpl, template_key: e.target.value })} placeholder="interview_invite_v1" />
              </div>
              <div>
                <Label htmlFor="tpl-kind">Kind</Label>
                <select id="tpl-kind" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={tpl.kind} onChange={(e) => setTpl({ ...tpl, kind: e.target.value })}>
                  {TEMPLATE_KINDS.map((k) => <option key={k} value={k}>{titleise(k)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="tpl-name">Name</Label>
              <Input id="tpl-name" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="tpl-subject">Subject</Label>
              <Input id="tpl-subject" value={tpl.subject} onChange={(e) => setTpl({ ...tpl, subject: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="tpl-body">Body</Label>
              <Textarea id="tpl-body" rows={6} value={tpl.body} onChange={(e) => setTpl({ ...tpl, body: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="tpl-vars">Variables (comma separated)</Label>
              <Input id="tpl-vars" value={tpl.variables} onChange={(e) => setTpl({ ...tpl, variables: e.target.value })}
                placeholder="candidate_name, vacancy_title" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTplOpen(false)}>Cancel</Button>
            <Button onClick={() => saveTpl.mutate()} disabled={saveTpl.isPending}>
              {saveTpl.isPending ? "Saving…" : "Save template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={wfOpen} onOpenChange={setWfOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>Workflows are saved inactive so they can be reviewed before they take effect.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="wf-key">Key</Label>
                <Input id="wf-key" value={wf.workflow_key} onChange={(e) => setWf({ ...wf, workflow_key: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="wf-trigger">Trigger event</Label>
                <select id="wf-trigger" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={wf.trigger_event} onChange={(e) => setWf({ ...wf, trigger_event: e.target.value })}>
                  {TRIGGER_EVENTS.map((t) => <option key={t} value={t}>{titleise(t)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="wf-name">Name</Label>
              <Input id="wf-name" value={wf.name} onChange={(e) => setWf({ ...wf, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="wf-template">Notify with template</Label>
              <select id="wf-template" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={wf.template_key} onChange={(e) => setWf({ ...wf, template_key: e.target.value })}>
                <option value="">None</option>
                {(templates.data ?? []).map((t) => <option key={t.id} value={t.template_key}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="wf-note">Intent</Label>
              <Textarea id="wf-note" rows={3} value={wf.note} onChange={(e) => setWf({ ...wf, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWfOpen(false)}>Cancel</Button>
            <Button onClick={() => saveWf.mutate()} disabled={saveWf.isPending}>
              {saveWf.isPending ? "Saving…" : "Save workflow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
