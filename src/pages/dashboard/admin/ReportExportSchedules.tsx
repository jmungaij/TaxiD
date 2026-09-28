/**
 * Scheduled report exports (admin).
 *
 * Configures daily/weekly/monthly delivery of the executive and account
 * reports (CSV/PDF) to selected recipients, and shows the delivery history
 * produced by the `report-export-dispatcher` edge function.
 */
import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SeoHead } from "@/components/seo/SeoHead";
import { CalendarClock, Play, Plus, Trash2 } from "lucide-react";
import {
  REPORT_CATALOGUE, REPORT_LABEL, createReportSchedule, defaultRangeDays,
  deleteReportSchedule, loadReportRuns, loadReportSchedules, runReportDispatcher,
  setScheduleEnabled, type ReportCadence, type ReportFormat, type ReportRun,
  type ReportSchedule, type ScheduleDraft,
} from "@/lib/corporate/reportSchedules";

const BLANK: ScheduleDraft = {
  name: "",
  report_key: "conversion-funnel",
  cadence: "weekly",
  format: "csv",
  recipients: "",
  corporate_id: "",
  range_days: 7,
};

const STATUS_TONE: Record<string, string> = {
  delivered: "bg-primary/15 text-primary border-primary/30",
  generated: "bg-primary/10 text-primary border-primary/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  pending: "bg-muted text-muted-foreground",
};

export default function ReportExportSchedules() {
  const [schedules, setSchedules] = React.useState<ReportSchedule[]>([]);
  const [runs, setRuns] = React.useState<ReportRun[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState<ScheduleDraft>({ ...BLANK });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([loadReportSchedules(), loadReportRuns()]);
      setSchedules(s);
      setRuns(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load schedules");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const definition = REPORT_CATALOGUE.find((r) => r.key === draft.report_key);

  const create = async () => {
    if (definition?.requiresCorporate && !draft.corporate_id?.trim()) {
      toast.error(`${definition.label} needs a corporate account id`);
      return;
    }
    setBusy(true);
    const { error } = await createReportSchedule(draft);
    setBusy(false);
    if (error) { toast.error(error); return; }
    toast.success("Schedule created");
    setDraft({ ...BLANK });
    void load();
  };

  const runNow = async (id: string) => {
    setBusy(true);
    const { error } = await runReportDispatcher(id);
    setBusy(false);
    if (error) toast.error(error);
    else { toast.success("Report dispatched"); void load(); }
  };

  const toggle = async (s: ReportSchedule) => {
    const { error } = await setScheduleEnabled(s.id, !s.enabled);
    if (error) toast.error(error);
    else void load();
  };

  const remove = async (id: string) => {
    const { error } = await deleteReportSchedule(id);
    if (error) toast.error(error);
    else { toast.success("Schedule removed"); void load(); }
  };

  return (
    <div className="space-y-6">
      <SeoHead
        title="Scheduled Report Exports | TaxiD"
        description="Automate daily, weekly and monthly CSV/PDF delivery of executive and corporate account reports to selected recipients."
        path="/dashboard/admin/report-schedules"
      />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <CalendarClock className="h-5 w-5" aria-hidden /> Scheduled report exports
          </h1>
          <p className="text-sm text-muted-foreground">
            Deliver funnel, pipeline, spend, budget, invoice and statement reports automatically.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void runReportDispatcher().then(load)} disabled={busy}>
          <Play className="mr-2 h-4 w-4" /> Run all due now
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">New schedule</CardTitle>
          <CardDescription>{definition?.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="sched-name">Name</Label>
            <Input
              id="sched-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Weekly board pack"
            />
          </div>
          <div>
            <Label htmlFor="sched-report">Report</Label>
            <Select
              value={draft.report_key}
              onValueChange={(v) => setDraft({ ...draft, report_key: v })}
            >
              <SelectTrigger id="sched-report"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REPORT_CATALOGUE.map((r) => (
                  <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="sched-cadence">Cadence</Label>
            <Select
              value={draft.cadence}
              onValueChange={(v) =>
                setDraft({ ...draft, cadence: v as ReportCadence, range_days: defaultRangeDays(v as ReportCadence) })
              }
            >
              <SelectTrigger id="sched-cadence"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="sched-format">Format</Label>
            <Select
              value={draft.format}
              onValueChange={(v) => setDraft({ ...draft, format: v as ReportFormat })}
            >
              <SelectTrigger id="sched-format"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="both">CSV + PDF</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="sched-range">Range (days)</Label>
            <Input
              id="sched-range"
              type="number"
              min={1}
              max={365}
              value={draft.range_days}
              onChange={(e) => setDraft({ ...draft, range_days: Number(e.target.value) || 1 })}
            />
          </div>
          {definition?.requiresCorporate && (
            <div>
              <Label htmlFor="sched-corp">Corporate account id</Label>
              <Input
                id="sched-corp"
                value={draft.corporate_id ?? ""}
                onChange={(e) => setDraft({ ...draft, corporate_id: e.target.value })}
                placeholder="uuid"
              />
            </div>
          )}
          <div className="md:col-span-2">
            <Label htmlFor="sched-recipients">Recipients</Label>
            <Textarea
              id="sched-recipients"
              value={draft.recipients}
              onChange={(e) => setDraft({ ...draft, recipients: e.target.value })}
              placeholder="finance@company.co.ke, ceo@company.co.ke"
              rows={2}
            />
          </div>
          <div>
            <Button onClick={() => void create()} disabled={busy}>
              <Plus className="mr-2 h-4 w-4" /> Create schedule
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Active schedules</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-24" />
          ) : schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No schedules configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Report</TableHead>
                  <TableHead>Cadence</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{REPORT_LABEL[s.report_key] ?? s.report_key}</TableCell>
                    <TableCell className="capitalize">{s.cadence}</TableCell>
                    <TableCell className="uppercase">{s.format}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs">{s.recipients.join(", ")}</TableCell>
                    <TableCell className="text-xs">{new Date(s.next_run_at).toLocaleString("en-KE")}</TableCell>
                    <TableCell>
                      <Switch checked={s.enabled} onCheckedChange={() => void toggle(s)} aria-label={`Toggle ${s.name}`} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => void runNow(s.id)} disabled={busy}>
                        <Play className="h-4 w-4" /><span className="sr-only">Run now</span>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void remove(s.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" /><span className="sr-only">Delete</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Delivery history</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deliveries yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Report</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString("en-KE")}</TableCell>
                    <TableCell>{REPORT_LABEL[r.report_key] ?? r.report_key}</TableCell>
                    <TableCell className="tabular-nums">{r.row_count}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs">{r.recipients.join(", ")}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_TONE[r.status] ?? STATUS_TONE.pending}>
                        {r.status}
                      </Badge>
                      {r.error && <p className="mt-1 text-xs text-destructive">{r.error}</p>}
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
