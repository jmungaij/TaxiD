import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FlightHubPage, HubSection } from "@/components/charter/FlightHubPage";
import { useFlightHub } from "@/lib/charter/useFlightHub";
import { buildOperators, money } from "@/lib/charter/flightHub";
import { toast } from "@/hooks/use-toast";
import { ACCEPTED_EVIDENCE } from "@/lib/charter/evidence";
import {
  applicationReadiness, listAllPartnerEvents, listPartnerApplications, listPartnerEvents, PARTNER_STATUSES,
  PARTNER_STATUS_LABELS, REQUIRED_PARTNER_DOCS, reviewPartnerApplication, submitPartnerApplication,
  uploadPartnerDocument, validateApplication,
  type PartnerApplication, type PartnerDocument, type PartnerEvent, type PartnerStatus,
} from "@/lib/charter/partners";
import { downloadPartnerAuditCsv } from "@/lib/charter/partnerExport";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Upload, FileCheck2, History, Download } from "lucide-react";

const STAGES = [
  { key: "prospect", label: "Prospect", hint: "Identified operator, no contracted assets active." },
  { key: "documentation", label: "Documentation", hint: "AOC, insurance and airworthiness evidence in review." },
  { key: "activation", label: "Activation", hint: "Assets loaded, base assigned, awaiting first booking." },
  { key: "live", label: "Live", hint: "Trading on the marketplace with settled bookings." },
] as const;

const STAGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  live: "default", activation: "secondary", documentation: "outline", prospect: "outline",
};

const STATUS_VARIANT: Record<PartnerStatus, "default" | "secondary" | "outline" | "destructive"> = {
  approved: "default", under_review: "secondary", submitted: "outline",
  documents_required: "outline", rejected: "destructive",
};

const EMPTY_FORM = {
  operator_name: "", contact_name: "", contact_email: "", contact_phone: "",
  country: "Kenya", home_base: "", fleet_size: 1, aircraft_types: "",
  aoc_number: "", insurance_expiry: "", notes: "",
};

