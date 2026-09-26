/**
 * Email Delivery Operations — admin console for the outbound mail spine.
 *
 * Three surfaces:
 *  1. Delivery log — queued / sent / failed with provider and provider message
 *     id, searchable by recipient and filterable by route and status.
 *  2. Dead letters — sends that exhausted the exponential backoff budget, with
 *     one-click re-queue (server-side role check is authoritative).
 *  3. Templates — versioned subject/body content for user confirmations and
 *     staff credential emails, with live preview before activation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Mail, RefreshCw, RotateCcw, Search, Send } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AppButton } from "@/components/nav/AppButton";
import DeliverabilityPanel from "@/components/admin/email/DeliverabilityPanel";
import {
  activateTemplateVersion, createTemplateVersion, fetchDeadLetters, fetchDeliveryLog,
  fetchTemplateVersions, fetchTemplates, mergeTokens, PREVIEW_DATA, reprocessDeadLetter,
  STATUS_TONE,
  type DeadLetterRow, type DeliveryRow, type TemplateRow, type TemplateVersionRow,
} from "@/lib/email/deliveryOps";

const STATUSES = ["all", "pending", "sent", "failed", "rate_limited", "dlq", "suppressed"];

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={STATUS_TONE[status] ?? "bg-muted text-muted-foreground"} variant="secondary">
      {status}
    </Badge>
  );
}

/* ------------------------------- Delivery log ------------------------------ */

