import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import WorkItemDrawer from "@/components/staff/ops/WorkItemDrawer";
import {
  PriorityBadge,
  QueueBadge,
  SlaBadge,
  StateBadge,
  EntityRef,
} from "@/components/staff/ops/opsPrimitives";
import { PriorityBreakdownPanel } from "@/components/staff/workspace/PriorityBreakdown";
import { FocusModeDialog } from "@/components/staff/workspace/FocusModeDialog";
import { OutcomeDialog } from "@/components/staff/workspace/OutcomeDialog";
import { IdentityGate } from "@/components/staff/workspace/IdentityGate";
import { WorkspaceEmptyState } from "@/components/staff/workspace/WorkspaceEmptyState";
import { AskYalla } from "@/components/staff/workspace/AskYalla";
import {
  ClearDayPanel,
  FocusNowPanel,
  NextBestActionPanel,
} from "@/components/staff/workspace/FocusNow";
import { TodayTimeline } from "@/components/staff/workspace/TodayTimeline";
import {
  ProgressPanel,
  QuickWinsPanel,
  WorkloadHealthPanel,
} from "@/components/staff/workspace/TimePanels";
import {
  BlockedWorkPanel,
  WaitingOnPanel,
  type BlockedActionHandlers,
} from "@/components/staff/workspace/BlockedPanels";
import { BlockedAuditDrawer } from "@/components/staff/workspace/BlockedAuditDrawer";
import {
  ShortcutHelpOverlay, useShortcutHelpToggle,
} from "@/components/staff/workspace/ShortcutHelpOverlay";
import { NotificationBell } from "@/components/staff/org/NotificationBell";
import { PrepareTomorrowPanel } from "@/components/staff/workspace/PrepareTomorrowPanel";
import { CapacityDecisionPanel } from "@/components/staff/workspace/CapacityDecisionPanel";
import { CreateWorkDialog } from "@/components/staff/workspace/CreateWorkDialog";
import { AvailableCapacityPanel } from "@/components/staff/workspace/AvailableCapacityPanel";
import { NextBestActionsPanel } from "@/components/staff/workspace/NextBestActionsPanel";

import { StartMyDayDialog } from "@/components/staff/workspace/StartMyDayDialog";
import { RelationshipMemoryPanel } from "@/components/staff/workspace/RelationshipMemoryPanel";
import { SalesDayCloseCard } from "@/components/staff/SalesDayCloseCard";
import { rankNextBestActions, type RankedAction } from "@/lib/workspace/ranking";
import {
  actionToWork,
  createSelfWork,
  fetchAvailableActions,
  type AvailableAction,
} from "@/lib/workspace/workEngine";

import {
  ApprovalsPanel,
  LiveStamp,
  SinceLastSessionPanel,
} from "@/components/staff/workspace/CockpitPanels";
import LeadRemindersPanel from "@/components/sales/LeadRemindersPanel";
import {
  CommitmentTracker,
  CustomerWaitingQueue,
  MomentumPanel,
  DayCloseCard,
} from "@/components/staff/workspace/RelationshipPanels";
import { ReportExportMenu } from "@/components/executive/ReportExportMenu";
import { usePersonalWorkspace } from "@/hooks/usePersonalWorkspace";
import {
  availableMinutes as unplannedMinutes,
  blockedWork,
  dayPhase,
  discretionaryOptions,
  fulfilCommitment,
  greetingFor,
  headerMoment,
  nextBestAction,
  quickWins,
  timeToday,
  todayProgress,
  todayTimeline,
  waitingOn,
  workloadHealth,
} from "@/lib/workspace";
import { toast } from "@/hooks/use-toast";
import { BUCKET_LABEL, WORKSPACE_BUCKETS, type WorkspaceBucket } from "@/lib/orchestration/workLifecycle";
import type { DecoratedWork } from "@/lib/orchestration/api";

