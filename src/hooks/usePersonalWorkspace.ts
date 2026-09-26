import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { decorateWork, fetchOpsWork, type DecoratedWork } from "@/lib/orchestration/api";
import { queuesForRoles } from "@/lib/orchestration/rules";
import { requestWorkApproval, transitionWork } from "@/lib/orchestration/api";
import { recordWorkOutcomeRpc } from "@/lib/workspace/workEngine";

import {
  accountMomentum,
  answerAskYalla,
  applyRoleEmphasis,
  approvalQueue,
  changesSinceLastSession,
  priorityConfidence,
  recommendedNextAction,
  resolveRoleProfile,
  outcomeNeedsNextAction,
  type AskYallaAnswer,
  type WorkOutcome,
  buildDayCloseReport,
  buildDayPlan,
  carryForwardWork,
  prepareTomorrow,
  replanTomorrow,
  fetchOpportunitySignals,
  splitDemand,
  fetchCapacityProfile,
  fetchOutstandingDispositions,
  recordWorkDisposition,
  type CapacitySplit,
  type CapacityProfile,
  type OutstandingDisposition,
  type WorkDisposition,
  type TomorrowPrep,
  type CommercialReplan,
  type OpportunitySignal,

  commitmentHealth,
  customerWaitingQueue,
  dayCloseSummary,
  detectReplan,
  endFocusSession,
  fetchMyCommitments,
  fetchMyNextActions,
  fetchMyStaffIdentity,
  fetchTodayFocusSessions,
  focusMinutesToday,
  focusTarget,
  scoreAll,
  startFocusSession,
  type DayPlan,
  type FocusSession,
  type MyStaffIdentity,
  type PersonalCommitment,
  type PersonalNextAction,
  type PlannedBlock,
  type ReplanChange,
} from "@/lib/workspace";

import { fetchSalesDayClose, hasCommercialActivity, type SalesDayClose } from "@/lib/sales/dayClose";

export interface ActiveFocus {
  sessionId: string;
  workId: string;
  title: string;
  plannedMinutes: number;
  startedAtMs: number;
}

/**
 * The employee's personal operating cockpit state.
 *
 * The platform stays one shared operating system — only the RENDERED experience
 * is personal: this hook resolves the staff identity, loads the work and
 * promises that identity owns, and derives the plan, focus target and close-out
 * through the pure engine.
 */