function DeliveryLogPanel() {
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  const [recipient, setRecipient] = useState("");
  const [route, setRoute] = useState("all");
  const [status, setStatus] = useState("all");
  const [sinceDays, setSinceDays] = useState(7);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDeliveryLog({
        recipient,
        route: route === "all" ? undefined : route,
        status,
        sinceDays,
      });
      setRows(data);
    } catch (e) {
      toast.error(`Could not load delivery log: ${(e as Error).message}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [recipient, route, status, sinceDays]);

  useEffect(() => { void load(); }, [load]);

  const routes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) if (r.route ?? r.template_name) set.add((r.route ?? r.template_name)!);
    return [...set].sort();
  }, [rows]);

  const stats = useMemo(() => {
    const base = { total: 0, sent: 0, queued: 0, failed: 0 };
    for (const r of rows ?? []) {
      base.total++;
      if (r.status === "sent") base.sent++;
      else if (r.status === "pending") base.queued++;
      else if (["failed", "dlq", "rate_limited", "bounced"].includes(r.status)) base.failed++;
    }
    return base;
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Emails", value: stats.total },
          { label: "Sent", value: stats.sent },
          { label: "Queued", value: stats.queued },
          { label: "Failed", value: stats.failed },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-4">
          <div className="grid gap-3 sm:grid-cols-4 flex-1">
            <div>
              <Label htmlFor="recipient-search">Recipient</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="recipient-search"
                  className="pl-8"
                  placeholder="name@company.co.ke"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="route-filter">Route</Label>
              <Select value={route} onValueChange={setRoute}>
                <SelectTrigger id="route-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All routes</SelectItem>
                  {routes.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="status-filter">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="range-filter">Range</Label>
              <Select value={String(sinceDays)} onValueChange={(v) => setSinceDays(Number(v))}>
                <SelectTrigger id="range-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Last 24 hours</SelectItem>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <AppButton variant="outline" onClick={() => void load()} analytics="email_ops_refresh_delivery_log" action="noop" aria-label="Refresh delivery log">
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Refresh
          </AppButton>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (rows ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No emails match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sent at</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempt</TableHead>
                    <TableHead>Provider id</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rows ?? []).slice(0, 200).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-sm">{when(r.created_at)}</TableCell>
                      <TableCell className="text-sm">
                        {r.recipient_email}
                        {r.subject && <span className="block text-xs text-muted-foreground">{r.subject}</span>}
                      </TableCell>
                      <TableCell className="text-sm">{r.route ?? r.template_name}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                        {r.error_message && (
                          <span className="block max-w-[22rem] truncate text-xs text-muted-foreground">
                            {r.error_message}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.attempt ?? 1}
                        {r.next_attempt_at && r.status === "failed" && (
                          <span className="block text-xs text-muted-foreground">
                            retry {when(r.next_attempt_at)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.provider_message_id ?? "—"}
                        <span className="block text-muted-foreground">{r.provider ?? "—"}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------- Dead letters ----------------------------- */

function DeadLetterPanel() {
  const [rows, setRows] = useState<DeadLetterRow[] | null>(null);
  const [includeDone, setIncludeDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchDeadLetters(includeDone));
    } catch (e) {
      toast.error(`Could not load dead letters: ${(e as Error).message}`);
      setRows([]);
    }
  }, [includeDone]);

  useEffect(() => { void load(); }, [load]);

  const reprocess = async (id: string) => {
    setBusy(id);
    try {
      await reprocessDeadLetter(id);
      toast.success("Email re-queued — the dispatcher will retry it within a minute.");
      await load();
    } catch (e) {
      toast.error(`Re-queue refused: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
        <div>
          <CardTitle>Dead letter queue</CardTitle>
          <CardDescription>
            Sends that exhausted the retry budget (30s → 15m exponential backoff, 5 attempts) or
            expired. Re-queue after fixing the cause.
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="include-done" checked={includeDone} onCheckedChange={setIncludeDone} />
            <Label htmlFor="include-done" className="text-sm">Show re-queued</Label>
          </div>
          <AppButton variant="outline" onClick={() => void load()} analytics="email_ops_refresh_dead_letters" action="noop" aria-label="Refresh dead letters">
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Refresh
          </AppButton>
        </div>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dead-lettered emails. Delivery is healthy.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Failed at</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-sm">{when(r.created_at)}</TableCell>
                    <TableCell className="text-sm">{r.recipient_email ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.route ?? r.template_name ?? r.queue}</TableCell>
                    <TableCell className="max-w-[24rem] text-xs text-muted-foreground">{r.reason}</TableCell>
                    <TableCell className="text-sm">{r.attempts}</TableCell>
                    <TableCell className="text-right">
                      {r.status === "reprocessed" ? (
                        <Badge variant="secondary" className="bg-success/10 text-success">re-queued</Badge>
                      ) : (
                        <AppButton
                          size="sm"
                          variant="outline"
                          disabled={busy === r.id}
                          onClick={() => void reprocess(r.id)}
                          analytics="email_ops_action" action="noop" aria-label={`Re-queue email to ${r.recipient_email ?? "recipient"}`}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Re-queue
                        </AppButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------------- Templates ------------------------------- */

function TemplatePanel() {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [versions, setVersions] = useState<TemplateVersionRow[]>([]);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const loadTemplates = useCallback(async () => {
    try {
      const list = await fetchTemplates();
      setTemplates(list);
      setSelected((cur) => cur ?? list[0]?.name ?? null);
    } catch (e) {
      toast.error(`Could not load templates: ${(e as Error).message}`);
      setTemplates([]);
    }
  }, []);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  useEffect(() => {
    if (!selected) return;
    void (async () => {
      const list = await fetchTemplateVersions(selected);
      setVersions(list);
      const active = list.find((v) => v.version === templates?.find((t) => t.name === selected)?.active_version);
      const seed = active ?? list[0];
      setSubject(seed?.subject ?? "");
      setHtml(seed?.html_body ?? "");
      setNotes("");
    })();
  }, [selected, templates]);

  const current = templates?.find((t) => t.name === selected) ?? null;
  const previewData = (selected && PREVIEW_DATA[selected]) || {};
  const previewHtml = useMemo(() => mergeTokens(html, previewData), [html, previewData]);
  const previewSubject = useMemo(() => mergeTokens(subject, previewData, false), [subject, previewData]);

  const save = async (activate: boolean) => {
    if (!selected || !subject.trim() || !html.trim()) {
      toast.error("Subject and HTML body are required.");
      return;
    }
    setSaving(true);
    try {
      const version = await createTemplateVersion({
        templateName: selected,
        subject,
        htmlBody: html,
        notes: notes || null,
        activate,
      });
      toast.success(activate ? `Version ${version} saved and live.` : `Version ${version} saved as draft.`);
      await loadTemplates();
      setVersions(await fetchTemplateVersions(selected));
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const applyBuiltInTemplate = async () => {
    if (!selected) return;
    try {
      await activateTemplateVersion(selected, null);
      toast.success("Reverted to the built-in template.");
      await loadTemplates();
    } catch (e) {
      toast.error(`Could not revert: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Template</CardTitle>
          <CardDescription>
            An active version overrides the built-in template for every send of that route. Versions are
            immutable — saving always creates the next version.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="template-select">Managed template</Label>
              <Select value={selected ?? ""} onValueChange={setSelected}>
                <SelectTrigger id="template-select"><SelectValue placeholder="Select a template" /></SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map((t) => (
                    <SelectItem key={t.name} value={t.name}>{t.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {current?.description && (
                <p className="mt-2 text-xs text-muted-foreground">{current.description}</p>
              )}
            </div>
            <div className="text-sm">
              <Label>Live version</Label>
              <p className="mt-2">
                {current?.active_version
                  ? <Badge variant="secondary" className="bg-success/10 text-success">v{current.active_version} active</Badge>
                  : <Badge variant="secondary">Built-in template</Badge>}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Available tokens: {Object.keys(previewData).map((k) => `{{${k}}}`).join(" ") || "none"}
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="template-subject">Subject</Label>
            <Input id="template-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="template-html">HTML body</Label>
            <Textarea
              id="template-html"
              rows={12}
              className="font-mono text-xs"
              value={html}
              onChange={(e) => setHtml(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="template-notes">Change note</Label>
            <Input
              id="template-notes"
              placeholder="Why this version exists"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <AppButton onClick={() => void save(true)} disabled={saving} analytics="email_ops_save_template_version_and_make_it_live" action="noop" aria-label="Save template version and make it live">
              <Send className="mr-2 h-4 w-4" aria-hidden="true" /> Save &amp; activate
            </AppButton>
            <AppButton variant="outline" onClick={() => void save(false)} disabled={saving} analytics="email_ops_save_template_version_as_draft" action="noop" aria-label="Save template version as draft">
              Save draft
            </AppButton>
            <AppButton variant="ghost" onClick={() => void applyBuiltInTemplate()} analytics="email_ops_revert_to_the_built_in_template" action="noop" aria-label="Revert to the built-in template">
              Use built-in template
            </AppButton>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>Rendered with sample data: {previewSubject || "(no subject)"}</CardDescription>
        </CardHeader>
        <CardContent>
          <iframe
            title="Email preview"
            className="h-96 w-full rounded-lg border border-border bg-background"
            sandbox=""
            srcDoc={previewHtml}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Version history</CardTitle></CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stored versions yet — the built-in template is in use.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      v{v.version}
                      {current?.active_version === v.version && (
                        <Badge variant="secondary" className="ml-2 bg-success/10 text-success">live</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{v.subject}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{v.notes ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{when(v.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <AppButton
                          size="sm"
                          variant="ghost"
                          analytics="email_ops_action" action="noop" aria-label={`Load version ${v.version} into the editor`}
                          onClick={() => { setSubject(v.subject); setHtml(v.html_body); }}
                        >
                          Load
                        </AppButton>
                        {current?.active_version !== v.version && (
                          <AppButton
                            size="sm"
                            variant="outline"
                            analytics="email_ops_action" action="noop" aria-label={`Activate version ${v.version}`}
                            onClick={async () => {
                              await activateTemplateVersion(v.template_name, v.version);
                              toast.success(`Version ${v.version} is now live.`);
                              await loadTemplates();
                            }}
                          >
                            Activate
                          </AppButton>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------------------------- Page ---------------------------------- */

export default function EmailDelivery() {
  return (
    <main className="container mx-auto space-y-6 px-4 py-8">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-bold">Email delivery operations</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Every outbound email delivered through SMTP2GO: delivery state, retries, dead letters and
          the versioned templates behind confirmations and staff credentials.
        </p>
      </header>

      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log">Delivery log</TabsTrigger>
          <TabsTrigger value="dlq">Dead letters</TabsTrigger>
          <TabsTrigger value="deliverability">Deliverability</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>
        <TabsContent value="log" className="pt-6"><DeliveryLogPanel /></TabsContent>
        <TabsContent value="dlq" className="pt-6"><DeadLetterPanel /></TabsContent>
        <TabsContent value="deliverability" className="pt-6"><DeliverabilityPanel /></TabsContent>
        <TabsContent value="templates" className="pt-6"><TemplatePanel /></TabsContent>
      </Tabs>
    </main>
  );
}
