/**
 * Admin Command Centre · "Surfaces & Integrity" tab — surfaces every admin route grouped by section so no
 * admin page stays orphaned. Reads from the navigation registry.
 *
 * Deep-link contract (used by the Integrity Report):
 *   ?focus=/dashboard/admin/foo   → highlight & scroll the matching tile
 *   ?file=src/...&line=42         → render a remediation banner pointing at the
 *                                    exact button source location
 */
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as React from "react";
import { adminSectionEntries, type AdminSection } from "@/lib/navigation-registry";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, ShieldCheck, SlidersHorizontal,
  MousePointerClick, Play, History, FileCode,
} from "lucide-react";


const SECTION_LABELS: Record<AdminSection, { label: string; desc: string }> = {
  operations:   { label: "Operations",   desc: "Dispatch, NOC, driver ops, training" },
  finance:      { label: "Finance",      desc: "M-Pesa, wallets, payments, tax" },
  compliance:   { label: "Compliance",   desc: "KYC, alerts, governance" },
  security:     { label: "Trust & Security", desc: "Fraud, trust, identity" },
  analytics:    { label: "Analytics",    desc: "Exports, reporting" },
  users:        { label: "Users & Roles", desc: "Access management" },
  integrations: { label: "Integrations", desc: "Outbox, webhooks, partners" },
  platform:     { label: "Platform",     desc: "Settings, navigation health" },
};

interface LatestRun {
  ran_at: string;
  passed: boolean;
  dead_routes: number;
  orphan_routes: number;
  registry_mismatch: number;
  unbound_buttons: number;
  missing_analytics: number;
}

export default function AdminSurfacesTab() {
  const { roles } = useAuth();
  const sections = React.useMemo(() => adminSectionEntries(), []);
  const [q, setQ] = React.useState("");
  const [latest, setLatest] = React.useState<LatestRun | null>(null);
  const [running, setRunning] = React.useState(false);
  const [params] = useSearchParams();
  const focusPath = params.get("focus");
  const focusFile = params.get("file");
  const focusLine = params.get("line");
  const focusRef = React.useRef<HTMLAnchorElement | null>(null);

  const refreshLatest = React.useCallback(() => {
    supabase
      .from("navigation_integrity_runs")
      .select("ran_at,passed,dead_routes,orphan_routes,registry_mismatch,unbound_buttons,missing_analytics")
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLatest((data as any) ?? null));
  }, []);

  React.useEffect(() => { refreshLatest(); }, [refreshLatest]);

  React.useEffect(() => {
    if (focusPath && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusPath]);

  const runNow = async () => {
    setRunning(true);
    const { error } = await supabase.functions.invoke("navigation-integrity-run", { body: {} });
    setRunning(false);
    if (error) toast.error(error.message);
    else { toast.success("Navigation integrity refreshed"); refreshLatest(); }
  };

  // Role-based filtering: drop any item whose `roles` list excludes the user.
  const visibleSections = React.useMemo(() => {
    const out = {} as Record<AdminSection, typeof sections[AdminSection]>;
    (Object.keys(sections) as AdminSection[]).forEach(k => {
      out[k] = sections[k].filter(i =>
        i.roles.length === 0 || i.roles.some(r => roles?.includes(r))
      );
    });
    return out;
  }, [sections, roles]);

  // Auto-apply focus as a filter so the user lands on the target tile.
  React.useEffect(() => {
    if (focusPath && !q) setQ(focusPath);
  }, [focusPath, q]);

  return (
    <div className="space-y-6">
      {focusFile && (
        <Card className="border-status-warning/40 bg-status-warning/5">
          <CardContent className="pt-6 flex items-start gap-3">
            <FileCode className="h-5 w-5 text-status-warning mt-0.5" />
            <div className="flex-1 text-sm">
              <div className="font-medium">Remediation target from Integrity Report</div>
              <code className="text-xs">{focusFile}:{focusLine}</code>
              <p className="text-xs text-muted-foreground mt-1">
                Open this file in your editor and bind the flagged button to an action / target.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className={latest ? (latest.passed ? "border-status-success/40" : "border-destructive/40") : ""}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              {latest?.passed ? <CheckCircle2 className="h-4 w-4 text-status-success" />
                              : <AlertTriangle className="h-4 w-4 text-destructive" />}
              Navigation integrity — {latest ? (latest.passed ? "passing" : "failing") : "no runs yet"}
            </span>
            {latest && (
              <span className="text-xs font-normal text-muted-foreground">
                {new Date(latest.ran_at).toLocaleString()}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {latest ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4 text-sm">
              <Metric label="Dead" value={latest.dead_routes} bad={latest.dead_routes > 0} />
              <Metric label="Orphans" value={latest.orphan_routes} bad={latest.orphan_routes > 25} />
              <Metric label="Mismatch" value={latest.registry_mismatch} bad={latest.registry_mismatch > 0} />
              <Metric label="Unbound" value={latest.unbound_buttons} bad={latest.unbound_buttons > 10} />
              <Metric label="No analytics" value={latest.missing_analytics} bad={latest.missing_analytics > 10} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mb-4">Click <strong>Run now</strong> to populate.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={runNow} disabled={running}>
              <Play className="h-4 w-4 mr-1" /> {running ? "Running…" : "Run now"}
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/admin/integrity-report"><ShieldCheck className="h-4 w-4 mr-1" /> Full report</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/admin/integrity-gates"><SlidersHorizontal className="h-4 w-4 mr-1" /> Gate thresholds</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/admin/integrity-audit"><History className="h-4 w-4 mr-1" /> Threshold audit</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/admin/cta-analytics"><MousePointerClick className="h-4 w-4 mr-1" /> CTA analytics</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Input
        placeholder="Filter pages…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />

      <div className="grid gap-6 md:grid-cols-2">
        {(Object.keys(SECTION_LABELS) as AdminSection[]).map((key) => {
          const items = visibleSections[key].filter(i =>
            !q || i.title.toLowerCase().includes(q.toLowerCase()) || i.path.toLowerCase().includes(q.toLowerCase())
          );
          if (items.length === 0 && q) return null;

          return (
            <Card key={key}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{SECTION_LABELS[key].label}</span>
                  <Badge variant="secondary">{items.length}</Badge>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{SECTION_LABELS[key].desc}</p>
              </CardHeader>
              <CardContent>
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No pages.</p>
                ) : (
                  <ul className="space-y-1">
                    {items.map(item => {
                      const isFocus = item.path === focusPath;
                      return (
                        <li key={item.path}>
                          <Link
                            ref={isFocus ? focusRef : undefined}
                            to={item.path}
                            data-focus={isFocus || undefined}
                            className={`flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted transition-colors ${
                              isFocus ? "ring-2 ring-status-warning/30 bg-status-warning/10" : ""
                            }`}
                          >
                            <span className="text-sm font-medium">{item.title}</span>
                            <div className="flex items-center gap-2">
                              {item.status !== "active" && (
                                <Badge variant="outline" className="text-xs">{item.status}</Badge>
                              )}
                              {item.criticality === "critical" && (
                                <Badge variant="destructive" className="text-xs">critical</Badge>
                              )}
                              <code className="text-xs text-muted-foreground">{item.path}</code>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, bad }: { label: string; value: number; bad: boolean }) {
  return (
    <div className={`rounded border p-2 ${bad ? "border-destructive/40 bg-destructive/5" : ""}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${bad ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}
