/**
 * SAFARID PARTNERS 360 — one partner journey, drill-through.
 *
 * Everything one visitor session did on the SAFARID Partners experience, in order:
 * which messaging frames they read, what they said they bring, the category and
 * maturity level they chose, the lifecycle stages they opened, the messaging arm
 * they were shown, and every CTA they clicked. Alongside it, the staff work this
 * journey actually raised — the lifecycle signals recorded server-side and the
 * partner intent profile, when the visitor went on to apply.
 *
 * Read-only, counted, staff-scoped by row-level authorisation.
 */
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileDown, Route, Sheet } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { LifecycleAuditPanel, ProfileHistoryPanel } from "@/components/staff/partners/PartnerStatePanels";
import { PartnerTimelineDiffPanel } from "@/components/staff/partners/PartnerTimelineDiff";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import type { RawCtaEvent } from "@/lib/partners/funnelAnalytics";
import { buildJourneys, findJourney, labelOf, type DrillKey } from "@/lib/partners/journeyDrill";
import { exportPartnerAuditCsv, exportPartnerAuditPdf } from "@/lib/partners/auditExport";
import { listLifecycleAudit, listProfileHistory } from "@/lib/partners/history";


interface LifecycleSignalRow {
  id: string;
  lifecycle_stage: string;
  maturity_level: string | null;
  network_category: string | null;
  intent_bring: string | null;
  ab_variant: string | null;
  created_at: string;
  work_item_id: string | null;
}

