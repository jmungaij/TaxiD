/**
 * Identity & Trust Plane — staff console.
 *
 * Two truths, both read from records rather than written by hand:
 *  • the identity certification matrix (what has been proven, against which
 *    environment, with the observation recorded at the time), and
 *  • the security claims register (which customer-facing statements are allowed
 *    to appear, and why the rest are withheld).
 *
 * A control with no executed evidence is never a pass, and a claim with no
 * control or no passing evidence is never displayable.
 */
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { AlertTriangle, CheckCircle2, EyeOff, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  humanDomain,
  loadClaimRegister,
  loadIdentityCertification,
  loadIdentitySummary,
  VERDICT_LABEL,
  VERDICT_TONE,
  type ClaimRegisterRow,
  type IdentityControlRow,
  type IdentitySummary,
  type Verdict,
} from "@/lib/identity/plane";

function when(value: string | null): string {
  if (!value) return "not executed";
  return new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

export default function IdentityTrust() {
  const [summary, setSummary] = useState<IdentitySummary | null>(null);
  const [controls, setControls] = useState<IdentityControlRow[] | null>(null);
  const [claims, setClaims] = useState<ClaimRegisterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [s, c, k] = await Promise.all([
          loadIdentitySummary(),
          loadIdentityCertification(),
          loadClaimRegister(),
        ]);
        setSummary(s);
        setControls(c);
        setClaims(k);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the identity plane.");
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, IdentityControlRow[]>();
    for (const row of controls ?? []) {
      const list = map.get(row.domain) ?? [];
      list.push(row);
      map.set(row.domain, list);
    }
    return [...map.entries()];
  }, [controls]);

  const displayable = (claims ?? []).filter((c) => c.safe_to_display);
  const withheld = (claims ?? []).filter((c) => !c.safe_to_display);

  const tiles: { label: string; value: number | string; tone?: string }[] = summary
    ? [
        { label: "Controls", value: summary.controls },
        { label: "Proven", value: summary.passed, tone: "text-primary" },
        { label: "Partly proven", value: summary.partial },
        { label: "Failed", value: summary.failed, tone: summary.failed > 0 ? "text-destructive" : undefined },
        { label: "Blocked", value: summary.blocked },
        { label: "Not tested", value: summary.not_tested },
        { label: "Needs outside action", value: summary.requires_external_action },
      ]
    : [];

  return (
    <main className="container mx-auto px-4 py-8">
      <Helmet>
        <title>Identity & Trust Plane | Yalla Admin</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <header className="mb-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Identity &amp; Trust Plane
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Identity certification and claims</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Counts below are derived from control records. A control only reads as proven when a real
          execution against a named environment recorded the observation shown next to it.
        </p>
      </header>

      {error && (
        <Card className="mb-6 border-destructive/40">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" aria-hidden="true" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}

      {summary && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Current standing</CardTitle>
            <CardDescription>
              {summary.certification === "CERTIFIED"
                ? "Every required control has been proven."
                : "Not production ready — required controls are still unproven."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {tiles.map((t) => (
              <div key={t.label}>
                <div className={cn("text-2xl font-semibold", t.tone)}>{t.value}</div>
                <div className="text-xs text-muted-foreground">{t.label}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="certification">
        <TabsList>
          <TabsTrigger value="certification">Certification matrix</TabsTrigger>
          <TabsTrigger value="claims">Claims register</TabsTrigger>
        </TabsList>

        <TabsContent value="certification" className="mt-4 space-y-5">
          {controls === null ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            grouped.map(([domain, rows]) => (
              <Card key={domain}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold capitalize">{humanDomain(domain)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {rows.map((row) => (
                    <div key={row.control_code} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{row.control_code}</span>
                        <span className="text-sm font-medium">{row.title}</span>
                        <Badge variant="outline" className={cn("text-[10px]", VERDICT_TONE[row.verdict as Verdict])}>
                          {VERDICT_LABEL[row.verdict as Verdict] ?? row.verdict}
                        </Badge>
                        {row.mandatory && (
                          <Badge variant="outline" className="text-[10px]">Required</Badge>
                        )}
                        {row.severity && (
                          <span className="text-[10px] text-muted-foreground">{row.severity}</span>
                        )}
                      </div>
                      {row.requirement && (
                        <p className="mt-1.5 text-xs text-muted-foreground">{row.requirement}</p>
                      )}
                      <p className="mt-2 text-xs">
                        {row.observation ?? "No execution recorded."}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {when(row.executed_at)}
                        {row.environment ? ` · ${row.environment}` : ""}
                        {row.blocked_reason ? ` · ${row.blocked_reason.split("_").join(" ").toLowerCase()}` : ""}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="claims" className="mt-4 space-y-5">
          {claims === null ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                    Statements we may show ({displayable.length})
                  </CardTitle>
                  <CardDescription>Each has a named control and passing evidence within its review window.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {displayable.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None yet.</p>
                  ) : (
                    displayable.map((c) => (
                      <div key={c.claim_code} className="rounded-lg border border-border p-3">
                        <div className="text-sm font-medium">“{c.wording}”</div>
                        <p className="mt-1 text-xs text-muted-foreground">{c.implementation}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {c.surface ? `${c.surface} · ` : ""}{c.controls} control(s) · verified {when(c.verified_at)}
                          {c.environment ? ` · ${c.environment}` : ""}
                          {c.review_due ? " · review due" : ""}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <EyeOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    Statements withheld ({withheld.length})
                  </CardTitle>
                  <CardDescription>Not shown anywhere until the control and its evidence exist.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {withheld.map((c) => (
                    <div key={c.claim_code} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{c.claim_code.split("_").join(" ")}</span>
                        <Badge variant="outline" className="text-[10px]">{c.display_state.split("_").join(" ").toLowerCase()}</Badge>
                      </div>
                      {c.wording && <p className="mt-1 text-xs italic text-muted-foreground">“{c.wording}”</p>}
                      <p className="mt-1 text-xs">{c.withheld_reason ?? "No evidence recorded."}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
