/**
 * Logistics Production Readiness Control Plane — presentation.
 *
 * Shows two independent dimensions so a mature build is never mistaken for a
 * certified operation, and a certified-looking score is never shown without
 * evidence: ENGINEERING MATURITY vs PRODUCTION CERTIFICATION.
 */
import { Loader2 } from "lucide-react";
import type { CommandCenterView } from "@/lib/logistics/readiness/execution";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AppButton } from "@/components/nav/AppButton";
import { Progress } from "@/components/ui/progress";
import { FileCheck2, ShieldAlert } from "lucide-react";
import {
  renderLogisticsCertificateMarkdown,
  type ControlStatus,
} from "@/lib/logistics/readiness";

const STATUS_TONE: Record<ControlStatus, string> = {
  PASS: "border-primary/40 bg-primary/5",
  HOLD: "border-border bg-muted/30",
  FAIL: "border-destructive/40 bg-destructive/5",
  BLOCKED: "border-border bg-muted/30",
  NOT_TESTED: "border-border bg-muted/20",
  BUSINESS_APPROVAL_REQUIRED: "border-border bg-muted/30",
  EXPIRED: "border-destructive/40 bg-destructive/5",
};

const VERDICT_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  PASS: "default",
  HOLD: "secondary",
  FAIL: "destructive",
};

function saveFile(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  /** The single authoritative, evidence-overlaid projection. */
  view: CommandCenterView;
  loading?: boolean;
  error?: string | null;
}

/**
 * ONE authoritative projection. This panel used to render the static,
 * code-derived baseline, which is why it kept reporting DI-00/ST controls as
 * BLOCKED after sealed PASS evidence existed.
 */
export default function LogisticsReadinessControlPlanePanel({ view, loading, error }: Props) {
  const cert = view.certification;

  return (
    <div className="space-y-4">
      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading the certification evidence register…
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          The evidence register could not be read, so this projection may be incomplete. {error}
        </p>
      )}

      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <ShieldAlert className="h-4 w-4 text-destructive" /> Logistics Production Readiness Control Plane
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">{cert.headline}</h2>
        <p className="mt-1 text-sm font-medium text-destructive">
          Certificate state {cert.certificateState.replace(/_/g, " ")} · readiness state {cert.state} · production migration{" "}
          {cert.migrationAuthorisation.toLowerCase()}.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border bg-background p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Engineering maturity</p>
            <p className="text-3xl font-semibold">{cert.scores.engineeringMaturity}<span className="text-base text-muted-foreground">/100</span></p>
            <Progress value={cert.scores.engineeringMaturity} className="mt-2" />
            <p className="mt-2 text-xs text-muted-foreground">Architecture, application security and integrity proven at the level they were executed.</p>
          </div>
          <div className="rounded-md border border-border bg-background p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Production certification</p>
            <p className="text-3xl font-semibold">{cert.productionStatus}</p>
            <Progress value={cert.scores.productionReadiness} className="mt-2" />
            <p className="mt-2 text-xs text-muted-foreground">
              {cert.scores.productionReadiness}/100 mandatory controls evidenced. Reaches 100 only when every mandatory technical,
              legal, operational, commercial, financial and pilot control is PASS.
            </p>
          </div>
        </div>

        <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Control counts (subordinate — not a readiness measure)</p>
        <p className="text-xs text-muted-foreground">
          Passed {cert.counts.PASS} · Blocked {cert.counts.BLOCKED} · Failed {cert.counts.FAIL} · Not tested {cert.counts.NOT_TESTED} ·
          Business approval required {cert.counts.BUSINESS_APPROVAL_REQUIRED} · Expired {cert.counts.EXPIRED}
        </p>

        <div className="mt-4">
          <AppButton
            analytics="admin.logistics_readiness.download_certificate"
            action="noop"
            variant="outline"
            size="sm"
            onClick={() => saveFile("yalla-logistics-production-readiness-certificate.md", renderLogisticsCertificateMarkdown(cert))}
          >
            <FileCheck2 className="mr-2 h-4 w-4" /> Download readiness certificate
          </AppButton>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Readiness tracks</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cert.trackSummary.map((t) => (
            <div key={t.track} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{t.label}</span>
                <Badge variant={VERDICT_VARIANT[t.verdict]} className="text-[10px] uppercase">{t.verdict}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                PASS {t.counts.PASS} · HOLD {t.counts.HOLD} · BLOCKED {t.counts.BLOCKED} · NOT TESTED {t.counts.NOT_TESTED} ·
                APPROVAL {t.counts.BUSINESS_APPROVAL_REQUIRED} · FAIL {t.counts.FAIL}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">State machine gates</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {cert.gates.map((g) => (
            <div key={g.state} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={g.satisfied ? "default" : "secondary"} className="text-[10px] uppercase">
                  {g.satisfied ? "satisfied" : "gated"}
                </Badge>
                <span className="text-sm font-medium">{g.state.replace(/_/g, " ")}</span>
                <span className="text-xs text-muted-foreground">requires {g.requires.length} track(s)</span>
              </div>
              {!g.satisfied && g.missing.length > 0 && (
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  Outstanding: {g.missing.slice(0, 12).join(", ")}{g.missing.length > 12 ? ` +${g.missing.length - 12} more` : ""}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Blockers — why, what, who, evidence, remediation, clearance ({cert.blockers.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {cert.blockers.map((b) => (
            <div key={b.control_id} className={`rounded-md border p-3 ${STATUS_TONE[b.status]}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">{b.status.replace(/_/g, " ")}</Badge>
                <span className="text-sm font-medium">{b.control_id}</span>
                <span className="text-xs text-muted-foreground">{b.track.replace(/_/g, " ")}</span>
              </div>
              <p className="mt-1 break-words text-xs text-muted-foreground"><strong>Why:</strong> {b.why}</p>
              <p className="break-words text-xs text-muted-foreground"><strong>Required evidence:</strong> {b.required}</p>
              <p className="text-xs text-muted-foreground"><strong>Owner:</strong> {b.owner} · <strong>Approval:</strong> {b.approval_authority}</p>
              <p className="break-words text-xs text-muted-foreground"><strong>Remediation:</strong> {b.remediation}</p>
              <p className="break-words text-xs text-muted-foreground"><strong>Clearance condition:</strong> {b.clearance_condition}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">All controls ({cert.controls.length})</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {cert.controls.map((c) => (
            <div key={c.control_id} className={`rounded-md border p-2 ${STATUS_TONE[c.status]}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">{c.status.replace(/_/g, " ")}</Badge>
                <span className="text-xs font-medium">{c.control_id}</span>
                <span className="text-[11px] text-muted-foreground">{c.track.replace(/_/g, " ")} · {c.environment} · {c.owner}</span>
              </div>
              <p className="break-words text-xs text-muted-foreground">{c.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
