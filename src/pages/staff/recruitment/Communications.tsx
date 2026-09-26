import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Send, Mail, MessageSquare, Phone } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

import * as rec from "@/lib/recruitment/api";
import { STAGE_LABEL, titleise } from "@/lib/recruitment/types";

const CHANNEL_ICON: Record<string, typeof Mail> = { email: Mail, sms: MessageSquare, whatsapp: MessageSquare, call: Phone };

/**
 * Communications — every candidate-facing message, tied to the candidate, the
 * application it belongs to, and the template that produced it. Logging a
 * message stamps the candidate's last-contact date so cadence is measurable.
 */
export default function RecruitmentCommunications() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const candidateId = params.get("candidate") ?? "";

  const candidates = useQuery({ queryKey: ["rec", "candidates"], queryFn: rec.listCandidates });
  const applications = useQuery({ queryKey: ["rec", "applications"], queryFn: () => rec.listApplications() });
  const templates = useQuery({ queryKey: ["rec", "templates"], queryFn: rec.listTemplates });
  const comms = useQuery({ queryKey: ["rec", "communications"], queryFn: () => rec.listCommunications() });
  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies });

  const [form, setForm] = useState({
    applicationId: "",
    channel: "email",
    templateKey: "",
    subject: "",
    body: "",
  });

  const candidate = (id: string) => (candidates.data ?? []).find((c) => c.id === id);
  const selected = candidateId ? candidate(candidateId) : undefined;

  const candidateApplications = useMemo(
    () => (applications.data ?? []).filter((a) => a.candidate_id === candidateId),
    [applications.data, candidateId],
  );

  const timeline = useMemo(
    () => (comms.data ?? []).filter((c) => !candidateId || c.candidate_id === candidateId),
    [comms.data, candidateId],
  );

  const applyTemplate = (key: string) => {
    const t = (templates.data ?? []).find((x) => x.template_key === key);
    if (!t) {
      setForm((f) => ({ ...f, templateKey: "" }));
      return;
    }
    const app = candidateApplications.find((a) => a.id === form.applicationId) ?? candidateApplications[0];
    const vacancy = app ? (vacancies.data ?? []).find((v) => v.id === app.vacancy_id) : undefined;
    const context: Record<string, string> = {
      candidate_name: selected?.full_name ?? "",
      first_name: (selected?.full_name ?? "").split(" ")[0] ?? "",
      vacancy_title: vacancy?.title ?? "",
      stage: app ? STAGE_LABEL[app.stage] ?? app.stage : "",
      company: "SAFARID",
    };
    setForm((f) => ({
      ...f,
      templateKey: key,
      subject: rec.renderTemplate(t.subject, context),
      body: rec.renderTemplate(t.body, context),
    }));
  };

  const send = useMutation({
    mutationFn: () => {
      if (!candidateId) throw new Error("Select a candidate first.");
      if (!form.body.trim()) throw new Error("Write the message before logging it.");
      return rec.logCommunication({
        candidate_id: candidateId,
        application_id: form.applicationId || null,
        channel: form.channel,
        subject: form.subject.trim() || null,
        body: form.body.trim(),
        template_key: form.templateKey || null,
      });
    },
    onSuccess: () => {
      toast.success("Communication recorded against the candidate.");
      setForm({ applicationId: "", channel: "email", templateKey: "", subject: "", body: "" });
      qc.invalidateQueries({ queryKey: ["rec"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Communications"
        lede="Recruitment messages tied to the candidate, the application event they relate to, and the approved template used."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Candidate</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="comm-candidate">Choose a candidate</Label>
              <select
                id="comm-candidate"
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={candidateId}
                onChange={(e) => setParams(e.target.value ? { candidate: e.target.value } : {}, { replace: true })}
              >
                <option value="">Select…</option>
                {(candidates.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>
            {selected && (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">{selected.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {selected.email ?? "no email"} · {selected.phone ?? "no phone"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Consent {selected.consent_given ? "given" : "not recorded"} ·{" "}
                  {selected.last_contact_at
                    ? `last contacted ${new Date(selected.last_contact_at).toLocaleDateString()}`
                    : "never contacted"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Compose and log</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="comm-channel">Channel</Label>
                <select
                  id="comm-channel"
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.channel}
                  onChange={(e) => setForm({ ...form, channel: e.target.value })}
                >
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="call">Call note</option>
                </select>
              </div>
              <div>
                <Label htmlFor="comm-application">Related application</Label>
                <select
                  id="comm-application"
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.applicationId}
                  onChange={(e) => setForm({ ...form, applicationId: e.target.value })}
                >
                  <option value="">None</option>
                  {candidateApplications.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.application_no} · {STAGE_LABEL[a.stage] ?? a.stage}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="comm-template">Template</Label>
                <select
                  id="comm-template"
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.templateKey}
                  onChange={(e) => applyTemplate(e.target.value)}
                >
                  <option value="">No template</option>
                  {(templates.data ?? []).filter((t) => t.is_active).map((t) => (
                    <option key={t.id} value={t.template_key}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="comm-subject">Subject</Label>
              <Input id="comm-subject" value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="comm-body">Message</Label>
              <Textarea id="comm-body" rows={7} value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>
            <Button onClick={() => send.mutate()} disabled={send.isPending || !candidateId}>
              <Send className="mr-1 h-4 w-4" aria-hidden="true" />
              {send.isPending ? "Recording…" : "Record communication"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">
            {selected ? `Communication history — ${selected.full_name}` : "Recent communications"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {comms.isLoading ? (
            <div className="space-y-3 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : timeline.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No communications recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {timeline.slice(0, 40).map((c) => {
                const Icon = CHANNEL_ICON[c.channel] ?? Mail;
                return (
                  <li key={c.id} className="flex items-start gap-3 p-4">
                    <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {c.subject || `${titleise(c.channel)} ${c.direction}`}
                        </p>
                        <Badge variant="outline" className="text-[10px]">{titleise(c.status)}</Badge>
                        {c.template_key && <Badge variant="outline" className="text-[10px]">{c.template_key}</Badge>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.body}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {candidate(c.candidate_id)?.full_name ?? "Candidate"} ·{" "}
                        {new Date(c.sent_at ?? c.created_at).toLocaleString()}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