interface IntentProfileRow {
  id: string;
  contact_email: string;
  organisation_name: string | null;
  intent_bring: string | null;
  network_category: string | null;
  maturity_level: string | null;
  lifecycle_stage: string | null;
  ab_variant: string | null;
  application_count: number;
  updated_at: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

async function fetchJourneyEvents(sessionId: string, days: number): Promise<RawCtaEvent[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("cta_events")
    .select("button_name, action_type, target, page_source, session_id, clicked_at, metadata")
    .eq("session_id", sessionId)
    .gte("clicked_at", since)
    .order("clicked_at", { ascending: true })
    .limit(2_000);
  if (error) throw new Error(error.message);
  return (data ?? []) as RawCtaEvent[];
}

async function fetchSignals(sessionId: string): Promise<LifecycleSignalRow[]> {
  const { data, error } = await db
    .from("partner_lifecycle_signals")
    .select("id, lifecycle_stage, maturity_level, network_category, intent_bring, ab_variant, created_at, work_item_id")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as LifecycleSignalRow[];
}

async function fetchProfile(sessionId: string): Promise<IntentProfileRow | null> {
  const { data, error } = await db
    .from("partner_intent_profiles")
    .select("id, contact_email, organisation_name, intent_bring, network_category, maturity_level, lifecycle_stage, ab_variant, application_count, updated_at")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as IntentProfileRow | null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const STEP_TONE: Record<string, string> = {
  view: "bg-muted text-muted-foreground",
  interact: "bg-primary/10 text-primary",
  cta: "bg-status-success/15 text-status-success",
};

export default function PartnerJourneyDetail() {
  const { sessionId = "" } = useParams();
  const [params] = useSearchParams();
  const days = Number(params.get("days") ?? "30") || 30;

  const eventsQuery = useQuery({
    queryKey: ["yp-journey-events", sessionId, days],
    queryFn: () => fetchJourneyEvents(sessionId, days),
    enabled: Boolean(sessionId),
  });
  const signalsQuery = useQuery({
    queryKey: ["yp-journey-signals", sessionId],
    queryFn: () => fetchSignals(sessionId),
    enabled: Boolean(sessionId),
  });
  const profileQuery = useQuery({
    queryKey: ["yp-journey-profile", sessionId],
    queryFn: () => fetchProfile(sessionId),
    enabled: Boolean(sessionId),
  });

  const journey = useMemo(() => {
    const all = buildJourneys(eventsQuery.data ?? []);
    return findJourney(all, sessionId);
  }, [eventsQuery.data, sessionId]);

  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

  const runExport = async (kind: "csv" | "pdf") => {
    setExporting(kind);
    try {
      const profile = profileQuery.data;
      const [audit, history] = await Promise.all([
        listLifecycleAudit(sessionId),
        profile ? listProfileHistory(profile.id) : Promise.resolve([]),
      ]);
      const input = {
        sessionId,
        audit,
        history,
        organisation: profile?.organisation_name ?? null,
        contactEmail: profile?.contact_email ?? null,
      };
      if (kind === "csv") {
        const count = exportPartnerAuditCsv(input);
        toast.success("Audit log exported", { description: `${count} records written to CSV.` });
      } else {
        await exportPartnerAuditPdf(input);
        toast.success("Audit report exported", { description: `${audit.length} stage moves in the PDF report.` });
      }
    } catch (err) {
      toast.error("Could not export the audit log", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setExporting(null);
    }
  };

  if (eventsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const attributes: Array<[DrillKey, string | undefined, string]> = [
    ["bring", journey?.bring, "What they bring"],
    ["category", journey?.category, "Partner category"],
    ["level", journey?.level, "Maturity level"],
    ["variant", journey?.variant, "Messaging variant"],
  ];

  return (
    <div className="space-y-6">
      <StaffPageHeader
        title="Partner journey"
        eyebrow="SAFARID Partners 360"
        lede={`Everything this session did on the SAFARID Partners experience, in order, over the last ${days} days.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runExport("csv")}
              disabled={exporting !== null}
            >
              <Sheet className="mr-2 h-4 w-4" aria-hidden />
              {exporting === "csv" ? "Exporting…" : "Audit log CSV"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runExport("pdf")}
              disabled={exporting !== null}
            >
              <FileDown className="mr-2 h-4 w-4" aria-hidden />
              {exporting === "pdf" ? "Building…" : "Audit log PDF"}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/staff/partners/funnel">
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Back to funnel
              </Link>
            </Button>
          </div>
        }
      />


      {!journey ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No partner events recorded for this session in the last {days} days.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Route className="h-4 w-4" aria-hidden /> Declared context
              </CardTitle>
              <CardDescription>
                First seen {new Date(journey.firstSeen).toLocaleString()} · last activity{" "}
                {new Date(journey.lastSeen).toLocaleString()} · {journey.counts.view} views,{" "}
                {journey.counts.interact} interactions, {journey.counts.cta} CTA clicks
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {attributes.map(([key, value, label]) => (
                <div key={key}>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-1 text-sm font-medium">{labelOf(key, value)}</p>
                </div>
              ))}
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Frames read</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {journey.frames.length === 0
                    ? <span className="text-sm text-muted-foreground">—</span>
                    : journey.frames.map((f) => <Badge key={f} variant="outline">{labelOf("frame", f)}</Badge>)}
                </div>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Lifecycle stages opened</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {journey.stages.length === 0
                    ? <span className="text-sm text-muted-foreground">—</span>
                    : journey.stages.map((s) => <Badge key={s} variant="outline">{labelOf("stage", s)}</Badge>)}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Staff work raised by this journey</CardTitle>
              <CardDescription>
                Lifecycle stage signals recorded server-side, one per stage, each raising a partner-desk task.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(signalsQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No lifecycle signals recorded for this session.</p>
              ) : (
                <ul className="space-y-2">
                  {(signalsQuery.data ?? []).map((s) => (
                    <li key={s.id} className="rounded-xl border border-border bg-card p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{labelOf("stage", s.lifecycle_stage)}</Badge>
                        <span className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()}</span>
                        {s.work_item_id && <Badge variant="secondary">Task raised</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[
                          s.intent_bring ? `Brings ${labelOf("bring", s.intent_bring)}` : null,
                          s.network_category ? `Category ${labelOf("category", s.network_category)}` : null,
                          s.maturity_level ? `Level ${labelOf("level", s.maturity_level)}` : null,
                          s.ab_variant ? `Variant ${labelOf("variant", s.ab_variant)}` : null,
                        ].filter(Boolean).join(" · ") || "No additional context declared"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {profileQuery.data && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Partner profile from this journey</CardTitle>
                <CardDescription>
                  Created or updated when the visitor applied — the persisted record of their intent.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Organisation</p>
                  <p className="mt-1 font-medium">{profileQuery.data.organisation_name ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Contact email</p>
                  <p className="mt-1 font-medium">{profileQuery.data.contact_email}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Applications</p>
                  <p className="mt-1 font-medium tabular-nums">{profileQuery.data.application_count}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Intent</p>
                  <p className="mt-1 font-medium">{labelOf("bring", profileQuery.data.intent_bring ?? undefined)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Category</p>
                  <p className="mt-1 font-medium">{labelOf("category", profileQuery.data.network_category ?? undefined)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Level · stage</p>
                  <p className="mt-1 font-medium">
                    {labelOf("level", profileQuery.data.maturity_level ?? undefined)} ·{" "}
                    {labelOf("stage", profileQuery.data.lifecycle_stage ?? undefined)}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <LifecycleAuditPanel sessionId={sessionId} />

          <PartnerTimelineDiffPanel sessionId={sessionId} />


          {profileQuery.data && (
            <ProfileHistoryPanel
              profileId={profileQuery.data.id}
              onReverted={() => void profileQuery.refetch()}
            />
          )}


          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
              <CardDescription>Every captured event for this session, oldest first.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Journey timeline</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-2 pr-4 font-semibold">When</th>
                      <th scope="col" className="py-2 pr-4 font-semibold">Step</th>
                      <th scope="col" className="py-2 pr-4 font-semibold">Event</th>
                      <th scope="col" className="py-2 pr-4 font-semibold">Target</th>
                      <th scope="col" className="py-2 font-semibold">Context</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journey.events.map((e, i) => (
                      <tr key={`${e.at}-${i}`} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-4 whitespace-nowrap">{new Date(e.at).toLocaleTimeString()}</td>
                        <td className="py-2 pr-4">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STEP_TONE[e.step]}`}>{e.step}</span>
                        </td>
                        <td className="py-2 pr-4">{e.buttonName}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{e.target ?? "—"}</td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {(Object.entries(e.attributes) as Array<[DrillKey, string]>)
                            .map(([k, v]) => `${k}: ${labelOf(k, v)}`)
                            .join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
