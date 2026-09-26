/**
 * STAGE 3 — WORKSPACE INTELLIGENCE ORCHESTRATION.
 *
 * Single fetch/assembly point for the canonical work model. Every workspace
 * execution surface (Work Queue, briefs, notifications, AI copilot) reads from
 * THIS hook so no surface can invent its own triage.
 *
 * Sources are all authoritative: the work spine (assigned work), CRM customer
 * commitments, the commercial lenses (opportunities / quotes / contracts) and
 * unowned recorded actions. When a domain is withheld by row-level security it
 * is reported as withheld — never replaced with sample data.
 */
import * as React from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePersonalWorkspace } from "@/hooks/usePersonalWorkspace";
import { fetchAvailableActions, type AvailableAction } from "@/lib/workspace/workEngine";
import {
  fetchMyContracts,
  fetchMyOpportunities,
  fetchMyQuotes,
  type MyContract,
  type MyOpportunity,
  type MyQuote,
} from "@/lib/workspace/lenses";
import {
  buildWorkspaceItems,
  dependencyGraph,
  groupByLane,
  nextBestItem,
  workloadSummary,
  type DependencyGroup,
  type LaneView,
  type WorkloadSummary,
  type WorkspaceItem,
  type ApprovalSignalInput,
} from "@/lib/workspace/intelligence";
import { buildExceptionRegister, type ExceptionRegister } from "@/lib/workspace/exceptions";
import { dailyBrief, type DailyBrief } from "@/lib/workspace/aiBrief";
import { listMeetings, type ScheduledMeeting } from "@/lib/workspace/meetings";
import { buildAiPanel, type AiPanelModel } from "@/lib/workspace/aiPanel";
import { buildCommandIndex, type CommandEntry } from "@/lib/workspace/commandCentre";
import { fetchWorkspaceInbox, type InboxEmail } from "@/lib/workspace/inbox";
import {
  APPROVAL_ENTITY_LABEL,
  canApproveCommercial,
  listApprovals,
  type ApprovalRecord,
} from "@/lib/workspace/approvals";

export interface WithheldDomains {
  opportunities: boolean;
  quotes: boolean;
  contracts: boolean;
}

export interface WorkspaceIntelligence {
  loading: boolean;
  /** Identity could not be resolved — nothing personal may be shown. */
  identityMissing: boolean;
  items: WorkspaceItem[];
  lanes: LaneView;
  workload: WorkloadSummary;
  dependencies: DependencyGroup[];
  next: WorkspaceItem | null;
  /** Stage 24 — prioritised exception register over the same items. */
  exceptions: ExceptionRegister;
  /** Stage 5 — the day-level brief. */
  brief: DailyBrief;
  /** Stage 4 — meetings read from the work spine. */
  meetings: ScheduledMeeting[];
  /** Stage 6 — the full AI recommendation set over the same items. */
  aiPanel: AiPanelModel;
  /** Stage 7 — the Ctrl/Cmd + K searchable index over authoritative records. */
  commandIndex: CommandEntry[];
  /** Stage 11 — commercial approvals visible to this person. */
  approvals: ApprovalRecord[];
  /** This person may record approve/decline decisions. */
  canApprove: boolean;
  /** Human labels for domains access control withheld. */
  blindSpots: string[];
  withheld: WithheldDomains;
  reload: () => void;
}

