import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DataErrorBanner } from "@/components/platform/DataErrorBanner";
import { listTrustCases, updateTrustCase, listWatchlist, addToWatchlist, deactivateWatchlistEntry, listTamperAlerts, ackTamperAlert, packageCustodyTimeline, resolveCase, type TrustCase, type TrustSeverity, type TrustStatus, type TrustSubjectType, type PackageCustodyEvent, type TrustResolutionOutcome } from "@/domains/trust";

const SEV_COLORS: Record<TrustSeverity, string> = {
  critical: "bg-status-danger/15 text-status-danger border-status-danger/30",
  high: "bg-status-warning/15 text-status-warning border-status-warning/30",
  medium: "bg-status-warning/15 text-status-warning border-status-warning/30",
  low: "bg-status-success/15 text-status-success border-status-success/30",
};

function relTime(iso: string | null) {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 60) return `${mins}m ${diff < 0 ? "ago" : "left"}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ${diff < 0 ? "ago" : "left"}`;
  return `${Math.round(hrs / 24)}d ${diff < 0 ? "ago" : "left"}`;
}

export default function TrustCenter() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<TrustStatus | "all">("all");
  const [sevFilter, setSevFilter] = useState<TrustSeverity | "all">("all");
  const [activeCase, setActiveCase] = useState<TrustCase | null>(null);
  const [custodyPackageId, setCustodyPackageId] = useState("");
  const [custodyEvents, setCustodyEvents] = useState<PackageCustodyEvent[]>([]);

  const casesQ = useQuery({
    queryKey: ["trust-cases", statusFilter, sevFilter],
    queryFn: () => listTrustCases({
      status: statusFilter === "all" ? undefined : statusFilter,
      severity: sevFilter === "all" ? undefined : sevFilter,
    }),
    refetchInterval: 15_000,
  });

  const watchQ = useQuery({ queryKey: ["trust-watchlist"], queryFn: () => listWatchlist(true) });
  const tamperQ = useQuery({
    queryKey: ["trust-tamper"], queryFn: () => listTamperAlerts(true), refetchInterval: 10_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel(`trust-cases-rt-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trust_cases" }, () => {
        qc.invalidateQueries({ queryKey: ["trust-cases"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "package_tamper_alerts" }, () => {
        qc.invalidateQueries({ queryKey: ["trust-tamper"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const kpis = useMemo(() => {
    const cases = casesQ.data ?? [];
    return {
      open: cases.filter((c) => !["resolved", "closed"].includes(c.status)).length,
      critical: cases.filter((c) => c.severity === "critical" && !["resolved", "closed"].includes(c.status)).length,
      breaching: cases.filter((c) => c.sla_due_at && new Date(c.sla_due_at).getTime() < Date.now() && !["resolved", "closed"].includes(c.status)).length,
      watched: (watchQ.data ?? []).length,
      tamper: (tamperQ.data ?? []).length,
    };
  }, [casesQ.data, watchQ.data, tamperQ.data]);

  async function loadCustody() {
    if (!custodyPackageId) return;
    try {
      const ev = await packageCustodyTimeline(custodyPackageId);
      setCustodyEvents(ev);
    } catch (e) {
      toast({ title: "Failed to load custody", description: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trust & Safety Center</h1>
          <p className="text-sm text-muted-foreground">
            Triage cases, monitor SLA breaches, manage watchlists, and audit package chain of custody.
          </p>
        </div>
      </header>

      <DataErrorBanner
        error={casesQ.error ?? tamperQ.error ?? watchQ.error}
        label="Trust & safety data"
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Open cases" value={kpis.open} />
        <KpiCard label="Critical" value={kpis.critical} accent="bg-status-danger/10 text-status-danger" />
        <KpiCard label="SLA breaching" value={kpis.breaching} accent="bg-status-warning/10 text-status-warning" />
        <KpiCard label="Watchlist" value={kpis.watched} />
        <KpiCard label="Tamper alerts" value={kpis.tamper} accent="bg-status-warning/10 text-status-warning" />
      </div>

      <Tabs defaultValue="cases">
        <TabsList>
          <TabsTrigger value="cases">Case Queue</TabsTrigger>
          <TabsTrigger value="tamper">Tamper Alerts</TabsTrigger>
          <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
          <TabsTrigger value="custody">Chain of Custody</TabsTrigger>
        </TabsList>

        <TabsContent value="cases" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as TrustStatus | "all")}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(["open","in_review","investigating","escalated","resolved","closed"] as TrustStatus[]).map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sevFilter} onValueChange={(v) => setSevFilter(v as TrustSeverity | "all")}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                {(["critical","high","medium","low"] as TrustSeverity[]).map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => casesQ.refetch()}>Refresh</Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Case</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>SLA</TableHead>
                    <TableHead>Opened</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(casesQ.data ?? []).map((c) => {
                    const breaching = c.sla_due_at && new Date(c.sla_due_at).getTime() < Date.now()
                      && !["resolved","closed"].includes(c.status);
                    return (
                      <TableRow key={c.id} className="cursor-pointer" onClick={() => setActiveCase(c)}>
                        <TableCell className="font-mono text-xs">{c.case_number}</TableCell>
                        <TableCell>{c.category}</TableCell>
                        <TableCell className="text-xs">{c.subject_type}{c.subject_id ? `:${c.subject_id.slice(0,8)}` : ""}</TableCell>
                        <TableCell><Badge variant="outline" className={SEV_COLORS[c.severity]}>{c.severity}</Badge></TableCell>
                        <TableCell><Badge variant="secondary">{c.status}</Badge></TableCell>
                        <TableCell className={breaching ? "text-status-danger font-medium" : ""}>{relTime(c.sla_due_at)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{relTime(c.created_at)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {(casesQ.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No cases.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tamper" className="space-y-3">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Detected</TableHead>
                    <TableHead>Package</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Detector</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(tamperQ.data ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{relTime(a.detected_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{a.package_id.slice(0,8)}</TableCell>
                      <TableCell>{a.alert_type}</TableCell>
                      <TableCell><Badge variant="outline" className={SEV_COLORS[a.severity]}>{a.severity}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.detector}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={async () => {
                          await ackTamperAlert(a.id);
                          tamperQ.refetch();
                        }}>Acknowledge</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(tamperQ.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No active tamper alerts.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="watchlist" className="space-y-3">
          <WatchlistForm onAdded={() => watchQ.refetch()} />
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(watchQ.data ?? []).map((w) => (
                    <TableRow key={w.id}>
                      <TableCell>{w.subject_type}{w.subject_id ? `:${w.subject_id.slice(0,8)}` : ""}</TableCell>
                      <TableCell className="font-mono text-xs">{w.subject_value ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={SEV_COLORS[w.risk_level]}>{w.risk_level}</Badge></TableCell>
                      <TableCell className="text-xs">{w.reason}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{w.expires_at ? relTime(w.expires_at) : "never"}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={async () => {
                          await deactivateWatchlistEntry(w.id);
                          watchQ.refetch();
                        }}>Remove</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(watchQ.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">Watchlist is empty.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="custody" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Chain of Custody</CardTitle>
              <CardDescription>Enter a package id to view its full custody timeline.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder="package_id (uuid)" value={custodyPackageId}
                  onChange={(e) => setCustodyPackageId(e.target.value)} />
                <Button onClick={loadCustody}>Load</Button>
              </div>
              <ol className="space-y-2">
                {custodyEvents.map((e) => (
                  <li key={e.id} className="rounded-lg border bg-card p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{e.event_type}</span>
                      <span className="text-xs text-muted-foreground">{new Date(e.occurred_at).toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {e.actor_label ?? e.actor_type ?? "system"}
                      {e.location_label ? ` • ${e.location_label}` : ""}
                      {e.seal_id ? ` • seal ${e.seal_id} ${e.seal_intact ? "✓" : "✗"}` : ""}
                    </div>
                    {e.notes && <div className="mt-1 text-xs">{e.notes}</div>}
                  </li>
                ))}
                {custodyEvents.length === 0 && (
                  <li className="text-center text-sm text-muted-foreground py-6">No events loaded.</li>
                )}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Sheet open={!!activeCase} onOpenChange={(o) => !o && setActiveCase(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {activeCase && <CaseDetail c={activeCase} onChanged={() => {
            casesQ.refetch();
          }} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`text-2xl font-bold ${accent ?? ""}`}>{value}</div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function WatchlistForm({ onAdded }: { onAdded: () => void }) {
  const [subjectType, setSubjectType] = useState<TrustSubjectType>("device");
  const [subjectValue, setSubjectValue] = useState("");
  const [risk, setRisk] = useState<TrustSeverity>("medium");
  const [reason, setReason] = useState("");

  return (
    <Card>
      <CardHeader><CardTitle>Add to Watchlist</CardTitle></CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-5">
        <Select value={subjectType} onValueChange={(v) => setSubjectType(v as TrustSubjectType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["rider","driver","corporate","courier","vehicle","package","trip","device","ip"] as TrustSubjectType[]).map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="value (email, ip, id)" value={subjectValue} onChange={(e) => setSubjectValue(e.target.value)} />
        <Select value={risk} onValueChange={(v) => setRisk(v as TrustSeverity)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["critical","high","medium","low"] as TrustSeverity[]).map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="md:col-span-1" />
        <Button onClick={async () => {
          if (!reason.trim()) { toast({ title: "Reason required", variant: "destructive" }); return; }
          try {
            await addToWatchlist({ subject_type: subjectType, subject_value: subjectValue || null, risk_level: risk, reason });
            setSubjectValue(""); setReason("");
            onAdded();
            toast({ title: "Added to watchlist" });
          } catch (e) {
            toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
          }
        }}>Add</Button>
      </CardContent>
    </Card>
  );
}

function CaseDetail({ c, onChanged }: { c: TrustCase; onChanged: () => void }) {
  const [status, setStatus] = useState<TrustStatus>(c.status);
  const [severity, setSeverity] = useState<TrustSeverity>(c.severity);
  const [summary, setSummary] = useState(c.summary ?? "");
  const [outcome, setOutcome] = useState<TrustResolutionOutcome>("no_action");
  const [notes, setNotes] = useState("");

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-mono text-sm">{c.case_number}</SheetTitle>
        <SheetDescription>{c.title}</SheetDescription>
      </SheetHeader>
      <div className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as TrustStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["open","in_review","investigating","escalated","resolved","closed"] as TrustStatus[]).map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Severity</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as TrustSeverity)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["critical","high","medium","low"] as TrustSeverity[]).map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Summary</Label>
          <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} />
        </div>
        <Button onClick={async () => {
          try {
            await updateTrustCase(c.id, { status, severity, summary });
            toast({ title: "Case updated" });
            onChanged();
          } catch (e) {
            toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
          }
        }}>Save changes</Button>

        <div className="border-t pt-4 space-y-3">
          <h4 className="font-semibold text-sm">Resolve case</h4>
          <Select value={outcome} onValueChange={(v) => setOutcome(v as TrustResolutionOutcome)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["no_action","warning","refund","partial_refund","account_suspended","account_banned","driver_deactivated","escalated_external","law_enforcement","dismissed"] as TrustResolutionOutcome[]).map(o => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea placeholder="resolution notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          <Button variant="default" onClick={async () => {
            try {
              await resolveCase({ case_id: c.id, outcome, notes });
              toast({ title: "Case resolved" });
              onChanged();
            } catch (e) {
              toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
            }
          }}>Resolve</Button>
        </div>
      </div>
    </>
  );
}