export default function PartnerOnboarding() {
  const { data, loading, error, reload } = useFlightHub();
  const operators = useMemo(() => buildOperators(data), [data]);
  const byStage = (k: string) => operators.filter((o) => o.stage === k);

  const [apps, setApps] = useState<PartnerApplication[]>([]);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [docs, setDocs] = useState<PartnerDocument[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [timelineFor, setTimelineFor] = useState<PartnerApplication | null>(null);
  const [events, setEvents] = useState<PartnerEvent[]>([]);

  const loadApps = useCallback(async () => {
    try { setApps(await listPartnerApplications()); setAppsError(null); }
    catch (e) { setAppsError(e instanceof Error ? e.message : "Failed to load applications"); }
  }, []);
  useEffect(() => { void loadApps(); }, [loadApps]);

  // In-app notifications: surface approve/reject decisions the moment the
  // audit trail records them (own decisions and those of other reviewers).
  useEffect(() => {
    const channel = supabase
      .channel("charter-partner-decisions")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "charter_partner_application_events" },
        (payload) => {
          const row = payload.new as Partial<PartnerEvent>;
          if (row.action !== "status_change") return;
          if (row.to_status !== "approved" && row.to_status !== "rejected") return;
          toast({
            title: `Partner application ${row.to_status}`,
            description: `${row.actor_email ?? "A reviewer"} recorded the decision${row.note ? ` — ${row.note}` : ""}.`,
            variant: row.to_status === "rejected" ? "destructive" : undefined,
          });
          void loadApps();
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadApps]);

  const exportAudit = async () => {
    setBusy("export");
    try {
      const [list, allEvents] = await Promise.all([listPartnerApplications(), listAllPartnerEvents()]);
      downloadPartnerAuditCsv(list, allEvents);
      toast({ title: "Audit export ready", description: `${allEvents.length} audit entries downloaded as CSV.` });
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const set = (k: keyof typeof EMPTY_FORM, v: string | number) => setForm((f) => ({ ...f, [k]: v }));


  const onUpload = async (key: string, label: string, file?: File | null) => {
    if (!file) return;
    setBusy(`doc:${key}`);
    try {
      const doc = await uploadPartnerDocument(file, key, label);
      setDocs((d) => [...d.filter((x) => x.key !== key), doc]);
      toast({ title: "Document attached", description: label });
    } catch (e) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const onSubmit = async () => {
    const payload = { ...form, fleet_size: Number(form.fleet_size) || 0, documents: docs };
    const invalid = validateApplication(payload);
    if (invalid) { toast({ title: "Check the form", description: invalid, variant: "destructive" }); return; }
    setBusy("submit");
    try {
      await submitPartnerApplication(payload);
      setForm({ ...EMPTY_FORM }); setDocs([]);
      toast({ title: "Application submitted", description: "Our aviation team will review your documents." });
      await loadApps();
    } catch (e) {
      toast({ title: "Submission failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const decide = async (app: PartnerApplication, next: PartnerStatus) => {
    setBusy(`review:${app.id}`);
    try {
      const updated = await reviewPartnerApplication(app, next);
      setApps((list) => list.map((a) => (a.id === updated.id ? updated : a)));
      toast({ title: `Marked ${PARTNER_STATUS_LABELS[next]}`, description: app.operator_name });
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const openTimeline = async (app: PartnerApplication) => {
    setTimelineFor(app); setEvents([]);
    try { setEvents(await listPartnerEvents(app.id)); } catch { /* surfaced as empty */ }
  };

  const pending = apps.filter((a) => !["approved", "rejected"].includes(a.status)).length;

  return (
    <FlightHubPage
      eyebrow="Flight Hub · Partners"
      title="Flight Partner Onboarding"
      subtitle="Operator readiness pipeline — from first contact to a fully contracted, revenue-generating fleet partner."
      loading={loading}
      error={error}
      onReload={() => { void reload(); void loadApps(); }}
      metrics={[
        { label: "Operators", value: String(operators.length) },
        { label: "Live partners", value: String(byStage("live").length) },
        { label: "Open applications", value: String(pending) },
        { label: "Contracted assets", value: String(data.inventory.length) },
      ]}
    >
      <Tabs defaultValue="pipeline" className="space-y-6">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="applications">Applications {apps.length > 0 && `(${apps.length})`}</TabsTrigger>
          <TabsTrigger value="apply">New submission</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-6">
          <HubSection title="Onboarding pipeline" description="Readiness is derived from asset activation, base assignment and booking history.">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {STAGES.map((s) => {
                const list = byStage(s.key);
                return (
                  <div key={s.key} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">{s.label}</h3>
                      <span className="text-lg font-bold tabular-nums">{list.length}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
                    <ul className="mt-3 space-y-1.5">
                      {list.slice(0, 4).map((o) => (
                        <li key={o.operator} className="truncate rounded-md bg-muted/60 px-2 py-1 text-xs">{o.operator}</li>
                      ))}
                      {list.length === 0 && <li className="text-xs text-muted-foreground">Empty</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
          </HubSection>

          <HubSection title="Operator register" description="Contracted capacity, coverage and commercial contribution per partner.">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operator</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Readiness</TableHead>
                    <TableHead className="text-right">Assets</TableHead>
                    <TableHead>Bases</TableHead>
                    <TableHead className="text-right">Bookings</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operators.map((o) => (
                    <TableRow key={o.operator} className="row-hover">
                      <TableCell className="font-medium">{o.operator}</TableCell>
                      <TableCell><Badge variant={STAGE_VARIANT[o.stage]}>{o.stage}</Badge></TableCell>
                      <TableCell className="w-40">
                        <div className="flex items-center gap-2">
                          <Progress value={o.readiness} className="h-2" />
                          <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{o.readiness}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{o.activeAssets}/{o.assets}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">{o.homeBases.join(", ") || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{o.bookings}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(o.revenue, o.currency)}</TableCell>
                    </TableRow>
                  ))}
                  {operators.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No operators registered yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </HubSection>
        </TabsContent>

        <TabsContent value="applications">
          <HubSection
            title="Partner applications"
            description="Submitted operator applications with document evidence and review decisions."
            actions={
              <Button data-analytics="partneronboarding.export" size="sm" variant="outline" className="gap-2" disabled={busy === "export"} onClick={() => void exportAudit()}>
                {busy === "export" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
                Export audit CSV
              </Button>
            }
          >
            {appsError && <p className="mb-3 text-sm text-status-danger">{appsError}</p>}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operator</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Base</TableHead>
                    <TableHead className="text-right">Fleet</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead>Readiness</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apps.map((a) => (
                    <TableRow key={a.id} className="row-hover">
                      <TableCell className="font-medium">{a.operator_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.contact_name}<br />{a.contact_email}</TableCell>
                      <TableCell className="text-sm">{a.home_base || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.fleet_size}</TableCell>
                      <TableCell className="text-sm tabular-nums">{a.documents?.length ?? 0}/{REQUIRED_PARTNER_DOCS.length}</TableCell>
                      <TableCell className="w-32">
                        <div className="flex items-center gap-2">
                          <Progress value={applicationReadiness(a)} className="h-2" />
                          <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{applicationReadiness(a)}%</span>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[a.status]}>{PARTNER_STATUS_LABELS[a.status]}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {PARTNER_STATUSES.filter((s) => s !== a.status && s !== "submitted").map((s) => (
                            <Button key={s} size="sm" variant="outline" disabled={busy === `review:${a.id}`} onClick={() => void decide(a, s)}>
                              {PARTNER_STATUS_LABELS[s]}
                            </Button>
                          ))}
                          <Button size="sm" variant="ghost" onClick={() => void openTimeline(a)} className="gap-1.5">
                            <History className="h-3.5 w-3.5" aria-hidden="true" /> Audit
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {apps.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">No applications submitted yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </HubSection>
        </TabsContent>

        <TabsContent value="apply">
          <HubSection title="Operator application" description="Submit operator details and airworthiness evidence to join the TaxiD Air marketplace.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field id="operator_name" label="Operator name" value={form.operator_name} onChange={(v) => set("operator_name", v)} />
              <Field id="home_base" label="Home base" value={form.home_base} onChange={(v) => set("home_base", v)} />
              <Field id="contact_name" label="Contact name" value={form.contact_name} onChange={(v) => set("contact_name", v)} />
              <Field id="contact_email" label="Contact email" type="email" value={form.contact_email} onChange={(v) => set("contact_email", v)} />
              <Field id="contact_phone" label="Contact phone" value={form.contact_phone} onChange={(v) => set("contact_phone", v)} />
              <Field id="country" label="Country" value={form.country} onChange={(v) => set("country", v)} />
              <Field id="fleet_size" label="Fleet size" type="number" value={String(form.fleet_size)} onChange={(v) => set("fleet_size", Number(v))} />
              <Field id="aircraft_types" label="Aircraft types" value={form.aircraft_types} onChange={(v) => set("aircraft_types", v)} />
              <Field id="aoc_number" label="AOC number" value={form.aoc_number} onChange={(v) => set("aoc_number", v)} />
              <Field id="insurance_expiry" label="Insurance expiry" type="date" value={form.insurance_expiry} onChange={(v) => set("insurance_expiry", v)} />
              <div className="md:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" className="mt-2" maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {REQUIRED_PARTNER_DOCS.map((d) => {
                const attached = docs.find((x) => x.key === d.key);
                return (
                  <div key={d.key} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{d.label}</p>
                      <p className="truncate text-xs text-muted-foreground">{attached ? attached.file_name : "PDF or image, max 10MB"}</p>
                    </div>
                    <label className="shrink-0">
                      <input
                        type="file" className="sr-only" accept={ACCEPTED_EVIDENCE}
                        onChange={(e) => void onUpload(d.key, d.label, e.target.files?.[0])}
                      />
                      <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                        {busy === `doc:${d.key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          : attached ? <FileCheck2 className="h-3.5 w-3.5 text-status-success" aria-hidden="true" />
                          : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
                        {attached ? "Replace" : "Upload"}
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex items-center gap-3">
              <Button onClick={() => void onSubmit()} disabled={busy === "submit"} className="gap-2">
                {busy === "submit" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Submit application
              </Button>
              <p className="text-xs text-muted-foreground">{docs.length}/{REQUIRED_PARTNER_DOCS.length} documents attached</p>
            </div>
          </HubSection>
        </TabsContent>
      </Tabs>

      <Dialog open={!!timelineFor} onOpenChange={(o) => !o && setTimelineFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Audit trail — {timelineFor?.operator_name}</DialogTitle></DialogHeader>
          <ol className="max-h-[60vh] space-y-3 overflow-y-auto">
            {events.map((e) => (
              <li key={e.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium capitalize">{e.action.replace(/_/g, " ")}</p>
                  <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {e.from_status ? `${e.from_status} → ` : ""}{e.to_status ?? ""} {e.actor_email ? `· ${e.actor_email}` : ""}
                </p>
                {e.note && <p className="mt-1 text-xs">{e.note}</p>}
              </li>
            ))}
            {events.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">No audit entries.</li>}
          </ol>
        </DialogContent>
      </Dialog>
    </FlightHubPage>
  );
}

function Field({ id, label, value, onChange, type = "text" }: {
  id: string; label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} className="mt-2" value={value} maxLength={160} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
