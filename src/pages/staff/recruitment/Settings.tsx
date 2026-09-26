import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Timer, ShieldCheck, Layers, Plus } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import { APPLICATION_STAGES, STAGE_LABEL, titleise } from "@/lib/recruitment/types";

/** AI governance switches. Every one defaults to the conservative position. */
const AI_FLAGS: { key: string; label: string; description: string }[] = [
  {
    key: "ai_matching_enabled",
    label: "Candidate matching suggestions",
    description: "Rank candidates against a vacancy using the deterministic, explainable scorer.",
  },
  {
    key: "ai_next_best_action_enabled",
    label: "Ask SAFARID next-best-action",
    description: "Suggest the next recruitment action from pipeline records. Suggestions always require human review.",
  },
  {
    key: "ai_auto_actions_enabled",
    label: "Allow AI to act without review",
    description: "Off by design. Recruitment 360 never changes a candidate record without a recorded human decision.",
  },
];

export default function RecruitmentSettings() {
  const qc = useQueryClient();
  const slas = useQuery({ queryKey: ["rec", "slas"], queryFn: rec.listSlaPolicies });
  const settings = useQuery({ queryKey: ["rec", "settings"], queryFn: rec.listSettings });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ sla_key: "", label: "", target_hours: 48, applies_to: "application" });

  const flag = (key: string) => {
    const row = (settings.data ?? []).find((s) => s.setting_key === key);
    return Boolean((row?.value as { enabled?: boolean } | undefined)?.enabled);
  };

  const setFlag = useMutation({
    mutationFn: ({ key, enabled, description }: { key: string; enabled: boolean; description: string }) =>
      rec.saveSetting(key, { enabled }, description),
    onSuccess: () => {
      toast.success("Setting saved and recorded in the recruitment audit trail.");
      qc.invalidateQueries({ queryKey: ["rec", "settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveSla = useMutation({
    mutationFn: () => {
      if (!form.sla_key.trim() || !form.label.trim()) throw new Error("An SLA needs a key and a label.");
      if (!Number.isFinite(form.target_hours) || form.target_hours <= 0) throw new Error("Target hours must be greater than zero.");
      return rec.saveSlaPolicy({
        sla_key: form.sla_key.trim(),
        label: form.label.trim(),
        target_hours: Math.round(form.target_hours),
        applies_to: form.applies_to,
        is_active: true,
      });
    },
    onSuccess: () => {
      toast.success("SLA target saved — the attention queue uses it immediately.");
      setOpen(false);
      setForm({ sla_key: "", label: "", target_hours: 48, applies_to: "application" });
      qc.invalidateQueries({ queryKey: ["rec"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleSla = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => rec.setSlaPolicyActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rec"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Settings & governance"
        lede="Stages, SLA targets and AI governance for Recruitment 360. SLA targets drive the attention queue directly."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> New SLA target
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Timer className="h-4 w-4" aria-hidden="true" /> SLA targets
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {slas.isLoading ? (
              <div className="space-y-3 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : (slas.data ?? []).length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                No SLA targets configured. Until one exists the attention queue uses stated defaults —
                7 days in stage, 2 days for interview feedback, 5 days for an offer response.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {(slas.data ?? []).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{s.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.sla_key} · {s.target_hours} h ({Math.max(1, Math.round(s.target_hours / 24))} d) ·{" "}
                        {titleise(s.applies_to)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{s.is_active ? "Active" : "Off"}</span>
                      <Switch checked={s.is_active} aria-label={`Toggle ${s.label}`}
                        onCheckedChange={(v) => toggleSla.mutate({ id: s.id, active: v })} />
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
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> AI governance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {AI_FLAGS.map((f) => (
              <div key={f.key} className="flex items-start justify-between gap-3">
                <div>
                  <Label htmlFor={f.key} className="text-sm">{f.label}</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">{f.description}</p>
                </div>
                <Switch
                  id={f.key}
                  checked={flag(f.key)}
                  disabled={f.key === "ai_auto_actions_enabled"}
                  onCheckedChange={(v) => setFlag.mutate({ key: f.key, enabled: v, description: f.description })}
                />
              </div>
            ))}
            <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              Automatic AI action is permanently disabled. Every recommendation is logged as a request and needs an
              accepted, modified or rejected human decision before anything changes.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" aria-hidden="true" /> Pipeline stages
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {APPLICATION_STAGES.map((s, i) => (
              <Badge key={s} variant="outline" className="text-xs">
                {i + 1}. {STAGE_LABEL[s] ?? titleise(s)}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Stage order is enforced by the backend transition function so an application cannot skip a governed step.
          </p>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New SLA target</DialogTitle>
            <DialogDescription>
              Use the keys the attention queue reads: stage_progression, interview_feedback, offer_response.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="sla-key">Key</Label>
              <Input id="sla-key" value={form.sla_key} onChange={(e) => setForm({ ...form, sla_key: e.target.value })}
                placeholder="stage_progression" />
            </div>
            <div>
              <Label htmlFor="sla-label">Label</Label>
              <Input id="sla-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sla-hours">Target hours</Label>
                <Input id="sla-hours" type="number" min={1} value={form.target_hours}
                  onChange={(e) => setForm({ ...form, target_hours: Number(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor="sla-applies">Applies to</Label>
                <select id="sla-applies" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.applies_to} onChange={(e) => setForm({ ...form, applies_to: e.target.value })}>
                  <option value="application">Application</option>
                  <option value="vacancy">Vacancy</option>
                  <option value="interview">Interview</option>
                  <option value="offer">Offer</option>
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => saveSla.mutate()} disabled={saveSla.isPending}>
              {saveSla.isPending ? "Saving…" : "Save target"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