/**
 * MY WORKSPACE — the employee's Personal Operating System.
 *
 * Hierarchy is deliberate and unequal: FOCUS NOW dominates, then next best
 * action and the live timeline, then friction (waiting / blocked / decisions),
 * then supporting signals (progress, workload, momentum) and the day close.
 *
 * Every surface reads authoritative records through the existing orchestration,
 * CRM and workspace engines. Identity is resolved server-side first; when it
 * cannot be resolved the cockpit withholds personal data.
 */
export default function MyWorkspace() {
  const {
    identity,
    loading,
    error,
    partial,
    reload,
    work,
    scored,
    plan,
    replan,
    acceptReplan,
    focus,
    confidence,
    health,
    waiting,
    momentum,
    close,
    commitments,
    approvals,
    changes,
    roleProfile,
    recordOutcome,
    ask,
    activeFocus,
    focusBusy,
    beginFocus,
    finishFocus,
    blockedBusy,
    resolveBlocked,
    requestDecision,
    tomorrow,
    commercialReplan,
    carryBusy,
    carryForward,
    lastUpdatedAt,
    dayCloseReport,
    nextActions,
    salesClose,
    salesBusy,
    placeSalesActions,
    demand,
    capacityProfile,
    outstanding,
    dispositionBusy,
    decideWork,
  } = usePersonalWorkspace();

  const [selected, setSelected] = useState<DecoratedWork | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<DecoratedWork | null>(null);
  const [outcomeBusy, setOutcomeBusy] = useState(false);
  const [auditFor, setAuditFor] = useState<string | null>(null);
  const askRef = useRef<HTMLDivElement | null>(null);
  const [askSeed, setAskSeed] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [capacityKey, setCapacityKey] = useState(0);
  const [available, setAvailable] = useState<AvailableAction[]>([]);
  const [availableLoading, setAvailableLoading] = useState(true);
  const [startBusyKey, setStartBusyKey] = useState<string | null>(null);
  const [dayOpen, setDayOpen] = useState(false);
  const [dayBusy, setDayBusy] = useState(false);
  const [memoryKey, setMemoryKey] = useState(0);


  const openWorkById = useCallback(
    (id: string) => {
      const found = work.find((w) => w.id === id);
      if (found) setSelected(found);
    },
    [work],
  );

  const onEnterFocus = useCallback(
    async (id: string) => {
      const res = await beginFocus(id);
      if (!res.ok) toast({ title: "Could not start focus", description: res.error, variant: "destructive" });
    },
    [beginFocus],
  );

  const onFinishFocus = useCallback(
    async (opts: { outcomeNote?: string; completed?: boolean; interrupted?: boolean }) => {
      const res = await finishFocus(opts);
      if (!res.ok) {
        toast({ title: "Could not close the session", description: res.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Work recorded",
        description: "Your work inbox has been updated.",
      });
    },
    [finishFocus],
  );

  /* ------------------------------------- blocked work: resolve / decision */

  const onResolveBlocked = useCallback(
    async (workId: string, reason: string) => {
      const res = await resolveBlocked(workId, reason);
      toast(
        res.ok
          ? { title: "Blocker cleared", description: "The item is back in progress and re-prioritised." }
          : { title: "Could not resolve", description: res.error, variant: "destructive" },
      );
    },
    [resolveBlocked],
  );

  const onRequestDecision = useCallback(
    async (workId: string, reason: string) => {
      const res = await requestDecision(workId, reason);
      toast(
        res.ok
          ? {
              title: "Decision requested",
              description: "The authorised decision owners have been alerted with this item.",
            }
          : { title: "Could not request a decision", description: res.error, variant: "destructive" },
      );
    },
    [requestDecision],
  );

  const blockedHandlers: BlockedActionHandlers = useMemo(
    () => ({
      onResolve: onResolveBlocked,
      onRequestDecision,
      onOpenAudit: (id: string) => setAuditFor(id),
      busyId: blockedBusy,
    }),
    [onResolveBlocked, onRequestDecision, blockedBusy],
  );

  const onCarryForward = useCallback(
    async (workIds: string[], reason?: string) => {
      const res = await carryForward(workIds, reason);
      toast(
        res.ok
          ? {
              title: `${res.carried} item${res.carried === 1 ? "" : "s"} carried into tomorrow`,
              description: "Tomorrow's date and your reason are recorded on each work item.",
            }
          : { title: "Could not carry work forward", description: res.error, variant: "destructive" },
      );
    },
    [carryForward],
  );

  /**
   * SAVE & NEXT — the outcome is written atomically server-side, then the
   * cockpit immediately launches the highest-ranked remaining action so the
   * employee never returns to an empty screen to decide what to do.
   */
  const advanceRef = useRef<((excludeWorkId: string | null) => Promise<void>) | null>(null);

  const onRecordOutcome = useCallback(
    async (input: Parameters<typeof recordOutcome>[1] & { advance?: boolean }) => {
      if (!outcomeFor) return;
      const resolvedId = outcomeFor.id;
      setOutcomeBusy(true);
      const res = await recordOutcome(resolvedId, input);
      setOutcomeBusy(false);
      if (!res.ok) {
        toast({ title: "Could not record the outcome", description: res.error, variant: "destructive" });
        return;
      }
      setOutcomeFor(null);
      setMemoryKey((k) => k + 1);
      toast({
        title: `Outcome recorded: ${input.outcome}`,
        description: res.nextActionTitle
          ? `Next action created — ${res.nextActionTitle}`
          : "The business process has been advanced.",
      });
      if (input.advance) await advanceRef.current?.(resolvedId);
    },
    [outcomeFor, recordOutcome],
  );


  const onFulfil = useCallback(
    async (id: string) => {
      const res = await fulfilCommitment(id, { kind: "staff_confirmation" });
      if (!res.ok) {
        toast({ title: "Could not record the promise", description: res.error, variant: "destructive" });
        return;
      }
      toast({ title: "Promise recorded as kept" });
      void reload();
    },
    [reload],
  );

  const onRefresh = useCallback(async () => {
    await reload();
  }, [reload]);


  /**
   * SELF-ASSIGNED WORK — created work is reloaded into the queue immediately and
   * opened so the employee can start executing without another click.
   */
  const onWorkCreated = useCallback(
    async (_workItemId: string) => {
      await reload();
      setCapacityKey((k) => k + 1);
      toast({
        title: "Added to your day",
        description: "It has been prioritised with the rest of your work.",
      });
    },
    [reload],
  );

  const askAbout = useCallback((q: string) => {
    setAskSeed(q);
    askRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const openOutcomeFor = useCallback(
    (id: string) => {
      const found = work.find((w) => w.id === id);
      if (found) setOutcomeFor(found);
    },
    [work],
  );

  /* ------------------------------------------- available (unowned) capacity */

  const loadAvailable = useCallback(async () => {
    setAvailableLoading(true);
    try {
      setAvailable(await fetchAvailableActions(8));
    } catch {
      setAvailable([]);
    } finally {
      setAvailableLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAvailable();
  }, [loadAvailable, capacityKey]);

  /* --------------------------------------------------- derived productivity */



  const phase = useMemo(() => dayPhase(), []);
  const windowMinutes = useMemo(() => unplannedMinutes(plan), [plan]);
  const time = useMemo(() => timeToday(plan), [plan]);
  const workload = useMemo(() => workloadHealth(plan, scored), [plan, scored]);
  const progress = useMemo(() => todayProgress(work, plan), [work, plan]);
  const timeline = useMemo(() => todayTimeline(plan, work), [plan, work]);
  const blocked = useMemo(() => blockedWork(work), [work]);
  const waitingOnItems = useMemo(() => waitingOn(work), [work]);
  const wins = useMemo(() => quickWins(scored, windowMinutes || 30), [scored, windowMinutes]);

  /**
   * KEYBOARD EXECUTION — F starts focus on the recommended item, E completes the
   * running session, R resolves the top blocker, D requests a decision on it.
   * Shortcuts stay inert while the user is typing or a dialog owns the focus.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return;
      if (document.querySelector("[role=dialog]") && e.key.toLowerCase() !== "e") return;

      const key = e.key.toLowerCase();
      if (key === "f" && !activeFocus && focus) {
        e.preventDefault();
        void onEnterFocus(focus.scored.work.id);
        return;
      }
      if (key === "e" && activeFocus) {
        e.preventDefault();
        void onFinishFocus({ completed: true });
        return;
      }
      const top = blocked[0] ?? waitingOnItems[0];
      if (!top || activeFocus) return;
      if (key === "r") {
        e.preventDefault();
        void onResolveBlocked(top.work.id, "Cleared from the cockpit keyboard shortcut");
      } else if (key === "d") {
        e.preventDefault();
        void onRequestDecision(top.work.id, "Decision requested from the cockpit keyboard shortcut");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeFocus,
    focus,
    blocked,
    waitingOnItems,
    onEnterFocus,
    onFinishFocus,
    onResolveBlocked,
    onRequestDecision,
  ]);
  const nba = useMemo(
    () =>
      nextBestAction(scored, {
        commitments,
        waiting,
        windowMinutes,
        skipWorkId: focus?.scored.work.id ?? null,
      }),
    [scored, commitments, waiting, windowMinutes, focus],
  );

  /**
   * RANKED NEXT BEST ACTIONS — assigned work and unowned records ranked in one
   * list, each carrying the reasons that produced its position.
   */
  const ranked = useMemo(
    () =>
      rankNextBestActions(scored, available, {
        commitments,
        waiting,
        nextActions,
        windowMinutes,
        skipWorkId: focus?.scored.work.id ?? null,
      }),
    [scored, available, commitments, waiting, nextActions, windowMinutes, focus],
  );

  /** One click to begin: focus assigned work, or claim an unowned record first. */
  const startRanked = useCallback(
    async (action: RankedAction) => {
      setStartBusyKey(action.key);
      try {
        if (action.origin === "assigned" && action.workId) {
          await onEnterFocus(action.workId);
          return;
        }
        if (!action.action) return;
        const res = await createSelfWork(actionToWork(action.action));
        if (res.ok !== true) {
          toast({ title: "Could not take this on", description: res.error, variant: "destructive" });
          return;
        }
        await reload();
        setCapacityKey((k) => k + 1);
        await onEnterFocus(res.workItemId);
        toast({ title: "Taken on and started", description: action.title });
      } finally {
        setStartBusyKey(null);
      }
    },
    [onEnterFocus, reload],
  );

  /** Wired into Save & Next so recording an outcome launches the next action. */
  useEffect(() => {
    advanceRef.current = async (excludeWorkId: string | null) => {
      const next = ranked.find((a) => a.workId !== excludeWorkId);
      if (!next) {
        toast({ title: "Nothing else is queued", description: "Your ranked list is clear." });
        return;
      }
      await startRanked(next);
    };
  }, [ranked, startRanked]);

  const focusAccount = useMemo(() => {
    const workId = activeFocus?.workId ?? focus?.scored.work.id ?? null;
    if (workId) {
      const link =
        nextActions.find((a) => a.work_item_id === workId) ??
        commitments.find((c) => c.work_item_id === workId);
      if (link) return { id: link.account_id, name: link.account_name };
    }
    const top = ranked.find((a) => a.accountId);
    return top?.accountId ? { id: top.accountId, name: top.accountName } : null;
  }, [activeFocus, focus, nextActions, commitments, ranked]);

  const clearDay = useMemo(
    () =>
      discretionaryOptions({
        stalledAccounts: momentum.filter((m) => m.state === "stalled" || m.state === "cooling").length,
        quickWins: wins.length,
        tomorrowQueued: close.tomorrowFirstThree.length,
      }),
    [momentum, wins.length, close.tomorrowFirstThree.length],
  );

  const grouped = useMemo(() => {
    const map = new Map<WorkspaceBucket, DecoratedWork[]>();
    for (const b of WORKSPACE_BUCKETS) map.set(b, []);
    for (const w of work) map.get(w.bucket)!.push(w);
    return map;
  }, [work]);

  const [helpOpen, setHelpOpen] = useShortcutHelpToggle();

  const greeting = identity?.fullName ? identity.fullName.split(" ")[0] : null;
  const withheld = !loading && identity && identity.status !== "linked";

  const onClearDayAction = useCallback(
    (action: "momentum" | "ask" | "tomorrow" | "quickwins") => {
      if (action === "ask") askAbout("What should I do next?");
      else if (action === "tomorrow") acceptReplan();
      else document.getElementById(action === "momentum" ? "supporting" : "friction")?.scrollIntoView({ behavior: "smooth" });
    },
    [askAbout, acceptReplan],
  );

  /* ------------------------------------------------------------------ header */

  const header = (
    <header className="mb-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            SAFARID Personal Operating System
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            {greeting ? `${greetingFor()}, ${greeting}` : greetingFor()}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {identity?.position
              ? `${identity.position}${identity.unit ? ` · ${identity.unit}` : ""}`
              : roleProfile.label}
            {" · "}
            {headerMoment()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> Live
          </span>
          <LiveStamp at={lastUpdatedAt} />
          {identity?.staffId && <NotificationBell staffId={identity.staffId} onChanged={onRefresh} />}
          <ReportExportMenu label="Day close report" build={dayCloseReport} disabled={loading} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHelpOpen(true)}
            aria-label="Show keyboard shortcuts"
          >
            Shortcuts (?)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDayOpen(true)} data-testid="start-my-day">
            Start my day
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            New work
          </Button>

          <Button variant="ghost" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      </div>
      {identity?.status === "linked" && (
        <p className="mt-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{phase.label}</span> · {phase.prompt} Your
          priorities are ordered for {roleProfile.label.toLowerCase()} work:{" "}
          {roleProfile.emphasis.slice(0, 4).join(" → ")}.
        </p>
      )}
    </header>
  );

  if (withheld) {
    return (
      <>
        {header}
        <IdentityGate diagnosticRef={identity?.diagnosticRef ?? null} onRetry={reload} />
      </>
    );
  }

  return (
    <>
      {header}

      {error && (
        <Card className="mb-6 border-destructive/40">
          <CardContent className="pt-5 text-sm text-muted-foreground">
            We couldn't assemble your workspace just now. Nothing has been substituted — try again.
            <div className="mt-3">
              <Button size="sm" onClick={onRefresh}>
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && partial.length > 0 && (
        <Card className="mb-6">
          <CardContent className="pt-5 text-sm text-muted-foreground">
            Unable to update some sections ({partial.join(", ")}). Everything shown below is still
            sourced from authoritative records — nothing has been substituted.
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={onRefresh}>
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-4" aria-busy>
          <div className="h-14 animate-pulse rounded-xl bg-muted" />
          <div className="h-56 animate-pulse rounded-2xl bg-muted" />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="h-64 animate-pulse rounded-2xl bg-muted lg:col-span-2" />
            <div className="h-64 animate-pulse rounded-2xl bg-muted" />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div ref={askRef}>
            <AskYalla ask={ask} onOpenWork={openWorkById} seedQuestion={askSeed} />
          </div>

          <SinceLastSessionPanel changes={changes} onOpen={openWorkById} />

          <LeadRemindersPanel compact />

          {/* ---------------------------------------------------- PRIMARY */}
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <FocusNowPanel
                focus={focus}
                confidence={confidence}
                busy={focusBusy}
                onStartFocus={onEnterFocus}
                onOpen={openWorkById}
                onRecordOutcome={openOutcomeFor}
                onAskWhy={() => askAbout("Why is this my priority?")}
              />
              <TodayTimeline
                entries={timeline}
                note={plan.note}
                replan={replan}
                onAcceptReplan={acceptReplan}
                onOpen={openWorkById}
              />
            </div>
            <div className="space-y-5">
              <NextBestActionsPanel
                actions={ranked}
                busyKey={startBusyKey}
                loading={availableLoading && ranked.length === 0}
                onStart={startRanked}
                onOpen={openWorkById}
              />
              {focus ? (
                <NextBestActionPanel nba={nba} onDoIt={onEnterFocus} onOpen={openWorkById} />
              ) : (
                <ClearDayPanel options={clearDay} onAction={onClearDayAction} />
              )}
              <RelationshipMemoryPanel
                accountId={focusAccount?.id ?? null}
                accountName={focusAccount?.name ?? null}
                commitments={commitments}
                refreshKey={memoryKey}
              />
              <AvailableCapacityPanel
                key={capacityKey}
                onTaken={onWorkCreated}
                onCreateOwn={() => setCreateOpen(true)}
              />
            </div>
          </div>


          {/* --------------------------------------------------- SECONDARY */}
          <section id="friction" aria-labelledby="friction-heading" className="space-y-3">
            <h2
              id="friction-heading"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
            >
              Friction · waiting, blocked and decisions
            </h2>
            <div className="grid gap-5 lg:grid-cols-2">
              <CustomerWaitingQueue waiting={waiting} />
              <WaitingOnPanel items={waitingOnItems} onOpen={openWorkById} handlers={blockedHandlers} />
              <BlockedWorkPanel items={blocked} onOpen={openWorkById} handlers={blockedHandlers} />
              <ApprovalsPanel approvals={approvals} onOpen={openWorkById} />
              <CommitmentTracker health={health} commitments={commitments} onFulfil={onFulfil} />
              <QuickWinsPanel items={wins} onStartFocus={onEnterFocus} />
            </div>
          </section>

          {/* -------------------------------------------------- SUPPORTING */}
          <section id="supporting" aria-labelledby="supporting-heading" className="space-y-3">
            <h2
              id="supporting-heading"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
            >
              Progress, workload and close
            </h2>
            <div className="grid gap-5 lg:grid-cols-3">
              <ProgressPanel progress={progress} />
              <WorkloadHealthPanel health={workload} onReplan={acceptReplan} />
              <MomentumPanel momentum={momentum} />
            </div>
            <DayCloseCard close={close} onReplan={acceptReplan} />
            <SalesDayCloseCard
              data={salesClose}
              busy={salesBusy}
              onPlaceTasks={() => void placeSalesActions()}
            />
            <CapacityDecisionPanel
              demand={demand}
              profile={capacityProfile}
              outstanding={outstanding}
              busyId={dispositionBusy}
              onDecide={decideWork}
            />
            <PrepareTomorrowPanel
              prep={tomorrow}
              replan={commercialReplan}
              busy={carryBusy}
              onCarry={onCarryForward}
              onOpen={openWorkById}
            />
          </section>

          {/* ACTIVITY — secondary, collapsed */}
          <section aria-labelledby="activity-heading">
            <details className="rounded-xl border bg-card p-4">
              <summary id="activity-heading" className="cursor-pointer text-sm font-semibold">
                All assigned work
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {work.length} item{work.length === 1 ? "" : "s"} · orchestration-generated
                </span>
              </summary>
              <div className="mt-4">
                <PriorityBreakdownPanel scored={scored} onOpen={openWorkById} />
              </div>
              <Tabs defaultValue="now" className="mt-4">
                <TabsList className="flex h-auto flex-wrap">
                  {WORKSPACE_BUCKETS.map((b) => (
                    <TabsTrigger key={b} value={b}>
                      {BUCKET_LABEL[b]}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {grouped.get(b)?.length ?? 0}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>

                {WORKSPACE_BUCKETS.map((b) => (
                  <TabsContent key={b} value={b} className="mt-4 space-y-3">
                    {(grouped.get(b)?.length ?? 0) === 0 && (
                      <WorkspaceEmptyState
                        title={`Nothing in ${BUCKET_LABEL[b].toLowerCase()}`}
                        message="No work item is assigned to you in this bucket right now. Anything routed to you will appear here the moment it is created."
                        actions={[
                          { label: "Set up assignments", to: "/staff/board" },
                          { label: "Open the live stream", to: "/staff/stream" },
                        ]}
                      />
                    )}
                    {grouped.get(b)?.map((w) => (
                      <Card key={w.id} className="transition-shadow hover:shadow-md">
                        <CardContent className="pt-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-semibold">{w.title}</div>
                              <div className="mt-1">
                                <EntityRef type={w.entity_type} id={w.entity_id} entityRef={w.entity_ref} />
                              </div>
                              {w.required_action && (
                                <p className="mt-2 text-sm text-muted-foreground">
                                  Next action: {w.required_action}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <QueueBadge queue={w.ops_queue} />
                              <StateBadge state={w.lifecycle_state} />
                              <PriorityBadge priority={w.priority} />
                              <SlaBadge sla={w.sla} />
                              <Button size="sm" variant="outline" onClick={() => setOutcomeFor(w)}>
                                Record outcome
                              </Button>
                              <Button size="sm" onClick={() => setSelected(w)}>
                                Open
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </TabsContent>
                ))}
              </Tabs>
            </details>
          </section>

          {focus && (
            <p className="text-xs text-muted-foreground">
              <Badge variant="outline" className="mr-2 text-[10px]">
                Provenance
              </Badge>
              Work in this cockpit is generated by orchestration, CRM activity and manager
              assignment — open any item to inspect its source record.
            </p>
          )}
        </div>
      )}

      <ShortcutHelpOverlay open={helpOpen} onOpenChange={setHelpOpen} />

      <CreateWorkDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        roleKey={roleProfile.label}
        onCreated={onWorkCreated}
      />

      <FocusModeDialog
        focus={activeFocus}
        busy={focusBusy}
        onFinish={onFinishFocus}
        onCancelSession={() => onFinishFocus({ interrupted: true })}
      />

      <BlockedAuditDrawer
        workId={auditFor}
        workTitle={work.find((w) => w.id === auditFor)?.title ?? ""}
        open={!!auditFor}
        onOpenChange={(v) => !v && setAuditFor(null)}
      />

      <StartMyDayDialog
        open={dayOpen}
        onOpenChange={setDayOpen}
        greeting={greeting ? `${greetingFor()}, ${greeting}` : greetingFor()}
        objectives={ranked.slice(0, 3).map((a) => a.title)}
        time={time}
        plannedMinutes={plan.plannedMinutes}
        decisionCount={approvals.length}
        promises={commitments.filter(
          (c) => c.direction === "yalla_to_customer" && (c.status === "open" || c.status === "in_progress"),
        )}
        first={ranked[0] ?? null}
        busy={dayBusy}
        onStart={async (first) => {
          setDayBusy(true);
          try {
            if (first) await startRanked(first);
          } finally {
            setDayBusy(false);
            setDayOpen(false);
          }
        }}
      />

      <OutcomeDialog
        open={!!outcomeFor}
        onOpenChange={(v) => !v && setOutcomeFor(null)}
        workTitle={outcomeFor?.title ?? ""}
        subject={outcomeFor?.entity_ref ?? "the customer"}
        busy={outcomeBusy}
        onSubmit={onRecordOutcome}
        nextUpTitle={ranked.find((a) => a.workId !== outcomeFor?.id)?.title ?? null}
      />


      <WorkItemDrawer
        work={selected}
        open={!!selected}
        onOpenChange={(v) => !v && setSelected(null)}
        onChanged={reload}
      />
    </>
  );
}
