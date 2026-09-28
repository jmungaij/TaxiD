/**
 * Phase 2 — Operations Command.
 *
 * One surface that proves the operating system, rather than describing it:
 * system of record coverage (probed live), the authority matrix, every
 * lifecycle state machine, the notification rule set, seeded scenario
 * executability, zero-trust observations, the calculated readiness scorecard
 * and the derived production blocker register.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StaffPageHeader, StaffSection, FlowChain } from "@/components/staff/primitives";
import { useAuth } from "@/hooks/useAuth";
import {
  AUTHORITY_ACTIONS, AUTHORITY_SUBJECTS, authorityGrid, VERDICT_MARK,
  CANONICAL_ENTITIES, DOMAIN_LABEL, RECORD_DOMAINS,
  LIFECYCLES, ORCHESTRATION_LOOP,
  NOTIFICATION_RULES,
  SEED_SCENARIOS, ZERO_TRUST_PROBES,
  computeReadiness, deriveBlockers, overallReadiness, probeRecordCoverage,
  productionVerdict, scenarioStatus,
  type Coverage,
} from "@/lib/staff/phase2";
import { MATRIX_ROLES, ROLE_LABEL } from "@/lib/corporate/adminCapabilities";

const SEVERITY_TONE: Record<string, string> = {
  P0: "border-destructive/50 text-destructive",
  P1: "border-warning/50 text-warning",
  P2: "border-info/50 text-info",
  P3: "border-muted-foreground/30 text-muted-foreground",
};

export default function StaffOperations() {
  const { roles } = useAuth();
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    probeRecordCoverage().then((c) => {
      if (!alive) return;
      setCoverage(c);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [nonce]);

  const scores = useMemo(() => (coverage ? computeReadiness(coverage) : []), [coverage]);
  const blockers = useMemo(() => (coverage ? deriveBlockers(coverage, scores) : []), [coverage, scores]);
  const overall = useMemo(() => overallReadiness(scores), [scores]);
  const verdict = useMemo(() => productionVerdict(blockers), [blockers]);
  const grid = useMemo(() => authorityGrid(), []);

  return (
    <div>
      <StaffPageHeader
        eyebrow="Phase 2 — Operationalisation"
        title="Operations Command"
        lede="Every entity has an owner, every workflow a state, every state an action, every action an authority basis, and every consequential action an audit trail. Scores below are calculated from acceptance criteria — never asserted."
        actions={
          <Button variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Re-run audit
          </Button>
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">Business readiness (calculated)</div>
            <div className="mt-1 text-3xl font-bold">{loading ? "—" : `${overall}%`}</div>
            <Progress value={overall} className="mt-3" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">Production verdict</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
              {verdict.ready ? <ShieldCheck className="h-4 w-4 text-primary" /> : <ShieldAlert className="h-4 w-4 text-destructive" />}
              {loading ? "Auditing…" : verdict.ready ? "Ready" : "Not ready"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{loading ? "Probing systems of record" : verdict.reason}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">Blockers by severity</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(["P0", "P1", "P2", "P3"] as const).map((s) => (
                <Badge key={s} variant="outline" className={SEVERITY_TONE[s]}>
                  {s}: {blockers.filter((b) => b.severity === s).length}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="records">
        <TabsList className="mb-6 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="records">System of record</TabsTrigger>
          <TabsTrigger value="authority">Authority</TabsTrigger>
          <TabsTrigger value="lifecycles">Lifecycles</TabsTrigger>
          <TabsTrigger value="signals">Notifications</TabsTrigger>
          <TabsTrigger value="scenarios">Scenarios & zero trust</TabsTrigger>
          <TabsTrigger value="readiness">Readiness</TabsTrigger>
          <TabsTrigger value="blockers">Blockers</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------ system of record */}
        <TabsContent value="records">
          {RECORD_DOMAINS.map((domain) => (
            <StaffSection key={domain} title={DOMAIN_LABEL[domain]} description="Canonical entity → accountable owner → authoritative table → governing lifecycle.">
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Entity</th>
                      <th className="px-3 py-2 text-left">Owner</th>
                      <th className="px-3 py-2 text-left">System of record</th>
                      <th className="px-3 py-2 text-left">Rows</th>
                      <th className="px-3 py-2 text-left">Lifecycle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CANONICAL_ENTITIES.filter((e) => e.domain === domain).map((e) => {
                      const probe = e.table && coverage ? coverage[e.table] : undefined;
                      return (
                        <tr key={e.key} className="border-t">
                          <td className="px-3 py-2 font-medium">{e.label}</td>
                          <td className="px-3 py-2 text-muted-foreground">{e.owner}</td>
                          <td className="px-3 py-2 font-mono text-xs">{e.table ?? "—"}</td>
                          <td className="px-3 py-2 text-xs">
                            {!e.table ? (
                              <Badge variant="outline" className="text-muted-foreground">DATA NOT AVAILABLE</Badge>
                            ) : loading ? "…" : probe?.rows === null || probe === undefined ? (
                              <Badge variant="outline" className="border-destructive/50 text-destructive">unreadable</Badge>
                            ) : probe.rows}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{e.lifecycle ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {CANONICAL_ENTITIES.filter((e) => e.domain === domain && e.note).map((e) => (
                <p key={e.key} className="mt-2 text-xs text-muted-foreground">{e.label}: {e.note}</p>
              ))}
            </StaffSection>
          ))}
        </TabsContent>

        {/* ------------------------------------------------------- authority */}
        <TabsContent value="authority">
          <StaffSection
            title="TaxiD Authority Matrix"
            description="✓ permitted · ✓* permitted under a configurable condition · — denied. The UI never offers an action this matrix denies; row-level security and the privileged-update function remain the enforcement boundary."
          >
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Role</th>
                    <th className="px-3 py-2 text-left">Object</th>
                    {AUTHORITY_ACTIONS.map((a) => (
                      <th key={a} className="px-3 py-2 text-left capitalize">{a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MATRIX_ROLES.flatMap((role) =>
                    AUTHORITY_SUBJECTS.map((s, i) => (
                      <tr key={`${role}-${s.key}`} className="border-t">
                        <td className="px-3 py-2 text-xs text-muted-foreground">{i === 0 ? ROLE_LABEL[role] : ""}</td>
                        <td className="px-3 py-2">{s.label}</td>
                        {AUTHORITY_ACTIONS.map((a) => (
                          <td key={a} className="px-3 py-2 font-mono text-xs">{VERDICT_MARK[grid[role][s.key][a]]}</td>
                        ))}
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Your roles: {roles.length ? roles.join(", ") : "none"} — actions elsewhere in the portal are gated by this evaluation.
            </p>
          </StaffSection>
        </TabsContent>

        {/* ------------------------------------------------------ lifecycles */}
        <TabsContent value="lifecycles">
          <StaffSection title="Final orchestration loop" description="Phase 2 operationalises this cycle end to end.">
            <FlowChain steps={ORCHESTRATION_LOOP} />
          </StaffSection>
          {LIFECYCLES.map((lc) => (
            <StaffSection key={lc.key} title={lc.label} description={`Record: ${lc.table ?? "no system of record yet"} · Produces: ${lc.output}`}>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">State</th>
                      <th className="px-3 py-2 text-left">Action out</th>
                      <th className="px-3 py-2 text-left">Authority</th>
                      <th className="px-3 py-2 text-left">Gate</th>
                      <th className="px-3 py-2 text-left">Next</th>
                      <th className="px-3 py-2 text-left">Audit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lc.states.map((st) => (
                      <tr key={st.key} className="border-t align-top">
                        <td className="px-3 py-2 font-medium">{st.label}</td>
                        <td className="px-3 py-2 text-muted-foreground">{st.action ?? (st.next.length ? "—" : "Terminal")}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {st.authority ? `${st.authority.subject}:${st.authority.action}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{st.gate ?? "—"}</td>
                        <td className="px-3 py-2 text-xs font-mono">{st.next.join(", ") || "—"}</td>
                        <td className="px-3 py-2 text-xs">{st.audited ? "required" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </StaffSection>
          ))}
        </TabsContent>

        {/* --------------------------------------------------- notifications */}
        <TabsContent value="signals">
          <StaffSection title="Notification Engine" description="Event → Rule → Notification → Action → Audit. A rule without a source event cannot fire and is registered as a blocker rather than shown as an alert.">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Domain</th>
                    <th className="px-3 py-2 text-left">Event</th>
                    <th className="px-3 py-2 text-left">Source</th>
                    <th className="px-3 py-2 text-left">Condition</th>
                    <th className="px-3 py-2 text-left">Notifies</th>
                    <th className="px-3 py-2 text-left">Action</th>
                    <th className="px-3 py-2 text-left">Audit</th>
                  </tr>
                </thead>
                <tbody>
                  {NOTIFICATION_RULES.map((r) => (
                    <tr key={r.key} className="border-t align-top">
                      <td className="px-3 py-2">{r.domain}</td>
                      <td className="px-3 py-2 font-medium">{r.event}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.source ?? <Badge variant="outline" className="border-info/50 text-info">not wired</Badge>}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.condition}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.notify}</td>
                      <td className="px-3 py-2 text-xs">{r.action}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.audit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </StaffSection>
        </TabsContent>

        {/* ------------------------------------------- scenarios & zero trust */}
        <TabsContent value="scenarios">
          <StaffSection title="Seeded scenario validation" description="A scenario is executable only when every record class in its chain is readable for the signed-in identity — no manual database intervention.">
            <div className="grid gap-4 md:grid-cols-2">
              {SEED_SCENARIOS.map((sc) => {
                const st = coverage ? scenarioStatus(sc, coverage) : { executable: false, missing: [] };
                return (
                  <Card key={sc.key}>
                    <CardContent className="pt-5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold">{sc.label}</div>
                        <Badge variant="outline" className={st.executable ? "border-primary/50 text-primary" : "border-destructive/50 text-destructive"}>
                          {loading ? "…" : st.executable ? "Executable" : "Blocked"}
                        </Badge>
                      </div>
                      <div className="mt-3"><FlowChain steps={sc.chain} /></div>
                      {!loading && st.missing.length > 0 && (
                        <p className="mt-3 text-xs text-destructive">Unreadable: {st.missing.join(", ")}</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </StaffSection>

          <StaffSection title="Zero-trust observations" description="Observed read result for the signed-in identity. A denial here is correct behaviour when the scope does not apply to you; enforcement is server-side.">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Attempted access</th>
                    <th className="px-3 py-2 text-left">Expectation</th>
                    <th className="px-3 py-2 text-left">Observed</th>
                  </tr>
                </thead>
                <tbody>
                  {ZERO_TRUST_PROBES.map((p) => {
                    const probe = coverage?.[p.table];
                    return (
                      <tr key={p.table} className="border-t">
                        <td className="px-3 py-2">{p.label}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{p.expectation}</td>
                        <td className="px-3 py-2 text-xs">
                          {loading || !coverage ? "…" : probe === undefined ? "not probed" : probe.rows === null ? "denied server-side" : `readable (${probe.rows} rows)`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </StaffSection>
        </TabsContent>

        {/* ------------------------------------------------------- readiness */}
        <TabsContent value="readiness">
          <StaffSection title="Business readiness scorecard" description="Each domain score is met criteria ÷ total criteria. Criteria that Phase 3 must satisfy count as unmet, which is why domains legitimately score below 100%.">
            <div className="space-y-4">
              {scores.map((d) => (
                <Card key={d.domain}>
                  <CardContent className="pt-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">{d.domain}</div>
                      <div className="text-sm font-mono">{d.score}% <span className="text-muted-foreground">({d.met}/{d.total})</span></div>
                    </div>
                    <Progress value={d.score} className="mt-2" />
                    <ul className="mt-3 space-y-1 text-xs">
                      {d.criteria.map((c) => (
                        <li key={c.label} className={c.met ? "text-muted-foreground" : "text-destructive"}>
                          {c.met ? "✓" : "✗"} {c.label} — <span className="font-mono">{c.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
              {loading && <p className="text-sm text-muted-foreground">Probing systems of record…</p>}
            </div>
          </StaffSection>
        </TabsContent>

        {/* -------------------------------------------------------- blockers */}
        <TabsContent value="blockers">
          <StaffSection title="Production readiness command" description="P0 — cannot safely operate · P1 — core process unreliable · P2 — degraded · P3 — minor. Production cannot be declared ready while P0 or P1 items remain.">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Severity</th>
                    <th className="px-3 py-2 text-left">Domain</th>
                    <th className="px-3 py-2 text-left">Blocker</th>
                    <th className="px-3 py-2 text-left">Impact</th>
                    <th className="px-3 py-2 text-left">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {blockers.map((b) => (
                    <tr key={b.id} className="border-t align-top">
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={SEVERITY_TONE[b.severity]}>{b.severity}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{b.domain}</td>
                      <td className="px-3 py-2 font-medium">{b.title}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{b.impact}</td>
                      <td className="px-3 py-2 text-xs">{b.owner}</td>
                    </tr>
                  ))}
                  {!loading && blockers.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">No blockers recorded.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </StaffSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}
