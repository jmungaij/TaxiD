/**
 * Legal & Compliance Centre — /dashboard/admin/legal
 *
 * The administrative surface over the Legal & Regulatory Control Plane. Every
 * number shown here is computed from the legal_* register; nothing is asserted.
 * Where a legal position is unresolved the console shows LEGAL_REVIEW_REQUIRED
 * and offers the workflow that captures the human determination — it never
 * offers a control that marks something compliant.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, FileText, Gavel, Loader2, RefreshCw, ShieldAlert, ShieldQuestion } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { LegalComplianceAlertsPanel } from "@/components/logistics/LegalComplianceAlertsPanel";

import {
  fetchExpiryHorizon,
  fetchGoodsRules,
  fetchLegalCertifications,
  fetchLegalContracts,
  fetchLegalEvents,
  fetchLegalIncidents,
  fetchLegalLicences,
  fetchLegalPermits,
  fetchLegalReadiness,
  fetchLegalRequirements,
  fetchLegalReviews,
  fetchProcessingRegister,
  fetchProtectionPolicies,
  legalMatrix,
  raiseLegalReview,
  upsertLegalRecord,
  type ExpiryRow,
  type LegalContractRow,
  type LegalEventRow,
  type LegalIncidentRow,
  type LegalInstrumentRow,
  type LegalProcessingRow,
  type LegalReviewRow,
} from "@/lib/legal";
import type { GoodsRule, ProtectionPolicy, LegalReadinessSummary, LegalRequirement } from "@/lib/legal";

interface CentreData {
  readiness: LegalReadinessSummary;
  requirements: LegalRequirement[];
  licences: LegalInstrumentRow[];
  permits: LegalInstrumentRow[];
  certifications: LegalInstrumentRow[];
  goods: (GoodsRule & { id: string })[];
  protection: ProtectionPolicy[];
  contracts: LegalContractRow[];
  processing: LegalProcessingRow[];
  reviews: LegalReviewRow[];
  incidents: LegalIncidentRow[];
  events: LegalEventRow[];
  expiry: ExpiryRow[];
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-success/10 text-success border-success/30",
  verified: "bg-success/10 text-success border-success/30",
  expiring: "bg-warning/10 text-warning border-warning/30",
  submitted: "bg-info/10 text-info border-info/30",
  under_review: "bg-info/10 text-info border-info/30",
  review_required: "bg-warning/10 text-warning border-warning/30",
  evidence_required: "bg-warning/10 text-warning border-warning/30",
  unknown: "bg-muted text-muted-foreground border-border",
  not_applicable: "bg-muted text-muted-foreground border-border",
  expired: "bg-destructive/10 text-destructive border-destructive/30",
  suspended: "bg-destructive/10 text-destructive border-destructive/30",
  revoked: "bg-destructive/10 text-destructive border-destructive/30",
};

function StatusBadge({ value }: { value: string }) {
  const tone = STATUS_TONE[value] ?? "bg-muted text-muted-foreground border-border";
  return (
    <Badge variant="outline" className={tone}>
      {value.replace(/_/g, " ")}
    </Badge>
  );
}

function BandBadge({ band }: { band: string }) {
  const tone =
    band === "VALID"
      ? "bg-success/10 text-success border-success/30"
      : band === "EXPIRED" || band === "SUSPENDED" || band === "REVOKED"
        ? "bg-destructive/10 text-destructive border-destructive/30"
        : "bg-warning/10 text-warning border-warning/30";
  return (
    <Badge variant="outline" className={tone}>
      {band.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}

export default function LegalControlCentre() {
  const [data, setData] = useState<CentreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reviewQuestion, setReviewQuestion] = useState("");
  const [reviewSubject, setReviewSubject] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        readiness,
        requirements,
        licences,
        permits,
        certifications,
        goods,
        protection,
        contracts,
        processing,
        reviews,
        incidents,
        events,
        expiry,
      ] = await Promise.all([
        fetchLegalReadiness(),
        fetchLegalRequirements(),
        fetchLegalLicences(),
        fetchLegalPermits(),
        fetchLegalCertifications(),
        fetchGoodsRules(),
        fetchProtectionPolicies(),
        fetchLegalContracts(),
        fetchProcessingRegister(),
        fetchLegalReviews(),
        fetchLegalIncidents(),
        fetchLegalEvents(100),
        fetchExpiryHorizon(),
      ]);
      setData({
        readiness: readiness.summary,
        requirements,
        licences,
        permits,
        certifications,
        goods,
        protection,
        contracts,
        processing,
        reviews,
        incidents,
        events,
        expiry,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The legal register could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const matrix = useMemo(() => (data ? legalMatrix(data.readiness) : []), [data]);

  const classifyGoods = async (rule: GoodsRule & { id: string }, goodsClass: string, legalBasis: string) => {
    if (!legalBasis.trim()) {
      toast.error("Record the legal basis before classifying goods.");
      return;
    }
    setSavingId(rule.id);
    try {
      await upsertLegalRecord("legal_goods_rules", { goods_class: goodsClass, legal_basis: legalBasis, status: "active" }, rule.id);
      toast.success(`${rule.goodsCategory} classified as ${goodsClass}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the classification.");
    } finally {
      setSavingId(null);
    }
  };

  const submitReview = async () => {
    if (reviewQuestion.trim().length < 10) {
      toast.error("Describe the legal question that needs determination.");
      return;
    }
    setSavingId("review");
    try {
      await raiseLegalReview({
        subjectType: reviewSubject.trim() || "platform",
        question: reviewQuestion.trim(),
        assignedRole: "compliance_admin",
      });
      toast.success("Legal review raised and assigned.");
      setReviewQuestion("");
      setReviewSubject("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not raise the review.");
    } finally {
      setSavingId(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Helmet>
        <title>Legal &amp; Compliance Centre | Yalla Mobility</title>
        <meta name="description" content="Regulatory register, licences, goods controls, contracts, data protection and legal reviews governing Yalla Mobility operations." />
      </Helmet>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Legal &amp; Compliance Centre</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Legal status is an input into serviceability, booking, dispatch and settlement. Records here drive the legal gate,
            which currently runs in shadow mode: decisions are computed and logged without refusing live traffic.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Register unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gavel className="h-5 w-5" /> Legal readiness
              </CardTitle>
              <CardDescription>
                Overall {data.readiness.overallScore}% — verdict{" "}
                <span className="font-semibold">{data.readiness.verdict.replace(/_/g, " ").toLowerCase()}</span>. Domains with no
                records score zero rather than being rounded up.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {data.readiness.domains.map((d) => (
                <div key={d.key} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{d.label}</span>
                    <span className="text-sm tabular-nums">{d.score}%</span>
                  </div>
                  <Progress value={d.score} className="mt-2" />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {d.satisfied}/{d.applicable} satisfied · blocks {d.blockingStage}
                  </p>
                  {d.gap !== "NONE" && (
                    <Badge variant="outline" className="mt-2 bg-warning/10 text-warning border-warning/30">
                      {d.gap.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Tabs defaultValue="overview">
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="alerts">Compliance alerts</TabsTrigger>
              <TabsTrigger value="requirements">Regulatory register</TabsTrigger>
              <TabsTrigger value="instruments">Licences &amp; permits</TabsTrigger>
              <TabsTrigger value="goods">Goods controls</TabsTrigger>
              <TabsTrigger value="contracts">Contracts</TabsTrigger>
              <TabsTrigger value="protection">Protection</TabsTrigger>
              <TabsTrigger value="privacy">Data protection</TabsTrigger>
              <TabsTrigger value="reviews">Legal reviews</TabsTrigger>
              <TabsTrigger value="incidents">Incidents</TabsTrigger>
              <TabsTrigger value="expiry">Expiry calendar</TabsTrigger>
              <TabsTrigger value="audit">Audit trail</TabsTrigger>
            </TabsList>

            <TabsContent value="alerts">
              <LegalComplianceAlertsPanel />
            </TabsContent>



            <TabsContent value="overview" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Readiness matrix</CardTitle>
                  <CardDescription>Domain → system of record → evidence state → operational stage blocked.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead>System of record</TableHead>
                        <TableHead>Evidence</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Blocking stage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {matrix.map((row) => (
                        <TableRow key={row.domain}>
                          <TableCell className="font-medium">{row.domain}</TableCell>
                          <TableCell className="text-muted-foreground">{row.system}</TableCell>
                          <TableCell className="text-muted-foreground">{row.evidence}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={row.status === "SATISFIED" ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning border-warning/30"}>
                              {row.status.replace(/_/g, " ").toLowerCase()}
                            </Badge>
                          </TableCell>
                          <TableCell>{row.blocking}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Alert>
                <ShieldQuestion className="h-4 w-4" />
                <AlertTitle>Legal determinations are not automated</AlertTitle>
                <AlertDescription>
                  Software configures fields, expiry dates, workflows, evidence requirements and status calculations. Whether a
                  particular licence is legally required for the Yalla operating model, whether a contract is sufficient, and
                  whether a policy covers a loss remain human determinations captured through the legal review workflow.
                </AlertDescription>
              </Alert>
            </TabsContent>

            <TabsContent value="requirements">
              <Card>
                <CardHeader>
                  <CardTitle>Regulatory register</CardTitle>
                  <CardDescription>{data.requirements.length} structured requirements. Each carries an owner, a failure action and the stages it blocks.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Requirement</TableHead>
                        <TableHead>Regulator</TableHead>
                        <TableHead>Applies to</TableHead>
                        <TableHead>Failure action</TableHead>
                        <TableHead>Blocks</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.requirements.map((r) => (
                        <TableRow key={r.code}>
                          <TableCell>
                            <div className="font-medium">{r.title}</div>
                            <div className="text-xs text-muted-foreground">{r.code}</div>
                          </TableCell>
                          <TableCell>{r.regulator ?? "—"}</TableCell>
                          <TableCell>{r.appliesTo}</TableCell>
                          <TableCell className="text-muted-foreground">{r.failureAction.replace(/_/g, " ")}</TableCell>
                          <TableCell className="text-muted-foreground">{r.blockingStages.join(", ") || "—"}</TableCell>
                          <TableCell>{r.ownerRole ?? "—"}</TableCell>
                          <TableCell><StatusBadge value={r.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="instruments">
              <Card>
                <CardHeader>
                  <CardTitle>Licences, permits and certifications</CardTitle>
                  <CardDescription>
                    {data.licences.length + data.permits.length + data.certifications.length} instrument records. An empty register
                    means the gate reports INSTRUMENT_MISSING — it is never treated as satisfied.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  {data.licences.length + data.permits.length + data.certifications.length === 0 ? (
                    <Alert>
                      <FileText className="h-4 w-4" />
                      <AlertTitle>No instruments recorded yet</AlertTitle>
                      <AlertDescription>
                        Capture each licence, permit and certification with its number, issuer, validity dates and evidence. Until
                        then every mandatory requirement resolves to blocked at its recorded stage.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Instrument</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead>Holder</TableHead>
                          <TableHead>Requirement</TableHead>
                          <TableHead>Valid until</TableHead>
                          <TableHead>Verification</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...data.licences, ...data.permits, ...data.certifications].map((i) => (
                          <TableRow key={`${i.kind}-${i.id}`}>
                            <TableCell>
                              <div className="font-medium">{i.label}</div>
                              <div className="text-xs text-muted-foreground">{i.kind}</div>
                            </TableCell>
                            <TableCell>{i.reference ?? "—"}</TableCell>
                            <TableCell>{i.holderName ?? i.holderType ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{i.requirementCode || "unlinked"}</TableCell>
                            <TableCell>{i.effectiveUntil ?? "not recorded"}</TableCell>
                            <TableCell>{(i.verification ?? "pending").replace(/_/g, " ")}</TableCell>
                            <TableCell><StatusBadge value={i.status} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="goods">
              <Card>
                <CardHeader>
                  <CardTitle>Goods control register</CardTitle>
                  <CardDescription>
                    Unclassified goods route to manual review and are never treated as standard. Classifying a category requires a
                    recorded legal basis.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.goods.map((rule) => (
                    <GoodsRow key={rule.id} rule={rule} saving={savingId === rule.id} onClassify={classifyGoods} />
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="contracts">
              <Card>
                <CardHeader>
                  <CardTitle>Contract register</CardTitle>
                  <CardDescription>Customer terms, partner agreements and service level commitments with their versions.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  {data.contracts.length === 0 ? (
                    <Alert>
                      <FileText className="h-4 w-4" />
                      <AlertTitle>No contracts recorded</AlertTitle>
                      <AlertDescription>
                        Customer terms acceptance and partner agreements block booking and activation respectively until recorded
                        with their exact versions.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Contract</TableHead>
                          <TableHead>Version</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Counterparty</TableHead>
                          <TableHead>Valid until</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.contracts.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>
                              <div className="font-medium">{c.title}</div>
                              <div className="text-xs text-muted-foreground">{c.contractCode}</div>
                            </TableCell>
                            <TableCell>{c.version}</TableCell>
                            <TableCell>{c.contractType}</TableCell>
                            <TableCell>{c.counterpartyName ?? c.counterpartyType}</TableCell>
                            <TableCell>{c.effectiveUntil ?? "—"}</TableCell>
                            <TableCell><StatusBadge value={c.status} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="protection">
              <Card>
                <CardHeader>
                  <CardTitle>Protection register</CardTitle>
                  <CardDescription>
                    A protection statement may only be made where a verified policy record supports it for the goods, territory,
                    value and date.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  {data.protection.length === 0 ? (
                    <Alert>
                      <ShieldAlert className="h-4 w-4" />
                      <AlertTitle>No protection policy on file</AlertTitle>
                      <AlertDescription>
                        Customer surfaces must therefore state custody and proof-of-delivery evidence only, with no cover claim.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Policy</TableHead>
                          <TableHead>Provider</TableHead>
                          <TableHead>Coverage</TableHead>
                          <TableHead>Per consignment</TableHead>
                          <TableHead>Valid until</TableHead>
                          <TableHead>Verification</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.protection.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-medium">{p.policyReference}</TableCell>
                            <TableCell>{p.provider}</TableCell>
                            <TableCell>{p.coverageType}</TableCell>
                            <TableCell>{p.perConsignmentLimit != null ? `${p.perConsignmentLimit} ${p.limitCurrency}` : "—"}</TableCell>
                            <TableCell>{p.effectiveUntil ?? "—"}</TableCell>
                            <TableCell>{p.verificationStatus.replace(/_/g, " ")}</TableCell>
                            <TableCell><StatusBadge value={p.status} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="privacy">
              <Card>
                <CardHeader>
                  <CardTitle>Processing register</CardTitle>
                  <CardDescription>{data.processing.length} activities. Lawful basis and retention require legal determination before an activity is active.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Activity</TableHead>
                        <TableHead>Purpose</TableHead>
                        <TableHead>Lawful basis</TableHead>
                        <TableHead>Data categories</TableHead>
                        <TableHead>Retention (days)</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.processing.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <div className="font-medium">{p.activity}</div>
                            <div className="text-xs text-muted-foreground">{p.code}</div>
                          </TableCell>
                          <TableCell className="max-w-[18rem] text-muted-foreground">{p.processingPurpose}</TableCell>
                          <TableCell>{p.lawfulBasis}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{p.dataCategories.join(", ")}</TableCell>
                          <TableCell>{p.retentionPeriodDays ?? "not set"}</TableCell>
                          <TableCell><StatusBadge value={p.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="reviews" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Raise a legal review</CardTitle>
                  <CardDescription>The only route for an unresolved legal question. Software never records the determination itself.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="review-subject">Subject</Label>
                      <Input id="review-subject" placeholder="platform, partner, service…" value={reviewSubject} onChange={(e) => setReviewSubject(e.target.value)} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label htmlFor="review-question">Question requiring determination</Label>
                      <Textarea id="review-question" rows={3} value={reviewQuestion} onChange={(e) => setReviewQuestion(e.target.value)} placeholder="e.g. Is Yalla the licensed courier operator, or does it operate through licensed carriers?" />
                    </div>
                  </div>
                  <Button onClick={() => void submitReview()} disabled={savingId === "review"}>
                    {savingId === "review" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Raise review
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Open and closed reviews</CardTitle>
                  <CardDescription>{data.reviews.length} recorded reviews.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Question</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Assigned</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead>Raised</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.reviews.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-muted-foreground">No reviews recorded.</TableCell></TableRow>
                      ) : (
                        data.reviews.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="max-w-[26rem]">{r.question}</TableCell>
                            <TableCell>{r.subjectType}</TableCell>
                            <TableCell>{r.assignedRole ?? "—"}</TableCell>
                            <TableCell><StatusBadge value={r.outcome} /></TableCell>
                            <TableCell className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="incidents">
              <Card>
                <CardHeader>
                  <CardTitle>Legal incident queue</CardTitle>
                  <CardDescription>Licensing, data protection, prohibited goods, tax, contract and regulatory notices with owner and deadline.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Incident</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Deadline</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.incidents.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-muted-foreground">No legal incidents recorded.</TableCell></TableRow>
                      ) : (
                        data.incidents.map((i) => (
                          <TableRow key={i.id}>
                            <TableCell>
                              <div className="font-medium">{i.title}</div>
                              <div className="text-xs text-muted-foreground">{i.incidentCode}</div>
                            </TableCell>
                            <TableCell>{i.category}</TableCell>
                            <TableCell>{i.severity}</TableCell>
                            <TableCell>{i.ownerRole ?? "—"}</TableCell>
                            <TableCell>{i.deadlineAt ? new Date(i.deadlineAt).toLocaleDateString() : "—"}</TableCell>
                            <TableCell><StatusBadge value={i.status} /></TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="expiry">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarClock className="h-5 w-5" /> Expiry calendar
                  </CardTitle>
                  <CardDescription>
                    90 days warns, 60 days notifies the owner, 30 days escalates to management, expiry restricts operations.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Instrument</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Holder</TableHead>
                        <TableHead>Valid until</TableHead>
                        <TableHead>Days</TableHead>
                        <TableHead>Band</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.expiry.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-muted-foreground">No dated legal instruments recorded.</TableCell></TableRow>
                      ) : (
                        data.expiry.map((e) => (
                          <TableRow key={`${e.instrumentKind}-${e.instrumentId}`}>
                            <TableCell className="font-medium">{e.label}</TableCell>
                            <TableCell>{e.instrumentKind}</TableCell>
                            <TableCell>{e.holder ?? "—"}</TableCell>
                            <TableCell>{e.effectiveUntil ?? "not recorded"}</TableCell>
                            <TableCell className="tabular-nums">{e.daysRemaining ?? "—"}</TableCell>
                            <TableCell><BandBadge band={e.band} /></TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="audit">
              <Card>
                <CardHeader>
                  <CardTitle>Legal gate audit trail</CardTitle>
                  <CardDescription>Append-only record of every legal decision, including shadow-mode evaluations from booking and dispatch.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>Stage</TableHead>
                        <TableHead>Decision</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Requirement</TableHead>
                        <TableHead>Mode</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.events.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-muted-foreground">No legal decisions recorded yet.</TableCell></TableRow>
                      ) : (
                        data.events.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</TableCell>
                            <TableCell>{e.eventType}</TableCell>
                            <TableCell>{e.gateStage ?? "—"}</TableCell>
                            <TableCell>{e.decision}</TableCell>
                            <TableCell className="text-muted-foreground">{e.reasonCode ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{e.requirementCode ?? "—"}</TableCell>
                            <TableCell>{e.shadowMode ? "shadow" : "enforced"}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function GoodsRow({
  rule,
  saving,
  onClassify,
}: {
  rule: GoodsRule & { id: string };
  saving: boolean;
  onClassify: (rule: GoodsRule & { id: string }, goodsClass: string, legalBasis: string) => Promise<void>;
}) {
  const [goodsClass, setGoodsClass] = useState(rule.goodsClass);
  const [legalBasis, setLegalBasis] = useState(rule.legalBasis ?? "");

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium capitalize">{rule.goodsCategory}</div>
          <div className="text-xs text-muted-foreground">{rule.code}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge value={rule.status} />
          <Badge variant="outline">{rule.goodsClass}</Badge>
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[12rem_1fr_auto] md:items-end">
        <div className="space-y-1">
          <Label htmlFor={`class-${rule.id}`}>Classification</Label>
          <select
            id={`class-${rule.id}`}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={goodsClass}
            onChange={(e) => setGoodsClass(e.target.value as GoodsRule["goodsClass"])}
          >
            <option value="unknown">unknown</option>
            <option value="standard">standard</option>
            <option value="conditional">conditional</option>
            <option value="restricted">restricted</option>
            <option value="prohibited">prohibited</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`basis-${rule.id}`}>Legal basis for the classification</Label>
          <Input id={`basis-${rule.id}`} value={legalBasis} onChange={(e) => setLegalBasis(e.target.value)} placeholder="Instrument, rule or determination reference" />
        </div>
        <Button
          variant="outline"
          disabled={saving || goodsClass === "unknown"}
          onClick={() => void onClassify(rule, goodsClass, legalBasis)}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save classification
        </Button>
      </div>
    </div>
  );
}
