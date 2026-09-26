/**
 * Phase 7 — Forensic Audit & Revenue Data Authority.
 *
 * Two surfaces, one purpose: state plainly what has been built, and refuse to
 * present a revenue number until an authoritative recognition source exists.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, ShieldAlert, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AUTHORITY_LABEL, REVENUE_EVENT_LABEL, REVENUE_EVENT_MODEL, REVENUE_LAYER_LABEL,
  TRACE_CHAIN, assessRegister, probeRegister, revenueTreeGate,
  type AssessedEntry, type DataStatus, type RegisterCoverage, type RevenueTreeGate,
} from "@/lib/staff/phase7/revenueAuthority";
import {
  DIMENSION_LABEL, runForensicAudit,
  type ForensicAuditReport, type Verdict,
} from "@/lib/staff/phase7/forensicAudit";

const verdictTone: Record<Verdict, string> = {
  PASS: "bg-success/15 text-success border-success/30",
  PARTIAL: "bg-warning/15 text-warning-foreground border-warning/30",
  FAIL: "bg-destructive/10 text-destructive border-destructive/30",
  NOT_EVIDENCED: "bg-muted text-muted-foreground border-border",
};

const statusTone: Record<DataStatus, string> = {
  LIVE: "bg-success/15 text-success border-success/30",
  MODELLED: "bg-info/15 text-info border-info/30",
  SIMULATED: "bg-warning/15 text-warning-foreground border-warning/30",
  INCOMPLETE: "bg-muted text-muted-foreground border-border",
  UNREADABLE: "bg-destructive/10 text-destructive border-destructive/30",
};

const VerdictIcon = ({ verdict }: { verdict: Verdict }) =>
  verdict === "PASS" ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
    : verdict === "FAIL" ? <XCircle className="h-4 w-4 text-destructive" aria-hidden />
    : verdict === "NOT_EVIDENCED" ? <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
    : <AlertTriangle className="h-4 w-4 text-warning-foreground" aria-hidden />;

export default function StaffForensics() {
  const [coverage, setCoverage] = useState<RegisterCoverage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    probeRegister()
      .then((c) => { if (live) setCoverage(c); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "Probe failed"); });
    return () => { live = false; };
  }, []);

  const assessed: AssessedEntry[] = useMemo(
    () => (coverage ? assessRegister(coverage) : []),
    [coverage],
  );
  const gate: RevenueTreeGate | null = useMemo(
    () => (coverage ? revenueTreeGate(assessed) : null),
    [coverage, assessed],
  );
  const report: ForensicAuditReport | null = useMemo(
    () => (coverage ? runForensicAudit(coverage) : null),
    [coverage],
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Forensic audit & revenue data authority</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Phase 7 foundation. Every statement below is derived from a live probe of the platform
          schema and the capability contracts. Where evidence is missing it is reported as
          DATA NOT AVAILABLE — no figure is estimated, and no table is treated as revenue until
          Finance designates a recognition event.
        </p>
      </header>

      {error && (
        <Card className="border-destructive/40">
          <CardHeader className="flex-row items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden />
            <CardTitle className="text-base">Probe failed</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{error}</CardContent>
        </Card>
      )}

      {!coverage && !error && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {gate && (
        <Card className={gate.cleared ? "border-success/40" : "border-warning/50"}>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">Revenue Tree gate</CardTitle>
                <CardDescription>{gate.verdict}</CardDescription>
              </div>
              <Badge variant="outline" className={gate.cleared ? verdictTone.PASS : verdictTone.PARTIAL}>
                {gate.cleared ? "CLEARED" : "BLOCKED"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold mb-2">Blockers</h3>
              <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
                {gate.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2">Required work, in order</h3>
              <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal pl-5">
                {gate.requiredWork.map((w) => <li key={w}>{w}</li>)}
              </ol>
            </div>
          </CardContent>
        </Card>
      )}

      {coverage && (
        <Tabs defaultValue="register">
          <TabsList>
            <TabsTrigger value="register">Authority register</TabsTrigger>
            <TabsTrigger value="model">Event model</TabsTrigger>
            <TabsTrigger value="audit">Forensic audit</TabsTrigger>
          </TabsList>

          <TabsContent value="register" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revenue data authority register</CardTitle>
                <CardDescription>
                  Candidate sources with their revenue meaning, authority level and live data status.
                  Only an AUTHORITATIVE source carrying LIVE data may populate the Revenue Tree.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      <TableHead>Layer</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Meaning</TableHead>
                      <TableHead>Authority</TableHead>
                      <TableHead>Data status</TableHead>
                      <TableHead>Owner</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assessed.map((e) => (
                      <TableRow key={`${e.metric}-${e.sourceTable}`}>
                        <TableCell className="font-medium align-top">{e.metric}</TableCell>
                        <TableCell className="align-top text-sm">{REVENUE_LAYER_LABEL[e.layer]}</TableCell>
                        <TableCell className="align-top text-xs font-mono">
                          {e.sourceTable}
                          <div className="text-muted-foreground">{e.sourceField}</div>
                          <div className="text-muted-foreground">
                            trace: {e.transactionKey ?? "no transaction key"}
                          </div>
                        </TableCell>
                        <TableCell className="align-top text-sm max-w-[24rem]">
                          {e.revenueMeaning}
                          <div className="mt-1 text-xs text-muted-foreground">{e.calculation}</div>
                          {e.reconciliationSource && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Reconciles to {e.reconciliationSource}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge
                            variant="outline"
                            className={e.authority === "forbidden" ? verdictTone.FAIL
                              : e.authority === "authoritative" ? verdictTone.PASS
                              : e.authority === "recognition_candidate" ? verdictTone.PARTIAL
                              : verdictTone.NOT_EVIDENCED}
                          >
                            {AUTHORITY_LABEL[e.authority]}
                          </Badge>
                          <div className="mt-1 text-xs text-muted-foreground max-w-[16rem]">
                            {e.authorityReason}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant="outline" className={statusTone[e.status]}>{e.status}</Badge>
                          <div className="mt-1 text-xs text-muted-foreground">{e.statusReason}</div>
                        </TableCell>
                        <TableCell className="align-top text-sm">{e.owner}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="model" className="mt-4 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Canonical commercial event model</CardTitle>
                <CardDescription>Lead through revenue — one definition for the whole platform.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {REVENUE_EVENT_MODEL.map((s, i) => (
                  <Badge key={s} variant="outline" className="text-xs">
                    {i + 1}. {REVENUE_EVENT_LABEL[s]}
                  </Badge>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Required traceability chain</CardTitle>
                <CardDescription>Every Revenue Tree number must walk this chain end to end.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                {TRACE_CHAIN.map((t, i) => (
                  <span key={t} className="flex items-center gap-2">
                    <span className="rounded-md border px-2 py-1">{t}</span>
                    {i < TRACE_CHAIN.length - 1 && <span className="text-muted-foreground">→</span>}
                  </span>
                ))}
              </CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Marketplace revenue layers</CardTitle>
                <CardDescription>
                  Yalla is a marketplace: these are separate measures and are never merged into one
                  “revenue” figure.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                {Object.entries(REVENUE_LAYER_LABEL).map(([k, label]) => (
                  <div key={k} className="rounded-lg border p-3">
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {assessed.filter((a) => a.layer === k).length} registered source(s)
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-4 space-y-4">
            {report && (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <CardTitle className="text-base">Platform forensic score</CardTitle>
                        <CardDescription>
                          {report.modules.length} audited modules · generated {new Date(report.generatedAt).toLocaleString()}
                        </CardDescription>
                      </div>
                      <Badge variant="outline" className="text-base px-3 py-1">{report.score}/100</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {Object.entries(report.dimensionScores).map(([dim, score]) => (
                      <div key={dim} className="rounded-lg border p-3">
                        <div className="text-xs text-muted-foreground">
                          {DIMENSION_LABEL[dim as keyof typeof DIMENSION_LABEL]}
                        </div>
                        <div className="text-xl font-semibold">{score}</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Remediation queue</CardTitle>
                    <CardDescription>Binding constraint first. Each line states the evidence-backed gap.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {report.queue.map((q) => (
                      <div key={q.module} className="flex items-start gap-3 rounded-lg border p-3">
                        <Badge variant="outline">{q.disposition}</Badge>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{q.module} · {q.score}/100</div>
                          <div className="text-sm text-muted-foreground">{q.headline}</div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <div className="grid gap-4 lg:grid-cols-2">
                  {report.modules.map((m) => (
                    <Card key={m.module}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <CardTitle className="text-base">{m.title}</CardTitle>
                            <CardDescription>{m.owner} · {m.route}</CardDescription>
                          </div>
                          <Badge variant="outline" className={verdictTone[m.verdict]}>
                            {m.verdict} · {m.score}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {m.findings.map((f) => (
                          <div key={f.dimension} className="rounded-lg border p-3 space-y-1.5">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <VerdictIcon verdict={f.verdict} />
                              {DIMENSION_LABEL[f.dimension]}
                              <span className="ml-auto text-muted-foreground">{f.score}/100</span>
                            </div>
                            {f.evidence.length > 0 && (
                              <ul className="text-xs text-muted-foreground list-disc pl-5">
                                {f.evidence.map((e) => <li key={e}>{e}</li>)}
                              </ul>
                            )}
                            {f.gaps.length > 0 && (
                              <ul className="text-xs text-warning-foreground list-disc pl-5">
                                {f.gaps.map((g) => <li key={g}>{g}</li>)}
                              </ul>
                            )}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Refusals recorded by this audit</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                      {report.refusals.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