export function usePersonalWorkspace() {
  const { user, roles } = useAuth();
  const [identity, setIdentity] = useState<MyStaffIdentity | null>(null);
  const [rawWork, setRawWork] = useState<DecoratedWork[]>([]);
  const [commitments, setCommitments] = useState<PersonalCommitment[]>([]);
  const [nextActions, setNextActions] = useState<PersonalNextAction[]>([]);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<string[]>([]);
  /** Stamp behind the "Live · Updated moments ago" indicator. */
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>(() => new Date().toISOString());

  /**
   * Optimistic overlay for cockpit actions (resolve / request decision).
   * The patch is shown immediately, then reconciled against the authoritative
   * reload or realtime refresh so the priority order never flickers back.
   */
  const [optimistic, setOptimistic] = useState<
    Record<string, { patch: Partial<DecoratedWork>; at: number }>
  >({});

  const myQueues = useMemo(() => queuesForRoles(roles), [roles]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const misses: string[] = [];
    try {
      const id = await fetchMyStaffIdentity(user.id);
      setIdentity(id);

      // IDENTITY GATE — when the authenticated user cannot be securely mapped to
      // a staff record we withhold ALL personal data. No role-queue fallback, no
      // cached state, no demonstration content.
      if (id.status !== "linked" || !id.staffId) {
        setRawWork([]);
        setCommitments([]);
        setNextActions([]);
        setSessions([]);
        setError(null);
        return;
      }

      const rows = await fetchOpsWork({ staffId: id.staffId });
      setRawWork(decorateWork(rows));

      const [c, n, f] = await Promise.allSettled([
        fetchMyCommitments(id.staffId),
        fetchMyNextActions(id.staffId),
        fetchTodayFocusSessions(id.staffId),
      ]);
      if (c.status === "fulfilled") setCommitments(c.value);
      else misses.push("customer promises");
      if (n.status === "fulfilled") setNextActions(n.value);
      else misses.push("CRM next actions");
      if (f.status === "fulfilled") setSessions(f.value);
      else misses.push("focus effort actuals");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your workspace");
    } finally {
      setPartial(misses);
      setLoading(false);
      setLastUpdatedAt(new Date().toISOString());
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * REALTIME — one channel, scoped to this staff member's records, torn down on
   * unmount. Any change to the underlying work, promises, next actions or focus
   * effort reloads the cockpit and refreshes the live stamp.
   */
  const staffId = identity?.status === "linked" ? identity.staffId : null;
  useEffect(() => {
    if (!staffId) return;
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      // Coalesce bursts so a multi-row server write reloads once.
      timer = window.setTimeout(() => void load(), 400);
    };
    const channel = supabase
      .channel(`personal-workspace-${staffId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "staff_work_items", filter: `staff_id=eq.${staffId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "crm_customer_commitments",
          filter: `owner_staff_id=eq.${staffId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crm_next_actions", filter: `staff_id=eq.${staffId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "staff_focus_sessions", filter: `staff_id=eq.${staffId}` },
        refresh,
      )
      .subscribe();

    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [staffId, load]);

  /* ------------------------------------------- optimistic reconciliation */

  const work = useMemo(
    () =>
      rawWork.map((w) => {
        const o = optimistic[w.id];
        return o ? ({ ...w, ...o.patch } as DecoratedWork) : w;
      }),
    [rawWork, optimistic],
  );

  // Drop an overlay as soon as the server agrees with it (or it goes stale), so
  // the authoritative record always wins without an intermediate flicker.
  useEffect(() => {
    setOptimistic((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;
      const next: typeof prev = {};
      let changed = false;
      for (const [id, entry] of entries) {
        const row = rawWork.find((w) => w.id === id) as unknown as Record<string, unknown> | undefined;
        const applied =
          !row ||
          Object.entries(entry.patch).every(
            ([k, v]) => v === undefined || row[k] === v,
          );
        const stale = Date.now() - entry.at > 20_000;
        if (applied || stale) changed = true;
        else next[id] = entry;
      }
      return changed ? next : prev;
    });
  }, [rawWork]);


  const roleProfile = useMemo(
    () => resolveRoleProfile({ position: identity?.position, unit: identity?.unit, roles }),
    [identity?.position, identity?.unit, roles],
  );

  // Role adaptation reorders what the employee sees first; it never rewrites the
  // recorded scores or hides work they own.
  const scored = useMemo(
    () => applyRoleEmphasis(scoreAll(work, { commitments }), roleProfile),
    [work, commitments, roleProfile],
  );
  const spentMinutes = useMemo(() => focusMinutesToday(sessions), [sessions]);

  /**
   * CAPACITY — the working day comes from the recorded capacity profile for this
   * person's role, never from a constant in the screen. A missing profile is
   * reported as absence so the plan is never inflated by a guess.
   */
  const capacityRoleKey = useMemo(() => {
    const position = (identity?.position ?? "").toLowerCase();
    if (position.includes("intern")) return "intern";
    if (/manager|lead|head|director|chief/.test(position)) return "manager";
    if (roleProfile.key === "commercial") return "sales";
    if (roleProfile.key === "operations") return "operations";
    return "DEFAULT";
  }, [identity?.position, roleProfile.key]);

  const [capacityProfile, setCapacityProfile] = useState<CapacityProfile | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchCapacityProfile(capacityRoleKey).then((p) => {
      if (!cancelled) setCapacityProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [capacityRoleKey]);

  const proposedPlan = useMemo(
    () =>
      buildDayPlan(scored, commitments, {
        spentMinutes,
        profileProductiveMinutes: capacityProfile?.productiveMinutes,
      }),
    [scored, commitments, spentMinutes, capacityProfile?.productiveMinutes],
  );

  // The plan the employee is working to. Replans are proposed, never applied
  // silently — consequential moves require explicit confirmation.
  const [acceptedBlocks, setAcceptedBlocks] = useState<PlannedBlock[] | null>(null);
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && proposedPlan.blocks.length) {
      setAcceptedBlocks(proposedPlan.blocks);
      seeded.current = true;
    }
  }, [proposedPlan.blocks]);

  const plan: DayPlan = useMemo(
    () => (acceptedBlocks ? { ...proposedPlan, blocks: acceptedBlocks } : proposedPlan),
    [acceptedBlocks, proposedPlan],
  );

  /**
   * DEMAND vs CAPACITY — everything that cannot fit today gets an explicit
   * decision (reassign, automate, escalate, defer, close) instead of quietly
   * rolling over.
   */
  const demand: CapacitySplit = useMemo(
    () => splitDemand(scored, plan.capacityMinutes, commitments),
    [scored, plan.capacityMinutes, commitments],
  );



  const replan: ReplanChange[] = useMemo(
    () => (acceptedBlocks ? detectReplan(acceptedBlocks, proposedPlan.blocks) : []),
    [acceptedBlocks, proposedPlan.blocks],
  );

  const acceptReplan = useCallback(() => setAcceptedBlocks(proposedPlan.blocks), [proposedPlan.blocks]);

  const focus = useMemo(() => focusTarget(scored, commitments), [scored, commitments]);
  const health = useMemo(() => commitmentHealth(commitments), [commitments]);
  const waiting = useMemo(() => customerWaitingQueue(commitments), [commitments]);
  const momentum = useMemo(
    () => accountMomentum(nextActions, commitments, work),
    [nextActions, commitments, work],
  );
  const close = useMemo(
    () => dayCloseSummary(work, scored, commitments),
    [work, scored, commitments],
  );
  const approvals = useMemo(() => approvalQueue(work), [work]);
  const confidence = useMemo(() => priorityConfidence(focus?.scored ?? null), [focus]);

  /* ------------------------------------------- since your last session */

  const lastSeenKey = user ? `yalla.ws.lastSeen.${user.id}` : null;
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  useEffect(() => {
    if (!lastSeenKey) return;
    setLastSeenAt(window.localStorage.getItem(lastSeenKey));
    const stamp = new Date().toISOString();
    return () => window.localStorage.setItem(lastSeenKey, stamp);
  }, [lastSeenKey]);

  const changes = useMemo(
    () => changesSinceLastSession(work, commitments, lastSeenAt),
    [work, commitments, lastSeenAt],
  );

  /* ------------------------------------------------------------ focus mode */

  const [activeFocus, setActiveFocus] = useState<ActiveFocus | null>(null);
  const [focusBusy, setFocusBusy] = useState(false);

  const beginFocus = useCallback(
    async (workId: string) => {
      const target = scored.find((s) => s.work.id === workId);
      const item = target?.work ?? work.find((w) => w.id === workId);
      if (!item) return { ok: false as const, error: "That work item is no longer in your queue" };
      setFocusBusy(true);
      const planned = target?.effortMinutes ?? 20;
      const res = await startFocusSession(workId, planned);
      setFocusBusy(false);
      if (!res.ok || !res.sessionId) return { ok: false as const, error: res.error };
      setActiveFocus({
        sessionId: res.sessionId,
        workId,
        title: item.title,
        plannedMinutes: planned,
        startedAtMs: Date.now(),
      });
      return { ok: true as const };
    },
    [scored, work],
  );

  const finishFocus = useCallback(
    async (opts: { outcomeNote?: string; completed?: boolean; interrupted?: boolean }) => {
      if (!activeFocus) return { ok: false as const, error: "No focus session is running" };
      setFocusBusy(true);
      const res = await endFocusSession(activeFocus.sessionId, opts);
      setFocusBusy(false);
      if (!res.ok) return { ok: false as const, error: res.error };
      setActiveFocus(null);
      // Capacity and the work inbox must reflect the recorded effort immediately.
      await load();
      return { ok: true as const, actualMinutes: res.actualMinutes };
    },
    [activeFocus, load],
  );

  /* -------------------------------------------------- blocked work actions */

  const [blockedBusy, setBlockedBusy] = useState<string | null>(null);

  const applyOptimistic = useCallback((workId: string, patch: Partial<DecoratedWork>) => {
    setOptimistic((prev) => ({ ...prev, [workId]: { patch, at: Date.now() } }));
  }, []);

  const clearOptimistic = useCallback((workId: string) => {
    setOptimistic((prev) => {
      if (!prev[workId]) return prev;
      const next = { ...prev };
      delete next[workId];
      return next;
    });
  }, []);

  /**
   * RESOLVE — the employee clears the blocker themselves. The canonical work
   * item moves back into progress with the recorded reason, and the priority
   * order is recomputed from the refreshed record.
   */
  const resolveBlocked = useCallback(
    async (workId: string, reason: string) => {
      if (!reason.trim()) return { ok: false as const, error: "Record how the blocker was cleared" };
      setBlockedBusy(workId);
      applyOptimistic(workId, { lifecycle_state: "in_progress" } as Partial<DecoratedWork>);
      const res = await transitionWork({ workItemId: workId, toState: "in_progress", reason });
      setBlockedBusy(null);
      if (!res.ok) {
        clearOptimistic(workId);
        return { ok: false as const, error: res.error };
      }
      await load();
      return { ok: true as const };
    },
    [applyOptimistic, clearOptimistic, load],
  );

  /**
   * REQUEST DECISION — the blocker is somebody else's call. The request is
   * written to the work item; the server alerts every authorised decision owner.
   */
  const requestDecision = useCallback(
    async (workId: string, reason: string) => {
      if (!reason.trim()) return { ok: false as const, error: "A justification is required" };
      setBlockedBusy(workId);
      applyOptimistic(workId, {
        needs_approval: true,
        approval_state: "requested",
        approval_reason: reason,
        approval_requested_at: new Date().toISOString(),
      } as Partial<DecoratedWork>);
      const res = await requestWorkApproval(workId, reason);
      setBlockedBusy(null);
      if (!res.ok) {
        clearOptimistic(workId);
        return { ok: false as const, error: res.error };
      }
      await load();
      return { ok: true as const };
    },
    [applyOptimistic, clearOptimistic, load],
  );

  /* ----------------------------------------------------- prepare tomorrow */

  const tomorrow: TomorrowPrep = useMemo(
    () => prepareTomorrow(work, scored, commitments),
    [work, scored, commitments],
  );

  /**
   * Live commercial signals for the carried work. Day Close replans from the
   * authoritative pipeline rows themselves, so a deal that moved (or died)
   * today changes tomorrow's plan without anyone retyping anything.
   */
  const [opportunities, setOpportunities] = useState<OpportunitySignal[]>([]);
  const carriedOpportunityIds = useMemo(
    () =>
      work
        .filter((w) => w.work_kind === "sales_opportunity" && w.entity_id)
        .map((w) => w.entity_id as string),
    [work],
  );

  useEffect(() => {
    let cancelled = false;
    if (carriedOpportunityIds.length === 0) {
      setOpportunities([]);
      return () => {
        cancelled = true;
      };
    }
    void fetchOpportunitySignals(carriedOpportunityIds).then((rows) => {
      if (!cancelled) setOpportunities(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [carriedOpportunityIds]);

  const commercialReplan: CommercialReplan = useMemo(
    () =>
      replanTomorrow(tomorrow, scored, {
        opportunities,
        waiting,
        capacityMinutes: capacityProfile?.productiveMinutes ?? null,
      }),
    [tomorrow, scored, opportunities, waiting, capacityProfile?.productiveMinutes],
  );

  const [carryBusy, setCarryBusy] = useState(false);

  /**
   * Carries unfinished work into tomorrow. A reason is mandatory and is recorded
   * as an explicit "continue" decision on each item, so nothing rolls over
   * silently and the trail shows who decided what and why.
   */
  const carryForward = useCallback(
    async (workIds: string[], reason?: string) => {
      if (workIds.length === 0) return { ok: true as const, carried: 0 };
      const why = (reason ?? "").trim();
      if (!why)
        return {
          ok: false as const,
          carried: 0,
          error: "Record why this work is moving to tomorrow",
        };
      setCarryBusy(true);
      const results = await Promise.all(
        workIds.map(async (id) => {
          const carried = await carryForwardWork(id, why);
          if (!carried.ok) return carried;
          return recordWorkDisposition({ workItemId: id, disposition: "continue", reason: why });
        }),
      );
      setCarryBusy(false);
      const failed = results.filter((r) => !r.ok);
      await load();
      if (failed.length)
        return {
          ok: false as const,
          carried: results.length - failed.length,
          error: failed[0].error ?? "Some items could not be carried forward",
        };
      return { ok: true as const, carried: results.length };
    },
    [load],
  );

  /* -------------------------------------------------- explicit dispositions */

  const [outstanding, setOutstanding] = useState<OutstandingDisposition[]>([]);
  const [dispositionBusy, setDispositionBusy] = useState<string | null>(null);

  const loadOutstanding = useCallback(async () => {
    setOutstanding(await fetchOutstandingDispositions());
  }, []);

  useEffect(() => {
    if (!staffId) return;
    void loadOutstanding();
  }, [staffId, loadOutstanding, rawWork]);

  /** Records the decision the employee has taken about an unfinished item. */
  const decideWork = useCallback(
    async (input: {
      workItemId: string;
      disposition: WorkDisposition;
      reason: string;
      newDueDate?: string | null;
      reassignToStaffId?: string | null;
    }) => {
      if (!input.reason.trim()) return { ok: false as const, error: "A reason is required" };
      setDispositionBusy(input.workItemId);
      const res = await recordWorkDisposition(input);
      setDispositionBusy(null);
      if (!res.ok) return { ok: false as const, error: res.error };
      await Promise.all([load(), loadOutstanding()]);
      return { ok: true as const };
    },
    [load, loadOutstanding],
  );



  /* ---------------------------------------------------- outcome capture */

  /**
   * Completion must advance the business process: the structured outcome is
   * written to the canonical work item, and the orchestration layer proposes the
   * next action on the same customer relationship.
   */
  const recordOutcome = useCallback(
    async (workId: string, input: { outcome: WorkOutcome; note?: string; createNext: boolean }) => {
      const item = work.find((w) => w.id === workId);
      if (!item) return { ok: false as const, error: "That work item is no longer in your queue" };

      const link =
        nextActions.find((a) => a.work_item_id === workId) ??
        commitments.find((c) => c.work_item_id === workId);
      const accountName = link?.account_name ?? item.entity_ref ?? "the customer";
      const proposal =
        input.createNext && outcomeNeedsNextAction(input.outcome)
          ? recommendedNextAction(input.outcome, accountName)
          : null;

      /**
       * ONE ACTION, EVERYTHING MOVES — the server resolves the work item, writes
       * the customer interaction and raises the follow-up in a single
       * transaction, so the record can never drift out of step.
       */
      const res = await recordWorkOutcomeRpc({
        workItemId: workId,
        outcome: input.outcome,
        notes: input.note ?? null,
        nextActionTitle: proposal,
      });
      if (res.ok !== true) return { ok: false as const, error: res.error };

      await load();
      return { ok: true as const, nextActionTitle: res.nextWorkItemId ? proposal : null };
    },
    [work, nextActions, commitments, load],
  );


  /* --------------------------------------------------------- Ask SAFARID */

  const ask = useCallback(
    (question: string): AskYallaAnswer =>
      answerAskYalla(question, {
        focus,
        scored,
        plan,
        waiting,
        commitments,
        momentum,
        approvals,
        changes,
      }),
    [focus, scored, plan, waiting, commitments, momentum, approvals, changes],
  );

  /* -------------------------------------------- commercial day close */

  const [salesClose, setSalesClose] = useState<SalesDayClose | null>(null);
  const [salesBusy, setSalesBusy] = useState(false);

  const loadSalesClose = useCallback(async (materialise = false) => {
    setSalesBusy(true);
    try {
      const d = await fetchSalesDayClose(null, materialise);
      setSalesClose(hasCommercialActivity(d) ? d : null);
      return d;
    } catch {
      // A missing commercial record is stated as absence, never as a zero.
      setSalesClose(null);
      return null;
    } finally {
      setSalesBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!identity?.staffId) return;
    void loadSalesClose(false);
  }, [identity?.staffId, loadSalesClose]);

  /** Places the top three commercial next best actions on today's task list. */
  const placeSalesActions = useCallback(async () => {
    const d = await loadSalesClose(true);
    await load();
    return { ok: true as const, placed: d?.tasks_placed ?? 0 };
  }, [loadSalesClose, load]);

  const dayCloseReport = useCallback(
    () =>
      buildDayCloseReport({
        staffName: identity?.fullName ?? null,
        position: identity?.position ?? null,
        sales: salesClose,
        close,
        work,
        scored,
        commitments,
        sessions,
        replan,
        tomorrow,
      }),
    [identity, salesClose, close, work, scored, commitments, sessions, replan, tomorrow],
  );

  return {
    identity,
    loading,
    error,
    partial,
    lastUpdatedAt,
    reload: load,

    work,
    scored,
    commitments,
    nextActions,
    sessions,
    spentMinutes,
    plan,
    proposedPlan,
    replan,
    acceptReplan,
    focus,
    confidence,
    health,
    waiting,
    momentum,
    close,
    approvals,
    changes,
    roleProfile,
    recordOutcome,
    ask,
    myQueues,
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
    demand,
    capacityProfile,
    outstanding,
    dispositionBusy,
    decideWork,
    dayCloseReport,
    salesClose,
    salesBusy,
    placeSalesActions,
  };
}

