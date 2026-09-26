import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Mail, Inbox, Search, Trash2, ShieldAlert, CheckCircle2, AlertTriangle, Save, Eye, Download, History, Send } from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";
import { AnalyticsEvents } from "@/lib/analyticsEvents";
import { auditedExport } from "@/lib/exportAudit";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatDistanceToNow } from "date-fns";

type Submission = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  type: string;
  subject: string | null;
  message: string;
  source_page: string | null;
  employee_count: string | null;
  status: string;
  spam_score: number;
  is_spam: boolean;
  ip_address: string | null;
  created_at: string;
  notes: string | null;
};

type Settings = {
  id?: string;
  contact_inbox: string | null;
  demo_inbox: string | null;
  support_inbox: string | null;
  sales_inbox: string | null;
  hr_inbox: string | null;
  send_user_confirmation: boolean;
};


const STATUSES = ["new", "in_progress", "resolved", "archived", "spam"] as const;

const statusVariant = (s: string) => {
  switch (s) {
    case "new": return "default";
    case "in_progress": return "secondary";
    case "resolved": return "outline";
    case "spam": return "destructive";
    default: return "outline";
  }
};

type AuditRow = {
  id: string;
  submission_id: string | null;
  action: string;
  old_status: string | null;
  new_status: string | null;
  old_is_spam: boolean | null;
  new_is_spam: boolean | null;
  actor_email: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export default function ContactSubmissions() {
  const [rows, setRows] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<string>("all");
  const [open, setOpen] = useState<Submission | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [settings, setSettings] = useState<Settings>({
    contact_inbox: "", demo_inbox: "", support_inbox: "", sales_inbox: "", hr_inbox: "",
    send_user_confirmation: true,
  });

  const [savingSettings, setSavingSettings] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<unknown>(null);
  const [testRuns, setTestRuns] = useState<Array<{
    id: string; created_at: string; recipient_email: string | null; template_name: string | null;
    delivery_status: string; error_message: string | null; duration_ms: number | null;
    edge_response: unknown; rendered_html: string | null; payload: unknown;
  }>>([]);
  const [openRun, setOpenRun] = useState<typeof testRuns[number] | null>(null);
  const [testForm, setTestForm] = useState({
    name: "Admin Test", email: "test@example.com", type: "contact",
    subject: "Admin test submission", message: "This is a test submission triggered from the admin tool.",
  });

  const loadTestRuns = async () => {
    const { data } = await supabase
      .from("admin_email_test_runs")
      .select("id,created_at,recipient_email,template_name,delivery_status,error_message,duration_ms,edge_response,rendered_html,payload")
      .order("created_at", { ascending: false })
      .limit(50);
    setTestRuns((data as never) ?? []);
  };

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("contact_submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    setRows((data as Submission[]) ?? []);
    setLoading(false);
  };

  const loadSettings = async () => {
    const { data } = await supabase
      .from("notification_settings")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) setSettings(data as Settings);
  };

  useEffect(() => { load(); loadSettings(); loadAudit(); loadTestRuns(); }, []);

  const filtered = useMemo(() => {
    let r = rows;
    if (tab !== "all") r = r.filter((x) => x.status === tab);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((x) =>
        [x.name, x.email, x.company, x.subject, x.message, x.source_page]
          .filter(Boolean).some((v) => v!.toLowerCase().includes(q)),
      );
    }
    return r;
  }, [rows, tab, search]);

  const counts = useMemo(() => ({
    all: rows.length,
    new: rows.filter((r) => r.status === "new").length,
    in_progress: rows.filter((r) => r.status === "in_progress").length,
    resolved: rows.filter((r) => r.status === "resolved").length,
    spam: rows.filter((r) => r.status === "spam" || r.is_spam).length,
  }), [rows]);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("contact_submissions").update({ status }).eq("id", id);
    if (error) return toast({ title: "Update failed", variant: "destructive" });
    setRows((r) => r.map((x) => (x.id === id ? { ...x, status } : x)));
    if (open?.id === id) setOpen({ ...open, status });
    toast({ title: "Status updated" });
    setTimeout(() => loadAudit(), 300);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this submission permanently?")) return;
    const { error } = await supabase.from("contact_submissions").delete().eq("id", id);
    if (error) return toast({ title: "Delete failed", variant: "destructive" });
    setRows((r) => r.filter((x) => x.id !== id));
    setOpen(null);
    toast({ title: "Deleted" });
    setTimeout(() => loadAudit(), 300);
  };

  const markSpam = async (id: string, spam: boolean) => {
    const { error } = await supabase
      .from("contact_submissions")
      .update({ is_spam: spam, status: spam ? "spam" : "new" })
      .eq("id", id);
    if (error) return toast({ title: "Update failed", variant: "destructive" });
    setRows((r) => r.map((x) => (x.id === id ? { ...x, is_spam: spam, status: spam ? "spam" : "new" } : x)));
    toast({ title: spam ? "Flagged as spam" : "Restored from spam" });
    setTimeout(() => loadAudit(), 300);
  };

  const loadAudit = async (submissionId?: string) => {
    const q = supabase.from("contact_audit_log").select("*").order("created_at", { ascending: false }).limit(200);
    const { data } = submissionId ? await q.eq("submission_id", submissionId) : await q;
    setAudit((data as AuditRow[]) ?? []);
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    const payload = {
      contact_inbox: settings.contact_inbox?.trim() || null,
      demo_inbox: settings.demo_inbox?.trim() || null,
      support_inbox: settings.support_inbox?.trim() || null,
      sales_inbox: settings.sales_inbox?.trim() || null,
      hr_inbox: settings.hr_inbox?.trim() || null,

      send_user_confirmation: settings.send_user_confirmation,
    };
    const q = settings.id
      ? supabase.from("notification_settings").update(payload).eq("id", settings.id)
      : supabase.from("notification_settings").insert(payload);
    const { error } = await q;
    setSavingSettings(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    toast({ title: "Notification inboxes saved" });
    loadSettings();
  };

  const exportCsv = () =>
    auditedExport(
      { dataset: "marketing.contact_submissions", exportType: "csv", rowCount: filtered.length, filters: { search } },
      () => {
        const escape = (v: unknown) => {
          const s = v === null || v === undefined ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const headers = ["created_at","status","is_spam","spam_score","type","name","email","company","phone","subject","message","source_page","employee_count","ip_address"];
        const lines = [headers.join(",")];
        for (const r of filtered) {
          lines.push(headers.map((h) => escape((r as unknown as Record<string, unknown>)[h])).join(","));
        }
        const csv = lines.join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `contact-submissions-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: `Exported ${filtered.length} rows` });
        return csv;
      },
    );

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    const started = performance.now();
    const payload = { ...testForm, source_page: "admin-test", elapsed_ms: 5000 };
    let edgeResponse: unknown = null;
    let errorMessage: string | null = null;
    let deliveryStatus = "pending";
    let renderedHtml: string | null = null;
    let messageId: string | null = null;
    try {
      const { data, error } = await supabase.functions.invoke("contact-submission", {
        body: payload,
        headers: { "x-test-mode": "1" },
      });
      if (error) throw error;
      edgeResponse = data;
      const d = (data ?? {}) as Record<string, unknown>;
      renderedHtml = (d.rendered_html as string) ?? (d.html as string) ?? null;
      deliveryStatus = (d.delivery_status as string) ?? (d.email_status as string) ?? "sent";
      messageId = (d.message_id as string) ?? null;
      setTestResult(data);
      toast({ title: "Test submission delivered" });
      load();
    } catch (e) {
      errorMessage = (e as Error).message;
      deliveryStatus = "failed";
      setTestResult({ error: errorMessage });
      toast({ title: "Test failed", description: errorMessage, variant: "destructive" });
    } finally {
      const duration_ms = Math.round(performance.now() - started);
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("admin_email_test_runs").insert({
        triggered_by: userData.user?.id ?? null,
        triggered_by_email: userData.user?.email ?? null,
        template_name: testForm.type === "demo" ? "contact-internal-notification" : "contact-confirmation",
        recipient_email: testForm.email,
        subject: testForm.subject,
        payload,
        edge_response: edgeResponse as never,
        rendered_html: renderedHtml,
        delivery_status: deliveryStatus,
        delivery_message_id: messageId,
        error_message: errorMessage,
        duration_ms,
      });
      loadTestRuns();
      setTesting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Contact submissions</h1>
          <p className="text-muted-foreground">Triage and respond to enquiries from the public site.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={load}>Refresh</Button>
          <AppButton variant="outline" analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
            aria-label="Export contact submissions to CSV" onClick={exportCsv}
            trackingMeta={{ dataset: "marketing.contact_submissions", export_type: "csv" }}>
            <Download className="h-4 w-4 mr-2" />Export CSV
          </AppButton>
          <Dialog open={testOpen} onOpenChange={setTestOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Send className="h-4 w-4 mr-2" />Send test</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader><DialogTitle>Send a test contact submission</DialogTitle></DialogHeader>
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground text-xs">
                  Runs the public edge function end-to-end, bypassing rate limits. Verifies template rendering, inbox routing, and audit logging.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Name</Label><Input value={testForm.name} onChange={(e) => setTestForm({ ...testForm, name: e.target.value })} /></div>
                  <div><Label>Email</Label><Input type="email" value={testForm.email} onChange={(e) => setTestForm({ ...testForm, email: e.target.value })} /></div>
                  <div><Label>Type</Label>
                    <Select value={testForm.type} onValueChange={(v) => setTestForm({ ...testForm, type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["contact","demo","sales","support","partner"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Subject</Label><Input value={testForm.subject} onChange={(e) => setTestForm({ ...testForm, subject: e.target.value })} /></div>
                </div>
                <div><Label>Message</Label>
                  <Textarea rows={4} value={testForm.message} onChange={(e) => setTestForm({ ...testForm, message: e.target.value })} />
                </div>
                <Button onClick={runTest} disabled={testing}>{testing ? "Sending…" : "Send test"}</Button>
                {testResult != null && (
                  <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs overflow-auto max-h-64">
                    {JSON.stringify(testResult, null, 2)}
                  </pre>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { k: "all", l: "Total", v: counts.all, i: Inbox },
          { k: "new", l: "New", v: counts.new, i: Mail },
          { k: "in_progress", l: "In progress", v: counts.in_progress, i: AlertTriangle },
          { k: "resolved", l: "Resolved", v: counts.resolved, i: CheckCircle2 },
          { k: "spam", l: "Spam", v: counts.spam, i: ShieldAlert },
        ].map((x) => (
          <Card key={x.k} className={tab === x.k ? "border-primary" : "cursor-pointer"} onClick={() => setTab(x.k)}>
            <CardContent className="p-4 flex items-center gap-3">
              <x.i className="h-5 w-5 text-primary" />
              <div>
                <div className="text-2xl font-bold">{x.v}</div>
                <div className="text-xs text-muted-foreground">{x.l}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Notification inbox "cupholder" — where notifications get delivered */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Notification inboxes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Add the email addresses that should receive notifications. Submissions are still saved here even if delivery is paused.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="contact_inbox">General contact inbox</Label>
              <Input id="contact_inbox" type="email" placeholder="support@yalla.africa"
                value={settings.contact_inbox ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, contact_inbox: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="support_inbox">Support inbox</Label>
              <Input id="support_inbox" type="email" placeholder="support@yalla.africa"
                value={settings.support_inbox ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, support_inbox: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="sales_inbox">Sales / commercial inbox</Label>
              <Input id="sales_inbox" type="email" placeholder="sales@yalla.africa"
                value={settings.sales_inbox ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, sales_inbox: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="demo_inbox">Demo inbox (legacy fallback)</Label>
              <Input id="demo_inbox" type="email" placeholder="sales@yalla.africa"
                value={settings.demo_inbox ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, demo_inbox: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="hr_inbox">Recruitment inbox</Label>
              <Input id="hr_inbox" type="email" placeholder="hr@yalla.africa"
                value={settings.hr_inbox ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, hr_inbox: e.target.value }))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Routing is decided server-side from the enquiry category: support and general go to the support inbox,
            corporate/partnership/fleet/travel go to the sales inbox, recruitment goes to the recruitment inbox.
          </p>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <div className="text-sm font-medium">Send confirmation to the submitter</div>
              <div className="text-xs text-muted-foreground">An automatic "we got your message" reply.</div>
            </div>
            <Switch
              checked={settings.send_user_confirmation}
              onCheckedChange={(v) => setSettings((s) => ({ ...s, send_user_confirmation: v }))}
            />
          </div>
          <Button onClick={saveSettings} disabled={savingSettings}>
            <Save className="h-4 w-4 mr-2" />{savingSettings ? "Saving…" : "Save inboxes"}
          </Button>
        </CardContent>
      </Card>

      {/* Search + tabs */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name, email, company, message…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="new">New</TabsTrigger>
            <TabsTrigger value="in_progress">Active</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
            <TabsTrigger value="spam">Spam</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-3">When</th>
                  <th className="p-3">From</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Message</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No submissions match.</td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                    <td className="p-3 whitespace-nowrap text-muted-foreground">
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.email}{r.company ? ` · ${r.company}` : ""}</div>
                    </td>
                    <td className="p-3"><Badge variant="outline">{r.type}</Badge></td>
                    <td className="p-3 text-xs text-muted-foreground">{r.source_page ?? "—"}</td>
                    <td className="p-3 max-w-sm truncate">{r.message}</td>
                    <td className="p-3">
                      <Badge variant={statusVariant(r.status) as never}>{r.status}</Badge>
                      {r.is_spam && r.status !== "spam" && (
                        <Badge variant="destructive" className="ml-1">spam</Badge>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <Sheet open={open?.id === r.id} onOpenChange={(o) => setOpen(o ? r : null)}>
                        <SheetTrigger asChild>
                          <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
                        </SheetTrigger>
                        <SheetContent className="sm:max-w-lg overflow-y-auto">
                          {open && (
                            <>
                              <SheetHeader>
                                <SheetTitle>{open.name}</SheetTitle>
                              </SheetHeader>
                              <div className="space-y-4 mt-4 text-sm">
                                <div className="grid grid-cols-2 gap-3">
                                  <div><Label>Email</Label><div>{open.email}</div></div>
                                  <div><Label>Type</Label><div>{open.type}</div></div>
                                  <div><Label>Company</Label><div>{open.company ?? "—"}</div></div>
                                  <div><Label>Phone</Label><div>{open.phone ?? "—"}</div></div>
                                  <div><Label>Employees</Label><div>{open.employee_count ?? "—"}</div></div>
                                  <div><Label>Source</Label><div className="break-all">{open.source_page ?? "—"}</div></div>
                                  <div><Label>IP</Label><div className="font-mono text-xs">{open.ip_address ?? "—"}</div></div>
                                  <div><Label>Spam score</Label><div>{open.spam_score}</div></div>
                                </div>
                                <div>
                                  <Label>Subject</Label>
                                  <div>{open.subject ?? "—"}</div>
                                </div>
                                <div>
                                  <Label>Message</Label>
                                  <div className="rounded-md border border-border bg-muted/30 p-3 whitespace-pre-wrap">
                                    {open.message}
                                  </div>
                                </div>
                                <div>
                                  <Label>Status</Label>
                                  <Select value={open.status} onValueChange={(v) => updateStatus(open.id, v)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="flex gap-2 flex-wrap pt-2">
                                  <Button asChild size="sm">
                                    <a href={`mailto:${open.email}?subject=Re: ${encodeURIComponent(open.subject ?? "Your message")}`}>
                                      <Mail className="h-4 w-4 mr-2" />Reply
                                    </a>
                                  </Button>
                                  {open.is_spam ? (
                                    <Button size="sm" variant="outline" onClick={() => markSpam(open.id, false)}>
                                      Not spam
                                    </Button>
                                  ) : (
                                    <Button size="sm" variant="outline" onClick={() => markSpam(open.id, true)}>
                                      <ShieldAlert className="h-4 w-4 mr-2" />Mark spam
                                    </Button>
                                  )}
                                  <Button size="sm" variant="destructive" onClick={() => remove(open.id)}>
                                    <Trash2 className="h-4 w-4 mr-2" />Delete
                                  </Button>
                                </div>
                              </div>
                            </>
                          )}
                        </SheetContent>
                      </Sheet>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Audit log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Audit log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-3">When</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Change</th>
                  <th className="p-3">Actor</th>
                  <th className="p-3">Submission</th>
                </tr>
              </thead>
              <tbody>
                {audit.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No audit entries yet.</td></tr>
                ) : audit.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                    </td>
                    <td className="p-3"><Badge variant="outline">{a.action}</Badge></td>
                    <td className="p-3 text-xs">
                      {a.action === "status_change" && <span>{a.old_status ?? "—"} → <strong>{a.new_status}</strong></span>}
                      {a.action === "spam_flag" && <span>spam: {String(a.old_is_spam)} → <strong>{String(a.new_is_spam)}</strong></span>}
                      {a.action === "delete" && <span className="text-destructive">deleted (was {a.old_status})</span>}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{a.actor_email ?? "system"}</td>
                    <td className="p-3 text-xs font-mono text-muted-foreground">{a.submission_id?.slice(0, 8) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Email test runs audit */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" />Email test runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-3">When</th>
                  <th className="p-3">Recipient</th>
                  <th className="p-3">Template</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Duration</th>
                  <th className="p-3 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody>
                {testRuns.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No test runs yet — click "Send test" above.</td></tr>
                ) : testRuns.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}</td>
                    <td className="p-3">{t.recipient_email ?? "—"}</td>
                    <td className="p-3 text-xs">{t.template_name ?? "—"}</td>
                    <td className="p-3">
                      <Badge variant={t.delivery_status === "sent" ? "default" : t.delivery_status === "failed" ? "destructive" : "secondary"}>
                        {t.delivery_status}
                      </Badge>
                      {t.error_message && <div className="text-xs text-destructive mt-1 max-w-xs truncate">{t.error_message}</div>}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{t.duration_ms ? `${t.duration_ms} ms` : "—"}</td>
                    <td className="p-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setOpenRun(t)}><Eye className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!openRun} onOpenChange={(o) => !o && setOpenRun(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Test run details</DialogTitle></DialogHeader>
          {openRun && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><Label>Recipient</Label><div>{openRun.recipient_email}</div></div>
                <div><Label>Template</Label><div>{openRun.template_name}</div></div>
                <div><Label>Status</Label><div><Badge>{openRun.delivery_status}</Badge></div></div>
                <div><Label>Duration</Label><div>{openRun.duration_ms} ms</div></div>
              </div>
              {openRun.error_message && (
                <div>
                  <Label>Error</Label>
                  <pre className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs whitespace-pre-wrap">{openRun.error_message}</pre>
                </div>
              )}
              <div>
                <Label>Edge function response</Label>
                <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs overflow-auto max-h-60">{JSON.stringify(openRun.edge_response, null, 2)}</pre>
              </div>
              <div>
                <Label>Payload sent</Label>
                <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs overflow-auto max-h-40">{JSON.stringify(openRun.payload, null, 2)}</pre>
              </div>
              {openRun.rendered_html && (
                <div>
                  <Label>Rendered template HTML</Label>
                  <iframe
                    title="Rendered email"
                    srcDoc={openRun.rendered_html}
                    className="w-full h-80 rounded-md border border-border bg-ice"
                  />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