export function useWorkspaceIntelligence(): WorkspaceIntelligence {
  const { user } = useAuth();
  const personal = usePersonalWorkspace();
  const staffId = personal.identity?.staffId ?? null;

  const [nonce, setNonce] = React.useState(0);
  const [commercialLoading, setCommercialLoading] = React.useState(true);
  const [opportunities, setOpportunities] = React.useState<MyOpportunity[]>([]);
  const [quotes, setQuotes] = React.useState<MyQuote[]>([]);
  const [contracts, setContracts] = React.useState<MyContract[]>([]);
  const [approvals, setApprovals] = React.useState<ApprovalRecord[]>([]);
  const [canApprove, setCanApprove] = React.useState(false);
  const [available, setAvailable] = React.useState<AvailableAction[]>([]);
  const [emails, setEmails] = React.useState<InboxEmail[]>([]);
  const [mailAuthorised, setMailAuthorised] = React.useState(true);
  const [withheld, setWithheld] = React.useState<WithheldDomains>({
    opportunities: false,
    quotes: false,
    contracts: false,
  });

  React.useEffect(() => {
    if (!user?.id) return;
    let live = true;
    void fetchWorkspaceInbox().then((inbox) => {
      if (!live) return;
      setEmails(inbox.emails);
      setMailAuthorised(inbox.authorised);
    });
    setCommercialLoading(true);
    void (async () => {
      const [o, q, c, a, ap, may] = await Promise.all([
        fetchMyOpportunities(user.id),
        staffId ? fetchMyQuotes(staffId) : Promise.resolve(null),
        staffId ? fetchMyContracts(staffId) : Promise.resolve(null),
        fetchAvailableActions(8).catch(() => [] as AvailableAction[]),
        listApprovals(),
        canApproveCommercial(),
      ]);
      if (!live) return;
      setApprovals(ap.items);
      setCanApprove(may);
      setOpportunities(o.items);
      setQuotes(q?.items ?? []);
      setContracts(c?.items ?? []);
      setAvailable(a);
      setWithheld({
        opportunities: !o.authorised,
        quotes: q ? !q.authorised : false,
        contracts: c ? !c.authorised : false,
      });
      setCommercialLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [user?.id, staffId, nonce]);

  const approvalSignals = React.useMemo<ApprovalSignalInput[]>(
    () =>
      approvals
        .filter((a) => a.status === "pending")
        .map((a) => ({
          id: a.id,
          entityType: a.entity_type,
          entityLabel: APPROVAL_ENTITY_LABEL[a.entity_type],
          title: a.title,
          subject: a.entity_ref,
          amountLabel:
            a.amount_cents != null
              ? `${a.currency} ${(a.amount_cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : null,
          requestedAt: a.created_at,
          mine: a.requested_by === user?.id || a.requested_staff_id === staffId,
          canApprove,
        })),
    [approvals, canApprove, user?.id, staffId],
  );

  const items = React.useMemo(
    () =>
      buildWorkspaceItems({
        assigned: personal.scored,
        commitments: personal.commitments,
        opportunities,
        quotes,
        contracts,
        approvals: approvalSignals,
        available,
      }),
    [personal.scored, personal.commitments, opportunities, quotes, contracts, approvalSignals, available],
  );

  const workload = React.useMemo(() => workloadSummary(items), [items]);
  const meetings = React.useMemo(() => listMeetings(personal.work ?? []), [personal.work]);
  const blindSpots = React.useMemo(
    () =>
      [
        withheld.opportunities && "Opportunities",
        withheld.quotes && "Quotes",
        withheld.contracts && "Contracts",
        !mailAuthorised && "Mail",
      ].filter((d): d is string => !!d),
    [withheld, mailAuthorised],
  );

  return {
    loading: personal.loading || commercialLoading,
    identityMissing: !personal.loading && !staffId,
    items,
    lanes: React.useMemo(() => groupByLane(items), [items]),
    workload,
    dependencies: React.useMemo(() => dependencyGraph(items), [items]),
    next: React.useMemo(() => nextBestItem(items), [items]),
    exceptions: React.useMemo(() => buildExceptionRegister(items), [items]),
    brief: React.useMemo(() => dailyBrief(items, workload), [items, workload]),
    meetings,
    aiPanel: React.useMemo(
      () =>
        buildAiPanel({
          items,
          workload,
          meetingMinutesToday: meetings
            .filter((m) => m.phase !== "after")
            .reduce((sum, m) => sum + m.minutes, 0),
          blindSpots,
        }),
      [items, workload, meetings, blindSpots],
    ),
    commandIndex: React.useMemo(
      () => buildCommandIndex({ items, opportunities, quotes, contracts, meetings, emails }),
      [items, opportunities, quotes, contracts, meetings, emails],
    ),
    approvals,
    canApprove,
    blindSpots,
    withheld,
    reload: React.useCallback(() => {
      personal.reload?.();
      setNonce((n) => n + 1);
    }, [personal]),
  };
}
