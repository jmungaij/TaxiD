/**
 * Module 2 — Enterprise Customer Operations & Resolution Center.
 *
 * Production Module Completion Mode. Composed EXCLUSIVELY from certified
 * frozen primitives (EnterpriseHeroBand, StatCard, AsyncState,
 * SectionErrorBoundary, AiAssistantPanel) + shadcn design-system atoms.
 * Zero new presentation components, tokens, layouts or guards.
 *
 * Backbone:
 *   support_cases / support_case_events / support_case_notes / support_sla_policies
 *   Customer 360 reuses existing fact_trips, wallet_transactions, delivery_orders,
 *   refund_requests and profiles.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Plus,
  Inbox,
  Timer,
  AlertTriangle,
  ShieldAlert,
  TrendingUp,
  Users,
  ArrowUpRight,
  CheckCircle2,
  History,
  UserCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import StatCard from "@/components/common/StatCard";
import { EnterpriseHeroBand } from "@/components/layout/EnterpriseHeroBand";
import { AiAssistantPanel } from "@/components/layout/AiAssistantPanel";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import {
  CASE_TYPES,
  DOMAIN_LABEL,
  autoEscalate,
  predictPriority,
} from "@/lib/customerops/taxonomy";
import { runClassification } from "@/lib/customerops/classifier";
import { formatPath } from "@/lib/customerops/hierarchy";
import { assessEvidence } from "@/lib/customerops/correlation";
import { getPlaybook } from "@/lib/customerops/playbooks";
import {
  INTEGRATION_MATRIX,
  checkTraversal,
  dependencyScore,
  evaluateExchangeHealth,
} from "@/lib/customerops/integration";
import { CUSTOMER_OPERATIONS_CONTRACT, validateContract } from "@/lib/contracts";
import {
  executiveInsights,
  improvementLoop,
  knowledgeFor,
  predictiveSignals,
  rootCauseAnalysis,
  teamIntelligence,
  workforceIntelligence,
  type AnalyticsCase,
} from "@/lib/customerops/intelligence";
import type { Interaction } from "@/lib/customerops/channels";
import { buildOrchestrationPlan } from "@/lib/customerops/orchestration";
import type { MissionControlInput } from "@/lib/customerops/missionControl";
import MissionControlPanel from "@/components/customerops/MissionControlPanel";
import DecisionIntelligencePanel from "@/components/customerops/DecisionIntelligencePanel";
import CaseCommandBar from "@/components/customerops/CaseCommandBar";
import { OmnichannelInboxPanel } from "@/components/customerops/OmnichannelInboxPanel";
import { BusinessLineCoveragePanel } from "@/components/customerops/BusinessLineCoveragePanel";
import { SlaGovernancePanel } from "@/components/customerops/SlaGovernancePanel";
import { Customer360Panel } from "@/components/customerops/Customer360Panel";
import { LiveOperationsPanel } from "@/components/customerops/LiveOperationsPanel";
import { AgentPerformancePanel } from "@/components/customerops/AgentPerformancePanel";
import { KnowledgeCopilotPanel } from "@/components/customerops/KnowledgeCopilotPanel";
import { OrchestrationCertificationPanel } from "@/components/customerops/OrchestrationCertificationPanel";
import {
  CopilotWorkbenchPanel,
  type CopilotCaseContext,
} from "@/components/customerops/CopilotWorkbenchPanel";



/* ------------------------------- types ---------------------------------- */

type CaseRow = {
  id: string;
  case_number: string;
  channel: string;
  category: string;
  priority: string;
  severity: string;
  status: string;
  subject: string;
  description: string | null;
  requester_user_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  corporate_account_id: string | null;
  assigned_to: string | null;
  assigned_team: string | null;
  sla_response_due_at: string | null;
  sla_resolution_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  sla_response_breached: boolean;
  sla_resolution_breached: boolean;
  escalation_level: number;
  fraud_risk_score: number;
  sentiment: string | null;
  tags: string[];
  created_at: string;
};

type EventRow = {
  id: string;
  case_id: string;
  actor_user_id: string | null;
  action: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  created_at: string;
};

type NoteRow = {
  id: string;
  case_id: string;
  author_user_id: string | null;
  body: string;
  visibility: string;
  created_at: string;
};

type SlaPolicy = {
  id: string;
  category: string;
  priority: string;
  response_minutes: number;
  resolution_minutes: number;
  is_active: boolean;
};

/* ------------------------------ constants -------------------------------- */

const CHANNELS = [
  "app",
  "email",
  "phone",
  "whatsapp",
  "chatbot",
  "corporate_portal",
  "social",
  "internal",
] as const;

const CATEGORIES = [
  "general",
  "payment",
  "safety",
  "fraud",
  "delivery",
  "corporate",
  "driver",
  "rentals",
] as const;

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const STATUSES = [
  "new",
  "triaged",
  "assigned",
  "in_progress",
  "pending_customer",
  "pending_approval",
  "escalated",
  "resolved",
  "closed",
] as const;

const statusTone: Record<string, string> = {
  new: "bg-primary/10 text-primary border-primary/30",
  triaged: "bg-primary/10 text-primary border-primary/30",
  assigned: "bg-primary/10 text-primary border-primary/30",
  in_progress: "bg-status-warning/15 text-status-warning border-status-warning/30",
  pending_customer: "bg-muted text-muted-foreground border-border",
  pending_approval: "bg-status-warning/15 text-status-warning border-status-warning/30",
  escalated: "bg-destructive/10 text-destructive border-destructive/30",
  resolved: "bg-status-success/15 text-status-success border-status-success/30",
  closed: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const priorityTone: Record<string, string> = {
  low: "bg-muted text-muted-foreground border-border",
  medium: "bg-primary/10 text-primary border-primary/30",
  high: "bg-status-warning/15 text-status-warning border-status-warning/30",
  urgent: "bg-destructive/10 text-destructive border-destructive/30",
};

const label = (v: string) => v.replace(/_/g, " ");

const minutesBetween = (a: string, b: string) =>
  Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));

const humanDuration = (mins: number) =>
  mins < 60 ? `${mins}m` : mins < 1440 ? `${(mins / 60).toFixed(1)}h` : `${(mins / 1440).toFixed(1)}d`;

/* ------------------------- intelligence (deterministic) ------------------- */

/** Deterministic routing suggestion — no backend AI required. */
function suggestRouting(c: Pick<CaseRow, "category" | "priority" | "severity">) {
  if (c.category === "safety") return "Trust & Safety · Rapid Response";
  if (c.category === "fraud") return "Fraud Intelligence";
  if (c.category === "payment") return "Finance · Payment Operations";
  if (c.category === "delivery") return "Delivery & Logistics Ops";
  if (c.category === "corporate") return "Corporate Success";
  if (c.priority === "urgent") return "Tier 2 Escalations";
  return "Tier 1 Customer Operations";
}

/** Deterministic fraud/abuse indicator derived from case attributes + history. */
function fraudIndicators(c: CaseRow, historyCount: number): string[] {
  const out: string[] = [];
  if (c.fraud_risk_score >= 60) out.push(`Elevated fraud score (${c.fraud_risk_score})`);
  if (historyCount >= 3) out.push(`${historyCount} prior cases from this customer`);
  if (c.category === "payment" && c.priority === "urgent") out.push("Urgent payment dispute pattern");
  if (c.channel === "chatbot" && c.category === "fraud") out.push("Unverified channel for fraud claim");
  return out;
}

/** SLA breach prediction: remaining budget vs elapsed time. */
function slaRisk(c: CaseRow): { level: "ok" | "at_risk" | "breached"; text: string } {
  const due = c.sla_resolution_due_at;
  if (c.resolved_at) return { level: "ok", text: "Resolved" };
  if (!due) return { level: "ok", text: "No SLA" };
  const remaining = Math.round((new Date(due).getTime() - Date.now()) / 60000);
  if (remaining <= 0) return { level: "breached", text: `Breached ${humanDuration(-remaining)} ago` };
  if (remaining <= 60) return { level: "at_risk", text: `At risk · ${humanDuration(remaining)} left` };
  return { level: "ok", text: `${humanDuration(remaining)} left` };
}

/** Duplicate detection — same requester + similar subject within 7 days. */
function findDuplicates(target: CaseRow, all: CaseRow[]): CaseRow[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const t = new Set(norm(target.subject).split(/\s+/).filter((w) => w.length > 3));
  if (t.size === 0) return [];
  return all.filter((c) => {
    if (c.id === target.id) return false;
    const sameParty =
      (target.requester_user_id && c.requester_user_id === target.requester_user_id) ||
      (target.requester_email && c.requester_email === target.requester_email);
    if (!sameParty) return false;
    const words = new Set(norm(c.subject).split(/\s+/).filter((w) => w.length > 3));
    let overlap = 0;
    t.forEach((w) => { if (words.has(w)) overlap++; });
    return overlap / t.size >= 0.5;
  });
}

const RESPONSE_TEMPLATES: Record<string, string> = {
  payment:
    "Thank you for contacting SAFARID. We've located your payment and opened a finance review. You'll receive an update within the SLA window, and any approved refund is processed to your original payment method.",
  safety:
    "Your safety report has been escalated to our Trust & Safety rapid-response team. A specialist will contact you shortly. If you are in immediate danger, please contact local emergency services.",
  delivery:
    "We're tracking your delivery now and have alerted the dispatch team. We'll confirm the revised ETA or arrange a resolution as soon as the courier is reached.",
  corporate:
    "Thank you for reaching out. Your corporate success manager has been notified and will review the account activity and respond with a resolution plan.",
  general:
    "Thanks for getting in touch with SAFARID. We've logged your case and an operations specialist is reviewing it now. We'll follow up with an update shortly.",
};

/* ------------------------------ component -------------------------------- */

export default function CustomerOperationsCenter() {
  const { user, roles } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [c360, setC360] = useState<{
    loading: boolean;
    trips: { id: string; trip_date: string; fare_cents: number | null; payment_method: string | null }[];
    wallet: { id: string; amount_cents: number; kind: string; status: string; created_at: string }[];
    deliveries: { id: string; order_number: string; status: string; created_at: string }[];
    refunds: { id: string; amount_cents: number; status: string; created_at: string }[];
  }>({ loading: false, trips: [], wallet: [], deliveries: [], refunds: [] });

  const [form, setForm] = useState({
    channel: "app",
    category: "general",
    priority: "medium",
    subject: "",
    description: "",
    requester_name: "",
    requester_email: "",
    requester_phone: "",
  });

  /* --------------------------- data loading ------------------------------ */

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, p] = await Promise.all([
        supabase
          .from("support_cases")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(300),
        supabase.from("support_sla_policies").select("*").order("category"),
      ]);
      if (c.error) throw c.error;
      if (p.error) throw p.error;
      setCases((c.data ?? []) as CaseRow[]);
      setPolicies((p.data ?? []) as SlaPolicy[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load customer operations data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Realtime case queue
  useEffect(() => {
    const ch = supabase
      .channel("support-cases-ops")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_cases" }, () => {
        void load();
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [load]);

  const selected = useMemo(
    () => cases.find((c) => c.id === selectedId) ?? null,
    [cases, selectedId],
  );

  const loadCaseDetail = useCallback(async (row: CaseRow) => {
    const [e, n] = await Promise.all([
      supabase
        .from("support_case_events")
        .select("*")
        .eq("case_id", row.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("support_case_notes")
        .select("*")
        .eq("case_id", row.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setEvents((e.data ?? []) as EventRow[]);
    setNotes((n.data ?? []) as NoteRow[]);

    // ---- Customer 360 (reuses existing production tables) ----
    setC360((s) => ({ ...s, loading: true }));
    const uid = row.requester_user_id;
    const [trips, wallet, deliveries, refunds] = await Promise.all([
      uid
        ? supabase.from("fact_trips").select("id,trip_date,fare_cents,payment_method").eq("rider_id", uid).order("trip_date", { ascending: false }).limit(10)
        : Promise.resolve({ data: [] as never[] }),
      uid
        ? supabase.from("wallet_transactions").select("id,amount_cents,kind,status,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(10)
        : Promise.resolve({ data: [] as never[] }),
      uid
        ? supabase.from("delivery_orders").select("id,order_number,status,created_at").eq("customer_id", uid).order("created_at", { ascending: false }).limit(10)
        : Promise.resolve({ data: [] as never[] }),
      supabase.from("refund_requests").select("id,amount_cents,status,created_at").order("created_at", { ascending: false }).limit(5),
    ]);
    setC360({
      loading: false,
      trips: (trips.data ?? []) as never[],
      wallet: (wallet.data ?? []) as never[],
      deliveries: (deliveries.data ?? []) as never[],
      refunds: (refunds.data ?? []) as never[],
    });
  }, []);

  const openCase = useCallback(
    (row: CaseRow) => {
      setSelectedId(row.id);
      void loadCaseDetail(row);
    },
    [loadCaseDetail],
  );

  /* ------------------------------ mutations ------------------------------ */

  const slaFor = useCallback(
    (category: string, priority: string) =>
      policies.find((p) => p.category === category && p.priority === priority) ??
      policies.find((p) => p.category === "general" && p.priority === priority) ?? {
        response_minutes: 240,
        resolution_minutes: 2880,
      },
    [policies],
  );

  const createCase = async () => {
    if (!form.subject.trim()) {
      toast({ title: "Subject required", variant: "destructive" });
      return;
    }
    setBusy(true);
    const sla = slaFor(form.category, form.priority);
    const now = Date.now();
    const { error: err } = await supabase.from("support_cases").insert({
      channel: form.channel,
      category: form.category,
      priority: form.priority,
      severity: form.priority === "urgent" ? "sev1" : form.priority === "high" ? "sev2" : "sev3",
      subject: form.subject.trim(),
      description: form.description.trim() || null,
      requester_name: form.requester_name.trim() || null,
      requester_email: form.requester_email.trim() || null,
      requester_phone: form.requester_phone.trim() || null,
      assigned_team: suggestRouting({ category: form.category, priority: form.priority, severity: "sev3" }),
      sla_response_due_at: new Date(now + sla.response_minutes * 60000).toISOString(),
      sla_resolution_due_at: new Date(now + sla.resolution_minutes * 60000).toISOString(),
      created_by: user?.id ?? null,
    });
    setBusy(false);
    if (err) {
      toast({ title: "Could not create case", description: err.message, variant: "destructive" });
      return;
    }
    toast({ title: "Case created", description: "Routed to " + suggestRouting({ category: form.category, priority: form.priority, severity: "sev3" }) });
    setCreateOpen(false);
    setForm({ ...form, subject: "", description: "" });
    void load();
  };

  type CasePatch = Partial<{
    status: string;
    resolved_at: string;
    closed_at: string;
    assigned_to: string | null;
    first_response_at: string;
    escalation_level: number;
  }>;

  const patchCase = async (row: CaseRow, patch: CasePatch, msg: string) => {
    setBusy(true);
    const { error: err } = await supabase.from("support_cases").update(patch).eq("id", row.id);
    setBusy(false);
    if (err) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
      return;
    }
    toast({ title: msg });
    await load();
    await loadCaseDetail({ ...row, ...(patch as Partial<CaseRow>) } as CaseRow);
  };

  const addNote = async () => {
    if (!selected || !noteBody.trim()) return;
    setBusy(true);
    const { error: err } = await supabase.from("support_case_notes").insert({
      case_id: selected.id,
      author_user_id: user?.id ?? null,
      body: noteBody.trim(),
      visibility: "internal",
    });
    if (!err) {
      await supabase.from("support_case_events").insert({
        case_id: selected.id,
        actor_user_id: user?.id ?? null,
        action: "note_added",
        note: noteBody.trim().slice(0, 180),
      });
    }
    setBusy(false);
    if (err) {
      toast({ title: "Note failed", description: err.message, variant: "destructive" });
      return;
    }
    setNoteBody("");
    await loadCaseDetail(selected);
  };

  /* ------------------------------- metrics ------------------------------- */

  const kpis = useMemo(() => {
    const open = cases.filter((c) => !["resolved", "closed", "cancelled"].includes(c.status));
    const resolved = cases.filter((c) => c.resolved_at);
    const withResponse = cases.filter((c) => c.first_response_at);
    const frt = withResponse.length
      ? withResponse.reduce((s, c) => s + minutesBetween(c.created_at, c.first_response_at!), 0) / withResponse.length
      : 0;
    const mttr = resolved.length
      ? resolved.reduce((s, c) => s + minutesBetween(c.created_at, c.resolved_at!), 0) / resolved.length
      : 0;
    const slaTotal = cases.filter((c) => c.sla_resolution_due_at).length;
    const breached = cases.filter((c) => slaRisk(c).level === "breached").length;
    const compliance = slaTotal ? Math.round(((slaTotal - breached) / slaTotal) * 100) : 100;
    const escalated = cases.filter((c) => c.escalation_level > 0).length;
    const fraud = cases.filter((c) => c.fraud_risk_score >= 60 || c.category === "fraud").length;
    const agents = new Set(cases.map((c) => c.assigned_to).filter(Boolean)).size;
    const aging = open.filter((c) => minutesBetween(c.created_at, new Date().toISOString()) > 2880).length;
    return {
      open: open.length,
      compliance,
      frt,
      mttr,
      escalationRate: cases.length ? Math.round((escalated / cases.length) * 100) : 0,
      fraud,
      agents,
      aging,
      atRisk: cases.filter((c) => slaRisk(c).level === "at_risk").length,
      breached,
    };
  }, [cases]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases.filter((c) => {
      if (statusFilter === "open" && ["resolved", "closed", "cancelled"].includes(c.status)) return false;
      if (statusFilter !== "open" && statusFilter !== "all" && c.status !== statusFilter) return false;
      if (priorityFilter !== "all" && c.priority !== priorityFilter) return false;
      if (channelFilter !== "all" && c.channel !== channelFilter) return false;
      if (!q) return true;
      return (
        c.case_number.toLowerCase().includes(q) ||
        c.subject.toLowerCase().includes(q) ||
        (c.requester_name ?? "").toLowerCase().includes(q) ||
        (c.requester_email ?? "").toLowerCase().includes(q)
      );
    });
  }, [cases, search, statusFilter, priorityFilter, channelFilter]);

  const channelMix = useMemo(() => {
    const m = new Map<string, number>();
    cases.forEach((c) => m.set(c.channel, (m.get(c.channel) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [cases]);

  const rootCauses = useMemo(() => {
    const m = new Map<string, number>();
    cases.forEach((c) => m.set(c.category, (m.get(c.category) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [cases]);

  const history = useMemo(
    () =>
      selected
        ? cases.filter(
            (c) =>
              c.id !== selected.id &&
              selected.requester_user_id &&
              c.requester_user_id === selected.requester_user_id,
          )
        : [],
    [selected, cases],
  );


  const duplicates = selected ? findDuplicates(selected, cases) : [];

  /**
   * Omnichannel interactions built from the data already loaded: each case is
   * the inbound touchpoint, and every note on the open case is the agent-side
   * turn. Threads merge on case id, so the history stays channel-agnostic.
   */
  const interactions = useMemo<Interaction[]>(() => {
    const fromCases: Interaction[] = cases.map((c) => ({
      id: `case-${c.id}`,
      customerKey: c.requester_email ?? c.requester_user_id ?? c.requester_phone ?? c.case_number,
      channel: c.channel,
      subject: c.subject,
      body: c.description,
      direction: "inbound",
      at: c.created_at,
      caseId: c.id,
      authorName: c.requester_name,
    }));
    const fromNotes: Interaction[] = notes.map((n) => ({
      id: `note-${n.id}`,
      customerKey:
        selected?.requester_email ?? selected?.requester_user_id ?? selected?.case_number ?? "unknown",
      channel: selected?.channel ?? "internal",
      subject: selected?.subject ?? null,
      body: n.body,
      direction: n.visibility === "internal" ? "outbound" : "outbound",
      at: n.created_at,
      caseId: n.case_id,
      authorName: n.visibility === "internal" ? "Internal note" : "Agent",
    }));
    return [...fromCases, ...fromNotes];
  }, [cases, notes, selected]);


  /* ------------- integration & intelligence layer (deterministic) --------- */

  const analyticsCases = cases as unknown as AnalyticsCase[];

  const rootCauseRows = useMemo(() => rootCauseAnalysis(analyticsCases), [analyticsCases]);
  const agentRows = useMemo(() => workforceIntelligence(analyticsCases), [analyticsCases]);
  const teamRows = useMemo(() => teamIntelligence(analyticsCases), [analyticsCases]);
  const insights = useMemo(() => executiveInsights(analyticsCases), [analyticsCases]);
  const predictions = useMemo(() => predictiveSignals(analyticsCases), [analyticsCases]);
  const improvements = useMemo(() => improvementLoop(analyticsCases), [analyticsCases]);

  /** Type frequency prior for the statistical classifier. */
  const typeFrequency = useMemo(() => {
    const freq: Record<string, number> = {};
    rootCauseRows.forEach((r) => { freq[r.type] = r.count; });
    return freq;
  }, [rootCauseRows]);

  /** Classification / priority / escalation / evidence for the selected case. */
  const selectedIntel = useMemo(() => {
    if (!selected) return null;
    const classification = runClassification({
      subject: selected.subject,
      description: selected.description,
      category: selected.category,
      channel: selected.channel,
      typeFrequency,
      priorCases: history.map((c) => ({
        subject: c.subject,
        type: runClassification({ subject: c.subject, description: c.description, category: c.category, channel: c.channel }).type,
      })),
    });
    const slaRemaining = selected.sla_resolution_due_at
      ? Math.round((new Date(selected.sla_resolution_due_at).getTime() - Date.now()) / 60000)
      : null;
    const priority = predictPriority(classification.type, {
      isCorporate: Boolean(selected.corporate_account_id),
      fraudScore: selected.fraud_risk_score,
      slaMinutesRemaining: slaRemaining,
      priorCases: history.length,
    });
    const route = autoEscalate(classification.type, Boolean(selected.corporate_account_id), priority.priority);
    const playbook = getPlaybook(classification.type);
    const evidence = assessEvidence(classification.type, {
      priorCases: history.length,
      fraudScore: selected.fraud_risk_score,
      driverIncidentHistory: selected.category === "driver" ? 1 : 0,
      customerClaimsNotReceived: /not (received|delivered|arrive)|never arrived|missing/i.test(
        `${selected.subject} ${selected.description ?? ""}`,
      ),
    });
    return {
      classification,
      priority,
      route,
      playbook,
      evidence,
      knowledge: knowledgeFor(classification.type),
    };
  }, [selected, history, typeFrequency]);

  /** Copilot context for the selected case — reuses the classification above. */
  const copilotContext = useMemo<CopilotCaseContext | null>(() => {
    if (!selected || !selectedIntel) return null;
    return {
      caseNumber: selected.case_number,
      subject: selected.subject,
      description: selected.description,
      category: selected.category,
      tags: selected.tags,
      caseType: selectedIntel.classification.type,
      customerName: selected.requester_name,
      isCorporate: Boolean(selected.corporate_account_id),
      slaBreached: selected.sla_resolution_breached,
      nextActions: selectedIntel.playbook.steps.slice(0, 4).map((s) => s.title),
    };
  }, [selected, selectedIntel]);



  /** Cross-domain traversal coverage across every case type. */
  const traversal = useMemo(
    () =>
      CASE_TYPES.map((def) =>
        checkTraversal(def.type, def.traverses, [...new Set(getPlaybook(def.type).steps.map((s) => s.domain))]),
      ),
    [],
  );
  const traversalOk = traversal.filter((t) => t.ok).length;

  /**
   * Operational dependency map — exchange quality observed from the loaded case
   * set (per-case events are inferred from the cases that require them).
   */
  const exchangeHealth = useMemo(() => {
    const latestFor = (predicate: (c: AnalyticsCase) => boolean) => {
      const matching = analyticsCases.filter(predicate);
      const lastAt = matching.reduce<string | null>(
        (acc, c) => (!acc || new Date(c.created_at) > new Date(acc) ? c.created_at : acc),
        null,
      );
      return { count: matching.length, lastAt };
    };
    const refunds = latestFor((c) => c.category === "payment");
    const delivery = latestFor((c) => c.category === "delivery");
    const driver = latestFor((c) => c.category === "driver");
    const safety = latestFor((c) => c.category === "safety");
    const fraud = latestFor((c) => c.fraud_risk_score >= 60);
    const corporate = latestFor((c) => Boolean(c.corporate_account_id));
    const any = latestFor(() => true);
    return evaluateExchangeHealth([
      { event: "refund.approved", ...refunds },
      { event: "refund.requested", ...refunds },
      { event: "shipment.exception", ...delivery },
      { event: "parcel.investigation.opened", ...delivery },
      { event: "driver.incident.recorded", ...driver },
      { event: "conduct.signal.published", ...driver },
      { event: "rider.trust_score.updated", ...any },
      { event: "fraud.signal.raised", ...fraud },
      { event: "safety.escalation.published", ...safety },
      { event: "corporate.policy.exception", ...corporate },
      { event: "supply.gap.published", ...any },
      { event: "vehicle.defect.reported", ...latestFor((c) => c.category === "rentals") },
      { event: "customerops.kpi.snapshot", ...any },
    ]);
  }, [analyticsCases]);

  const dependency = useMemo(() => dependencyScore(exchangeHealth), [exchangeHealth]);
  const contractCheck = useMemo(() => validateContract(CUSTOMER_OPERATIONS_CONTRACT), []);

  /**
   * Mission Control input — composed from the loaded case set and the observed
   * exchange health so every figure traces back to real platform signals.
   */
  const missionInput = useMemo<MissionControlInput>(() => {
    const now = new Date().toISOString();
    const availability = (predicate: (h: (typeof exchangeHealth)[number]) => boolean) => {
      const scoped = exchangeHealth.filter(predicate);
      if (scoped.length === 0) return 100;
      return Math.round((scoped.filter((h) => h.status === "healthy").length / scoped.length) * 10000) / 100;
    };
    const forDomain = (categories: string[]) => {
      const scoped = analyticsCases.filter((c) => categories.includes(c.category));
      const open = scoped.filter((c) => c.status !== "resolved" && c.status !== "closed");
      return {
        active: open.length,
        breaching: scoped.filter((c) => c.sla_resolution_breached).length,
        backlog: open.filter((c) => Date.now() - new Date(c.created_at).getTime() > 48 * 3600_000).length,
      };
    };
    return {
      domains: [
        { domain: "support", ...forDomain(["general", "account", "app"]), availabilityPct: availability((h) => h.event.startsWith("customerops")), updatedAt: now },
        { domain: "finance", ...forDomain(["payment", "billing"]), availabilityPct: availability((h) => h.event.startsWith("refund")), updatedAt: now },
        { domain: "logistics", ...forDomain(["delivery"]), availabilityPct: availability((h) => h.event.startsWith("shipment") || h.event.startsWith("parcel")), updatedAt: now },
        { domain: "fleet", ...forDomain(["driver", "rentals"]), availabilityPct: availability((h) => h.event.startsWith("driver") || h.event.startsWith("vehicle")), updatedAt: now },
        { domain: "trust_safety", ...forDomain(["safety"]), availabilityPct: availability((h) => h.event.startsWith("safety") || h.event.startsWith("fraud")), updatedAt: now },
        { domain: "corporate", active: analyticsCases.filter((c) => Boolean(c.corporate_account_id)).length, breaching: analyticsCases.filter((c) => Boolean(c.corporate_account_id) && c.sla_resolution_breached).length, backlog: 0, availabilityPct: availability((h) => h.event.startsWith("corporate")), updatedAt: now },
      ],
      revenue: {
        revenueTodayKes: 0, revenueYesterdayKes: 0, pipelineKes: 0, atRiskKes: 0, refundsKes: 0,
      },
      accounts: [],
      sla: {
        openCases: kpis.open,
        atRiskCases: kpis.atRisk,
        breachedCases: kpis.breached,
        throughputPerHour: Math.max(1, kpis.agents * 2),
        horizonHours: 8,
      },
    };
  }, [analyticsCases, exchangeHealth, kpis]);

  /** Orchestration plan for the selected case, driving the command bar. */
  const selectedPlan = useMemo(
    () =>
      selected && selectedIntel
        ? buildOrchestrationPlan({
            caseId: selected.case_number,
            caseType: selectedIntel.classification.type,
            startedAt: selected.created_at,
          })
        : null,
    [selected, selectedIntel],
  );






  /* -------------------------------- render ------------------------------- */

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <EnterpriseHeroBand
        eyebrow="Customer Experience Command Center"
        title="Enterprise Customer Operations Center"
        subtitle="One command center for every commercial line — unified omnichannel conversations, Customer 360, business-line coverage, SLA governance and an AI operations copilot."

        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" aria-hidden />
              New case
            </Button>
          </>
        }
      />

      <SectionErrorBoundary sectionName="Executive Service KPIs">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Open cases" value={kpis.open} icon={<Inbox className="h-5 w-5 text-primary" />} description={`${kpis.aging} aging > 48h`} />
          <StatCard title="SLA compliance" value={`${kpis.compliance}%`} icon={<CheckCircle2 className="h-5 w-5 text-primary" />} description={`${kpis.breached} breached · ${kpis.atRisk} at risk`} />
          <StatCard title="First response" value={kpis.frt ? humanDuration(Math.round(kpis.frt)) : "—"} icon={<Timer className="h-5 w-5 text-primary" />} description="Average across all channels" />
          <StatCard title="Resolution time" value={kpis.mttr ? humanDuration(Math.round(kpis.mttr)) : "—"} icon={<TrendingUp className="h-5 w-5 text-primary" />} description="Mean time to resolve" />
          <StatCard title="Escalation rate" value={`${kpis.escalationRate}%`} icon={<ArrowUpRight className="h-5 w-5 text-primary" />} description="Cases escalated beyond Tier 1" />
          <StatCard title="Fraud investigations" value={kpis.fraud} icon={<ShieldAlert className="h-5 w-5 text-primary" />} description="High-risk or fraud-category cases" />
          <StatCard title="Agent workload" value={kpis.agents} icon={<Users className="h-5 w-5 text-primary" />} description="Agents with assigned cases" />
          <StatCard title="Backlog aging" value={kpis.aging} icon={<AlertTriangle className="h-5 w-5 text-primary" />} description="Open longer than 48 hours" />
        </div>
      </SectionErrorBoundary>

      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="mission">Mission Control</TabsTrigger>
          <TabsTrigger value="decisions">Decision Intelligence</TabsTrigger>
          <TabsTrigger value="queue">Case Queue</TabsTrigger>
          <TabsTrigger value="inbox">Omnichannel Inbox</TabsTrigger>
          <TabsTrigger value="c360">Customer 360</TabsTrigger>
          <TabsTrigger value="liveops">Live Operations</TabsTrigger>
          <TabsTrigger value="performance">Agent Performance</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge Copilot</TabsTrigger>
          <TabsTrigger value="lines">Business Lines</TabsTrigger>
          <TabsTrigger value="sla">SLA & Escalations</TabsTrigger>
          <TabsTrigger value="slaeng">SLA Governance</TabsTrigger>
          <TabsTrigger value="playbooks">Playbooks</TabsTrigger>
          <TabsTrigger value="orchestration">Case Orchestration</TabsTrigger>
          <TabsTrigger value="analytics">Service Analytics</TabsTrigger>
          <TabsTrigger value="rootcause">Root Cause & Prediction</TabsTrigger>
          <TabsTrigger value="workforce">Workforce Intelligence</TabsTrigger>
          <TabsTrigger value="integration">Integration Matrix</TabsTrigger>
          <TabsTrigger value="copilot">AI Operations Copilot</TabsTrigger>
          <TabsTrigger value="workbench">Copilot Workbench</TabsTrigger>
        </TabsList>

        {/* ------------------------ MISSION CONTROL ------------------------- */}
        <TabsContent value="mission">
          <SectionErrorBoundary sectionName="Enterprise mission control">
            <MissionControlPanel roles={roles} input={missionInput} />
          </SectionErrorBoundary>
        </TabsContent>

        {/* --------------------- DECISION INTELLIGENCE ---------------------- */}
        <TabsContent value="decisions">
          <SectionErrorBoundary sectionName="Decision intelligence">
            <DecisionIntelligencePanel roles={roles} input={missionInput} />
          </SectionErrorBoundary>
        </TabsContent>

        {/* -------------------------- OMNICHANNEL --------------------------- */}
        <TabsContent value="inbox">
          <OmnichannelInboxPanel interactions={interactions} />
        </TabsContent>

        {/* ------------------------ LIVE OPERATIONS ------------------------- */}
        <TabsContent value="liveops">
          <LiveOperationsPanel />
        </TabsContent>

        {/* ----------------------- AGENT PERFORMANCE ------------------------ */}
        <TabsContent value="performance">
          <AgentPerformancePanel cases={analyticsCases} />
        </TabsContent>

        {/* ----------------------- KNOWLEDGE COPILOT ------------------------ */}
        <TabsContent value="knowledge">
          <KnowledgeCopilotPanel
            agentName={user?.email ?? null}
            context={
              selected
                ? {
                    caseNumber: selected.case_number,
                    subject: selected.subject,
                    description: selected.description,
                    customerName: selected.requester_name,
                  }
                : null
            }
          />
        </TabsContent>


        {/* ------------------------- BUSINESS LINES ------------------------- */}
        <TabsContent value="orchestration" className="space-y-4">
          {selectedPlan && (
            <SectionErrorBoundary sectionName="Case command bar">
              <CaseCommandBar
                plan={selectedPlan}
                roles={roles}
                actor={user?.email ?? "unknown"}
                canClose={!selected?.sla_resolution_breached}
              />
            </SectionErrorBoundary>
          )}
          <SectionErrorBoundary sectionName="Case orchestration certification">
            <OrchestrationCertificationPanel roles={roles} />
          </SectionErrorBoundary>
        </TabsContent>

        <TabsContent value="lines">
          <BusinessLineCoveragePanel cases={analyticsCases} />
        </TabsContent>

        {/* ------------------------ SLA GOVERNANCE -------------------------- */}
        <TabsContent value="slaeng">
          <SlaGovernancePanel cases={analyticsCases} />
        </TabsContent>

        {/* ----------------------- COPILOT WORKBENCH ------------------------ */}
        <TabsContent value="workbench">
          <CopilotWorkbenchPanel
            roles={roles}
            agentName={user?.email ?? null}
            context={copilotContext}
          />
        </TabsContent>


        {/* ------------------------------ QUEUE ----------------------------- */}
        <TabsContent value="queue">
          <SectionErrorBoundary sectionName="Case Queue">
            <Card>
              <CardHeader className="gap-3">
                <CardTitle className="text-base">Omnichannel case queue</CardTitle>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <Label htmlFor="cops-search" className="sr-only">Search cases</Label>
                    <Input
                      id="cops-search"
                      placeholder="Search case #, subject, customer…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open cases</SelectItem>
                      <SelectItem value="all">All statuses</SelectItem>
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                    <SelectTrigger aria-label="Filter by priority"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All priorities</SelectItem>
                      {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{label(p)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={channelFilter} onValueChange={setChannelFilter}>
                    <SelectTrigger aria-label="Filter by channel"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All channels</SelectItem>
                      {CHANNELS.map((c) => <SelectItem key={c} value={c}>{label(c)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <AsyncState
                  loading={loading}
                  error={error}
                  isEmpty={filtered.length === 0}
                  emptyTitle="No cases match these filters"
                  emptyMessage="Adjust the filters, or create a case to start tracking a customer issue end to end."
                  onRetry={() => void load()}
                >
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead scope="col">Case</TableHead>
                          <TableHead scope="col">Customer</TableHead>
                          <TableHead scope="col">Channel</TableHead>
                          <TableHead scope="col">Category</TableHead>
                          <TableHead scope="col">Priority</TableHead>
                          <TableHead scope="col">Status</TableHead>
                          <TableHead scope="col">SLA</TableHead>
                          <TableHead scope="col">Routed to</TableHead>
                          <TableHead scope="col" className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((c) => {
                          const risk = slaRisk(c);
                          return (
                            <TableRow key={c.id}>
                              <TableCell className="font-medium">
                                <div>{c.case_number}</div>
                                <div className="text-xs text-muted-foreground max-w-[220px] truncate">{c.subject}</div>
                              </TableCell>
                              <TableCell className="text-sm">
                                {c.requester_name ?? c.requester_email ?? "—"}
                              </TableCell>
                              <TableCell className="text-sm capitalize">{label(c.channel)}</TableCell>
                              <TableCell className="text-sm capitalize">{label(c.category)}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={priorityTone[c.priority]}>{c.priority}</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={statusTone[c.status]}>{label(c.status)}</Badge>
                              </TableCell>
                              <TableCell>
                                <span
                                  className={
                                    risk.level === "breached"
                                      ? "text-xs text-destructive"
                                      : risk.level === "at_risk"
                                        ? "text-xs text-status-warning"
                                        : "text-xs text-muted-foreground"
                                  }
                                >
                                  {risk.text}
                                </span>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {c.assigned_team ?? suggestRouting(c)}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button size="sm" variant="outline" onClick={() => openCase(c)}>
                                  Open
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </AsyncState>
              </CardContent>
            </Card>
          </SectionErrorBoundary>
        </TabsContent>

        {/* --------------------------- CUSTOMER 360 -------------------------- */}
        <TabsContent value="c360">
          <SectionErrorBoundary sectionName="Customer 360">
            {!selected ? (
              <Card>
                <CardContent className="p-10 text-center text-muted-foreground">
                  <UserCircle2 className="h-6 w-6 mx-auto mb-2" aria-hidden />
                  <p className="font-medium text-foreground">Select a case to open Customer 360</p>
                  <p className="text-sm mt-1">Open a case from the queue to see the unified customer timeline — rides, deliveries, wallet, refunds, prior cases and audit history.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <Customer360Panel
                  identity={{
                    userId: selected.requester_user_id ?? null,
                    name: selected.requester_name,
                    email: selected.requester_email,
                    phone: selected.requester_phone,
                    corporateAccountId: selected.corporate_account_id ?? null,
                    caseNumber: selected.case_number,
                  }}
                />
                <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2 space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        {selected.case_number} · {selected.subject}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className={statusTone[selected.status]}>{label(selected.status)}</Badge>
                        <Badge variant="outline" className={priorityTone[selected.priority]}>{selected.priority}</Badge>
                        <Badge variant="outline">{label(selected.channel)}</Badge>
                        <Badge variant="outline">{label(selected.category)}</Badge>
                        <Badge variant="outline">Escalation L{selected.escalation_level}</Badge>
                      </div>
                      {selected.description && (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.description}</p>
                      )}
                      <dl className="grid gap-3 sm:grid-cols-3 text-sm">
                        <div><dt className="text-muted-foreground text-xs">Customer</dt><dd>{selected.requester_name ?? "—"}</dd></div>
                        <div><dt className="text-muted-foreground text-xs">Email</dt><dd className="truncate">{selected.requester_email ?? "—"}</dd></div>
                        <div><dt className="text-muted-foreground text-xs">Phone</dt><dd>{selected.requester_phone ?? "—"}</dd></div>
                      </dl>

                      <div className="flex flex-wrap gap-2">
                        <Select
                          value={selected.status}
                          onValueChange={(v) =>
                            void patchCase(
                              selected,
                              {
                                status: v,
                                ...(v === "resolved" ? { resolved_at: new Date().toISOString() } : {}),
                                ...(v === "closed" ? { closed_at: new Date().toISOString() } : {}),
                              },
                              `Case moved to ${label(v)}`,
                            )
                          }
                        >
                          <SelectTrigger className="w-[200px]" aria-label="Change case status"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STATUSES.map((s) => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void patchCase(
                              selected,
                              { assigned_to: user?.id ?? null, status: selected.status === "new" ? "assigned" : selected.status },
                              "Case claimed",
                            )
                          }
                        >
                          Claim case
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void patchCase(
                              selected,
                              { first_response_at: new Date().toISOString() },
                              "First response recorded",
                            )
                          }
                        >
                          Mark first response
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={() =>
                            void patchCase(
                              selected,
                              { escalation_level: selected.escalation_level + 1, status: "escalated" },
                              "Case escalated",
                            )
                          }
                        >
                          Escalate
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="text-base">Unified customer activity</CardTitle></CardHeader>
                    <CardContent>
                      <AsyncState
                        loading={c360.loading}
                        error={null}
                        isEmpty={
                          !c360.loading &&
                          c360.trips.length + c360.wallet.length + c360.deliveries.length + c360.refunds.length === 0
                        }
                        emptyTitle="No linked activity"
                        emptyMessage="This case has no signed-in customer linked, so ride, delivery and wallet history is unavailable."
                      >
                        <div className="grid gap-4 sm:grid-cols-2">
                          <section aria-label="Ride history">
                            <h3 className="text-sm font-medium mb-2">Rides</h3>
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              {c360.trips.map((t) => (
                                <li key={t.id}>{new Date(t.trip_date).toLocaleDateString()} · KES {((t.fare_cents ?? 0) / 100).toFixed(2)} · {t.payment_method ?? "—"}</li>
                              ))}
                              {c360.trips.length === 0 && <li>No rides</li>}
                            </ul>
                          </section>
                          <section aria-label="Delivery history">
                            <h3 className="text-sm font-medium mb-2">Deliveries</h3>
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              {c360.deliveries.map((d) => (
                                <li key={d.id}>{d.order_number} · {d.status}</li>
                              ))}
                              {c360.deliveries.length === 0 && <li>No deliveries</li>}
                            </ul>
                          </section>
                          <section aria-label="Wallet activity">
                            <h3 className="text-sm font-medium mb-2">Wallet</h3>
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              {c360.wallet.map((w) => (
                                <li key={w.id}>{w.kind} · KES {(w.amount_cents / 100).toFixed(2)} · {w.status}</li>
                              ))}
                              {c360.wallet.length === 0 && <li>No wallet activity</li>}
                            </ul>
                          </section>
                          <section aria-label="Refund activity">
                            <h3 className="text-sm font-medium mb-2">Refunds</h3>
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              {c360.refunds.map((r) => (
                                <li key={r.id}>KES {(r.amount_cents / 100).toFixed(2)} · {r.status}</li>
                              ))}
                              {c360.refunds.length === 0 && <li>No refunds</li>}
                            </ul>
                          </section>
                        </div>
                      </AsyncState>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" aria-hidden />Auditable case timeline</CardTitle></CardHeader>
                    <CardContent>
                      <AsyncState loading={false} error={null} isEmpty={events.length === 0} emptyTitle="No timeline entries yet">
                        <ol className="space-y-3">
                          {events.map((e) => (
                            <li key={e.id} className="border-l-2 border-border pl-3">
                              <p className="text-sm font-medium">{label(e.action)}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(e.created_at).toLocaleString()}
                                {e.from_value || e.to_value ? ` · ${e.from_value ?? "—"} → ${e.to_value ?? "—"}` : ""}
                              </p>
                              {e.note && <p className="text-xs mt-1">{e.note}</p>}
                            </li>
                          ))}
                        </ol>
                      </AsyncState>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-4">
                  <Card>
                    <CardHeader><CardTitle className="text-base">Fraud & abuse indicators</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {fraudIndicators(selected, history.length).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No fraud indicators detected for this case.</p>
                      ) : (
                        fraudIndicators(selected, history.length).map((f) => (
                          <p key={f} className="text-sm text-destructive flex items-start gap-2">
                            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />{f}
                          </p>
                        ))
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="text-base">Previous cases</CardTitle></CardHeader>
                    <CardContent>
                      {history.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No prior cases for this customer.</p>
                      ) : (
                        <ul className="space-y-2 text-sm">
                          {history.slice(0, 8).map((h) => (
                            <li key={h.id}>
                              <button className="text-primary hover:underline text-left" onClick={() => openCase(h)}>
                                {h.case_number} — {h.subject}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="text-base">Internal collaboration</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      <Label htmlFor="cops-note">Add internal note</Label>
                      <Textarea
                        id="cops-note"
                        value={noteBody}
                        onChange={(e) => setNoteBody(e.target.value)}
                        placeholder="Share findings with the team…"
                        rows={3}
                      />
                      <Button size="sm" disabled={busy || !noteBody.trim()} onClick={() => void addNote()}>
                        Post note
                      </Button>
                      <ul className="space-y-2 pt-2">
                        {notes.map((n) => (
                          <li key={n.id} className="text-xs">
                            <span className="text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span>
                            <p className="text-sm">{n.body}</p>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
                </div>
              </div>
            )}
          </SectionErrorBoundary>
        </TabsContent>

        {/* ------------------------------- SLA ------------------------------ */}
        <TabsContent value="sla">
          <SectionErrorBoundary sectionName="SLA & Escalations">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base">SLA policies</CardTitle></CardHeader>
                <CardContent>
                  <AsyncState loading={loading} error={error} isEmpty={policies.length === 0} emptyTitle="No SLA policies configured" onRetry={() => void load()}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead scope="col">Category</TableHead>
                          <TableHead scope="col">Priority</TableHead>
                          <TableHead scope="col">Response</TableHead>
                          <TableHead scope="col">Resolution</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {policies.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="capitalize">{label(p.category)}</TableCell>
                            <TableCell className="capitalize">{p.priority}</TableCell>
                            <TableCell>{humanDuration(p.response_minutes)}</TableCell>
                            <TableCell>{humanDuration(p.resolution_minutes)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AsyncState>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Breach prediction & escalations</CardTitle></CardHeader>
                <CardContent>
                  <AsyncState
                    loading={loading}
                    error={error}
                    isEmpty={cases.filter((c) => slaRisk(c).level !== "ok").length === 0}
                    emptyTitle="All cases within SLA"
                    emptyMessage="No case is currently breached or predicted to breach its resolution target."
                    onRetry={() => void load()}
                  >
                    <ul className="space-y-2">
                      {cases
                        .filter((c) => slaRisk(c).level !== "ok")
                        .slice(0, 20)
                        .map((c) => {
                          const r = slaRisk(c);
                          return (
                            <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{c.case_number} · {c.subject}</p>
                                <p className={r.level === "breached" ? "text-xs text-destructive" : "text-xs text-status-warning"}>{r.text}</p>
                              </div>
                              <Button size="sm" variant="outline" onClick={() => openCase(c)}>Review</Button>
                            </li>
                          );
                        })}
                    </ul>
                  </AsyncState>
                </CardContent>
              </Card>
            </div>
          </SectionErrorBoundary>
        </TabsContent>

        {/* ---------------------------- ANALYTICS --------------------------- */}
        <TabsContent value="analytics">
          <SectionErrorBoundary sectionName="Service Analytics">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base">Channel mix</CardTitle></CardHeader>
                <CardContent>
                  <AsyncState loading={loading} error={error} isEmpty={channelMix.length === 0} emptyTitle="No case volume yet" onRetry={() => void load()}>
                    <ul className="space-y-2">
                      {channelMix.map(([ch, n]) => (
                        <li key={ch}>
                          <div className="flex justify-between text-sm mb-1"><span className="capitalize">{label(ch)}</span><span>{n}</span></div>
                          <div className="h-2 rounded bg-muted overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${(n / cases.length) * 100}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </AsyncState>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Root cause distribution</CardTitle></CardHeader>
                <CardContent>
                  <AsyncState loading={loading} error={error} isEmpty={rootCauses.length === 0} emptyTitle="No categorised cases yet" onRetry={() => void load()}>
                    <ul className="space-y-2">
                      {rootCauses.map(([cat, n]) => (
                        <li key={cat}>
                          <div className="flex justify-between text-sm mb-1"><span className="capitalize">{label(cat)}</span><span>{n}</span></div>
                          <div className="h-2 rounded bg-muted overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${(n / cases.length) * 100}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </AsyncState>
                </CardContent>
              </Card>
            </div>
          </SectionErrorBoundary>
        </TabsContent>

        {/* ----------------------------- COPILOT ---------------------------- */}
        <TabsContent value="copilot">
          <SectionErrorBoundary sectionName="AI Operations Copilot">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Deterministic operations intelligence (live)</CardTitle></CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    {!selected ? (
                      <p className="text-muted-foreground">Open a case from the queue to generate routing, duplicate and response intelligence.</p>
                    ) : (
                      <>
                        <div>
                          <p className="font-medium">Suggested routing</p>
                          <p className="text-muted-foreground">{suggestRouting(selected)}</p>
                        </div>
                        <div>
                          <p className="font-medium">Priority score</p>
                          <p className="text-muted-foreground">
                            {selected.priority.toUpperCase()} · {selected.severity.toUpperCase()} · escalation L{selected.escalation_level}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium">Duplicate detection</p>
                          <p className="text-muted-foreground">
                            {duplicates.length === 0
                              ? "No likely duplicates detected."
                              : `${duplicates.length} likely duplicate(s): ${duplicates.map((d) => d.case_number).join(", ")}`}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium">SLA breach prediction</p>
                          <p className="text-muted-foreground">{slaRisk(selected).text}</p>
                        </div>
                        <div>
                          <p className="font-medium">Suggested response template</p>
                          <p className="text-muted-foreground whitespace-pre-wrap">
                            {RESPONSE_TEMPLATES[selected.category] ?? RESPONSE_TEMPLATES.general}
                          </p>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Copilot roadmap — defined capabilities (preview only · backend AI not connected)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        { t: "Automatic classification", d: "Assigns one of 11 enterprise case types from free text, replacing the generic 'complaint' label.", s: "Deterministic engine live · model inference preview" },
                        { t: "Priority prediction", d: "Scores customer value, SLA budget, corporate tier, fraud score, legal exposure and payment amount.", s: "Deterministic engine live · model inference preview" },
                        { t: "Auto escalation", d: "Routes safety → Trust & Safety, financial → Finance, parcel → Logistics with no human triage.", s: "Deterministic engine live · model inference preview" },
                        { t: "Evidence correlation", d: "Pre-assembles GPS, warehouse scans, POD, OTP, driver history, weather and traffic before the agent opens the case.", s: "Preview" },
                        { t: "Root cause discovery", d: "Clusters cases to surface findings such as '82% from Warehouse B between 2–4 PM'.", s: "Trend engine live · clustering preview" },
                        { t: "Sentiment & churn analysis", d: "Reads inbound tone and predicts customer churn probability.", s: "Preview" },
                        { t: "Knowledge retrieval", d: "Ranks policies, agreements, prior similar cases and response templates for the agent.", s: "Curated knowledge live · retrieval ranking preview" },
                        { t: "Next-best-action", d: "Recommends the next playbook step and drafts the customer communication.", s: "Preview" },
                      ].map((c) => (
                        <div key={c.t} className="rounded-lg border p-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-medium text-sm">{c.t}</p>
                            <Badge variant="outline" className="shrink-0 text-xs">Preview</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{c.d}</p>
                          <p className="text-xs text-muted-foreground/80 mt-1">{c.s}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
              <AiAssistantPanel
                title="Customer Operations Copilot"
                subtitle="Preview shell — backend AI not yet connected"
                disabled
                suggestions={[
                  "Summarise today's escalations",
                  "Which cases will breach SLA in the next hour?",
                  "Detect duplicate disputes for this customer",
                  "Draft a resolution response for this case",
                ]}
              />
            </div>
          </SectionErrorBoundary>
        </TabsContent>

        {/* ---------------------------- PLAYBOOKS --------------------------- */}
        <TabsContent value="playbooks">
          <SectionErrorBoundary sectionName="Operational Playbooks">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">
                    {selectedIntel ? selectedIntel.playbook.title : "Standard operating procedures"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {!selectedIntel ? (
                    <>
                      <p className="text-muted-foreground">
                        Select a case in the queue to load its playbook. Every case type resolves to a
                        configuration-driven SOP with checklist, required evidence, approvals and audit outcome.
                      </p>
                      <ul className="space-y-2">
                        {CASE_TYPES.map((t) => {
                          const p = getPlaybook(t.type);
                          return (
                            <li key={t.type} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                              <div className="min-w-0">
                                <p className="font-medium">{p.title}</p>
                                <p className="text-muted-foreground truncate">{p.objective}</p>
                              </div>
                              <Badge variant="outline" className="shrink-0">{p.steps.length} steps</Badge>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div>
                          <p className="font-medium">Auto-classification</p>
                          <p className="text-muted-foreground">
                            {selectedIntel.classification.definition.label} · {selectedIntel.classification.confidence}% confidence ·{" "}
                            {selectedIntel.classification.agreement}% classifier agreement
                          </p>
                        </div>
                        <div>
                          <p className="font-medium">Predicted priority</p>
                          <p className="text-muted-foreground">
                            {selectedIntel.priority.priority.toUpperCase()} · score {selectedIntel.priority.score}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium">Auto-escalation</p>
                          <p className="text-muted-foreground">{selectedIntel.route.team}</p>
                        </div>
                      </div>
                      {selectedIntel.classification.hierarchy && (
                        <p className="text-muted-foreground">
                          Taxonomy path: {formatPath(selectedIntel.classification.hierarchy)} · reason code{" "}
                          <span className="font-mono text-xs">{selectedIntel.classification.hierarchy.reasonCode.code}</span>
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {selectedIntel.classification.votes.map((v) => (
                          <Badge key={v.classifier} variant="outline" title={v.rationale}>
                            {label(v.kind)} · {v.confidence}%
                          </Badge>
                        ))}
                        {selectedIntel.classification.pending.map((p) => (
                          <Badge key={p.id} variant="outline" className="text-muted-foreground">
                            {label(p.kind)} · preview
                          </Badge>
                        ))}
                      </div>
                      <p className="text-muted-foreground">{selectedIntel.playbook.objective}</p>

                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>Step</TableHead>
                            <TableHead>Domain</TableHead>
                            <TableHead>Required evidence</TableHead>
                            <TableHead>Approval</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedIntel.playbook.steps.map((s, i) => (
                            <TableRow key={s.id}>
                              <TableCell>{i + 1}</TableCell>
                              <TableCell className="font-medium">{s.title}</TableCell>
                              <TableCell><Badge variant="outline">{DOMAIN_LABEL[s.domain]}</Badge></TableCell>
                              <TableCell className="text-muted-foreground">{s.evidence.join(", ")}</TableCell>
                              <TableCell className="text-muted-foreground">{s.approval ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <p className="text-muted-foreground">
                        Audit outcome: {selectedIntel.playbook.auditOutcome} · target resolution{" "}
                        {humanDuration(selectedIntel.playbook.targetResolutionMinutes)}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Evidence evaluation</CardTitle></CardHeader>
                  <CardContent className="text-sm space-y-3">
                    {!selectedIntel ? (
                      <p className="text-muted-foreground">
                        Open a case to evaluate GPS, warehouse, delivery, driver and financial evidence — confidence, gaps,
                        contradictions and the recommended next step.
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              selectedIntel.evidence.confidence === "high"
                                ? "text-status-success border-status-success/30"
                                : selectedIntel.evidence.confidence === "medium"
                                  ? "text-status-warning border-status-warning/30"
                                  : "text-destructive border-destructive/30"
                            }
                          >
                            Confidence: {selectedIntel.evidence.confidence} · {selectedIntel.evidence.score}%
                          </Badge>
                          <Badge variant="outline">
                            {selectedIntel.evidence.decisionReady ? "Decision ready" : "Decision blocked"}
                          </Badge>
                        </div>
                        <ul className="space-y-2">
                          {selectedIntel.evidence.items.map((e) => (
                            <li key={e.id} className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">{e.label}</p>
                                <p className="text-muted-foreground">{e.detail}</p>
                              </div>
                              <Badge
                                variant="outline"
                                className={
                                  e.state === "confirmed"
                                    ? "text-status-success border-status-success/30"
                                    : e.state === "missing"
                                      ? "text-destructive border-destructive/30"
                                      : e.state === "conflicting"
                                        ? "text-status-warning border-status-warning/30"
                                        : undefined
                                }
                              >
                                {label(e.state)}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                        {selectedIntel.evidence.contradictions.length > 0 && (
                          <div>
                            <p className="font-medium">Contradictions</p>
                            <ul className="space-y-1">
                              {selectedIntel.evidence.contradictions.map((c) => (
                                <li key={c.id} className="text-muted-foreground">
                                  {c.statement} <span className="text-foreground">{c.impact}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="rounded-lg border p-3">
                          <p className="font-medium">Recommended next step</p>
                          <p className="text-muted-foreground">{selectedIntel.evidence.nextStep}</p>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base">Knowledge intelligence</CardTitle></CardHeader>
                  <CardContent className="text-sm">
                    {!selectedIntel ? (
                      <p className="text-muted-foreground">Policies, rules and agreements surface automatically per case type.</p>
                    ) : (
                      <ul className="space-y-2">
                        {selectedIntel.knowledge.map((k) => (
                          <li key={k.title}>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="capitalize">{k.kind}</Badge>
                              <span className="font-medium">{k.title}</span>
                            </div>
                            <p className="text-muted-foreground">{k.summary}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </SectionErrorBoundary>
        </TabsContent>

        {/* -------------------- ROOT CAUSE & PREDICTION ---------------------- */}
        <TabsContent value="rootcause">
          <SectionErrorBoundary sectionName="Root Cause & Predictive Operations">
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Root cause analysis & prevention</CardTitle></CardHeader>
                <CardContent>
                  <AsyncState loading={loading} error={error} isEmpty={rootCauseRows.length === 0} emptyTitle="No cases to analyse" onRetry={() => void load()}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Root cause</TableHead>
                          <TableHead>Cases</TableHead>
                          <TableHead>Share</TableHead>
                          <TableHead>Breached</TableHead>
                          <TableHead>Trend</TableHead>
                          <TableHead>Prevention recommendation</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rootCauseRows.map((r) => (
                          <TableRow key={r.type}>
                            <TableCell className="font-medium">{r.label}</TableCell>
                            <TableCell>{r.count}</TableCell>
                            <TableCell>{r.share}%</TableCell>
                            <TableCell>{r.breached}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={r.trend === "up" ? "text-destructive border-destructive/30" : undefined}>
                                {r.trend === "up" ? `▲ +${r.delta}` : r.trend === "down" ? `▼ ${r.delta}` : "flat"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{r.recommendation}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AsyncState>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-base">Predictive operations</CardTitle></CardHeader>
                  <CardContent>
                    <AsyncState loading={loading} error={error} isEmpty={predictions.length === 0} emptyTitle="No predictive signals" onRetry={() => void load()}>
                      <ul className="space-y-3 text-sm">
                        {predictions.map((p) => (
                          <li key={p.id} className="rounded-lg border p-3 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{p.title}</span>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline">{p.confidence}% confidence</Badge>
                                <Badge
                                  variant="outline"
                                  className={
                                    p.severity === "critical"
                                      ? "text-destructive border-destructive/30"
                                      : p.severity === "warn"
                                        ? "text-status-warning border-status-warning/30"
                                        : undefined
                                  }
                                >
                                  {p.horizon}
                                </Badge>
                              </div>
                            </div>
                            <p className="text-muted-foreground">{p.detail}</p>
                            <p className="text-xs text-muted-foreground/80">Rationale: {p.rationale}</p>
                            <p className="text-xs">
                              <span className="font-medium">Recommended action: </span>
                              <span className="text-muted-foreground">{p.recommendedAction}</span>
                            </p>
                            <p className="text-xs text-muted-foreground/80">
                              Owner: {p.owner} · Expected impact: {p.expectedImpact}
                            </p>
                          </li>
                        ))}

                      </ul>
                    </AsyncState>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Executive decision support</CardTitle></CardHeader>
                  <CardContent>
                    <AsyncState loading={loading} error={error} isEmpty={insights.length === 0} emptyTitle="No cases to interpret" onRetry={() => void load()}>
                      <ul className="space-y-3 text-sm">
                        {insights.map((i) => (
                          <li key={i.question}>
                            <p className="font-medium">{i.question}</p>
                            <p className="text-muted-foreground">{i.answer}</p>
                            <p className="text-xs text-muted-foreground/80">Evidence: {i.evidence}</p>
                          </li>
                        ))}
                      </ul>
                    </AsyncState>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base">Continuous improvement loop</CardTitle></CardHeader>
                <CardContent>
                  <AsyncState loading={loading} error={error} isEmpty={improvements.length === 0} emptyTitle="No improvement actions yet" onRetry={() => void load()}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Problem</TableHead>
                          <TableHead>Root cause</TableHead>
                          <TableHead>Corrective action</TableHead>
                          <TableHead>Owner</TableHead>
                          <TableHead>Target date</TableHead>
                          <TableHead>Verification</TableHead>
                          <TableHead>Measured improvement</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {improvements.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell>
                              <p className="font-medium">{a.theme}</p>
                              <p className="text-xs text-muted-foreground">{a.problem}</p>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{a.rootCause}</TableCell>
                            <TableCell className="text-muted-foreground">{a.action}</TableCell>
                            <TableCell>{a.owner}</TableCell>
                            <TableCell className="font-mono text-xs">{a.targetDate}</TableCell>
                            <TableCell className="text-muted-foreground">{a.verification}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {a.measurement}: {a.baseline} → {a.target}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  a.status === "open"
                                    ? "text-destructive border-destructive/30"
                                    : a.status === "closed"
                                      ? "text-status-success border-status-success/30"
                                      : "text-status-warning border-status-warning/30"
                                }
                              >
                                {label(a.status)}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                  </AsyncState>
                </CardContent>
              </Card>
            </div>
          </SectionErrorBoundary>
        </TabsContent>

        {/* -------------------------- WORKFORCE ----------------------------- */}
        <TabsContent value="workforce">
          <SectionErrorBoundary sectionName="Workforce Intelligence">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base">Agent performance & utilisation</CardTitle></CardHeader>
                <CardContent>
                  <AsyncState loading={loading} error={error} isEmpty={agentRows.length === 0} emptyTitle="No assigned cases" onRetry={() => void load()}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Agent</TableHead>
                          <TableHead>Open</TableHead>
                          <TableHead>Resolved</TableHead>
                          <TableHead>AHT</TableHead>
                          <TableHead>SLA</TableHead>
                          <TableHead>Utilisation</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {agentRows.map((a) => (
                          <TableRow key={a.agent}>
                            <TableCell className="font-mono text-xs">
                              {a.agent === "unassigned" ? "Unassigned" : `${a.agent.slice(0, 8)}…`}
                            </TableCell>
                            <TableCell>{a.open}</TableCell>
                            <TableCell>{a.resolved}</TableCell>
                            <TableCell>{a.avgHandleMinutes != null ? humanDuration(a.avgHandleMinutes) : "—"}</TableCell>
                            <TableCell>{a.slaCompliance}%</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={a.utilisation > 100 ? "text-destructive border-destructive/30" : undefined}>
                                {a.utilisation}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AsyncState>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Team SLA & escalation performance</CardTitle></CardHeader>
                <CardContent>
                  <AsyncState loading={loading} error={error} isEmpty={teamRows.length === 0} emptyTitle="No routed cases" onRetry={() => void load()}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Team</TableHead>
                          <TableHead>Cases</TableHead>
                          <TableHead>Open</TableHead>
                          <TableHead>SLA</TableHead>
                          <TableHead>Escalation</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {teamRows.map((t) => (
                          <TableRow key={t.team}>
                            <TableCell className="font-medium">{t.team}</TableCell>
                            <TableCell>{t.cases}</TableCell>
                            <TableCell>{t.open}</TableCell>
                            <TableCell>{t.slaCompliance}%</TableCell>
                            <TableCell>{t.escalationRate}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AsyncState>
                </CardContent>
              </Card>
            </div>
          </SectionErrorBoundary>
        </TabsContent>

        {/* ------------------------- INTEGRATION ---------------------------- */}
        <TabsContent value="integration">
          <SectionErrorBoundary sectionName="Integration Matrix">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Cross-module signal hub — {INTEGRATION_MATRIX.length} integrations · traversal coverage {traversalOk}/{traversal.length} case types
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead>Direction</TableHead>
                        <TableHead>Consumes from domain</TableHead>
                        <TableHead>Publishes to domain</TableHead>
                        <TableHead>Backing data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {INTEGRATION_MATRIX.map((l) => (
                        <TableRow key={l.domain + l.surface}>
                          <TableCell>
                            <p className="font-medium">{DOMAIN_LABEL[l.domain]}</p>
                            <p className="text-xs text-muted-foreground">{l.surface}</p>
                          </TableCell>
                          <TableCell><Badge variant="outline">{label(l.direction)}</Badge></TableCell>
                          <TableCell className="text-muted-foreground">{l.consumes.join(" · ") || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{l.publishes.join(" · ") || "—"}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{l.backing.join(", ")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Operational dependency map — quality score {dependency.score}% · {dependency.healthy} healthy ·{" "}
                    {dependency.degraded} degraded · {dependency.stale} stale · {dependency.unobserved} unobserved
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>Direction</TableHead>
                        <TableHead>Latency budget</TableHead>
                        <TableHead>Last exchange</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exchangeHealth.map((h) => (
                        <TableRow key={h.event + h.direction}>
                          <TableCell className="font-medium">{DOMAIN_LABEL[h.domain]}</TableCell>
                          <TableCell className="font-mono text-xs">{h.event}</TableCell>
                          <TableCell><Badge variant="outline">{label(h.direction)}</Badge></TableCell>
                          <TableCell className="text-muted-foreground">{humanDuration(h.expectedLatencyMinutes)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {h.minutesSinceLast != null ? `${humanDuration(h.minutesSinceLast)} ago` : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                h.status === "healthy"
                                  ? "text-status-success border-status-success/30"
                                  : h.status === "degraded"
                                    ? "text-status-warning border-status-warning/30"
                                    : "text-destructive border-destructive/30"
                              }
                              title={h.note}
                            >
                              {label(h.status)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Business Capability Contract — {CUSTOMER_OPERATIONS_CONTRACT.title} v{CUSTOMER_OPERATIONS_CONTRACT.version} ·{" "}
                    {contractCheck.completeness}% complete
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 text-sm lg:grid-cols-2">
                  <div>
                    <p className="font-medium">Supported workflows</p>
                    <ul className="text-muted-foreground space-y-1 mt-1">
                      {CUSTOMER_OPERATIONS_CONTRACT.workflows.map((w) => (
                        <li key={w.id}>
                          {w.name} — {w.stages.length} stages, target {humanDuration(w.targetMinutes)}
                        </li>
                      ))}
                    </ul>
                    <p className="font-medium mt-3">Operational KPIs</p>
                    <ul className="text-muted-foreground space-y-1 mt-1">
                      {CUSTOMER_OPERATIONS_CONTRACT.kpis.map((k) => (
                        <li key={k.id}>{k.name} — target {k.target}</li>
                      ))}
                    </ul>
                    <p className="font-medium mt-3">Escalation paths</p>
                    <ul className="text-muted-foreground space-y-1 mt-1">
                      {CUSTOMER_OPERATIONS_CONTRACT.escalationPaths.map((p) => (
                        <li key={p.trigger}>
                          {p.trigger} → {p.owner} ({p.tier}, {humanDuration(p.responseMinutes)})
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium">AI capability roadmap</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {CUSTOMER_OPERATIONS_CONTRACT.aiRoadmap.map((a) => (
                        <Badge
                          key={a.service}
                          variant="outline"
                          title={`${a.description} · Evaluation: ${a.evaluation}`}
                          className={a.status === "live" ? "text-status-success border-status-success/30" : undefined}
                        >
                          {label(a.service)} · {a.status}
                        </Badge>
                      ))}
                    </div>
                    <p className="font-medium mt-3">Failure modes</p>
                    <ul className="text-muted-foreground space-y-1 mt-1">
                      {CUSTOMER_OPERATIONS_CONTRACT.failureModes.map((f) => (
                        <li key={f.id}>
                          {f.mode} — mitigation: {f.mitigation}
                        </li>
                      ))}
                    </ul>
                    <p className="font-medium mt-3">Dependencies</p>
                    <ul className="text-muted-foreground space-y-1 mt-1">
                      {CUSTOMER_OPERATIONS_CONTRACT.dependencies.map((d) => (
                        <li key={d.module}>
                          {label(String(d.module))} — degraded: {d.degradedBehaviour}
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>



              <Card>
                <CardHeader><CardTitle className="text-base">Case-type domain traversal certification</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Case type</TableHead>
                        <TableHead>Required domains</TableHead>
                        <TableHead>Covered by playbook</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {traversal.map((t) => (
                        <TableRow key={t.caseType}>
                          <TableCell className="font-medium">
                            {CASE_TYPES.find((d) => d.type === t.caseType)?.label}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{t.required.map((d) => DOMAIN_LABEL[d]).join(", ")}</TableCell>
                          <TableCell className="text-muted-foreground">{t.covered.map((d) => DOMAIN_LABEL[d]).join(", ") || "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={t.ok ? "text-status-success border-status-success/30" : "text-status-warning border-status-warning/30"}
                            >
                              {t.ok ? "Certified" : `Gap: ${t.missing.map((d) => DOMAIN_LABEL[d]).join(", ")}`}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </SectionErrorBoundary>
        </TabsContent>
      </Tabs>

      {/* ----------------------------- INTAKE ------------------------------ */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Omnichannel case intake</DialogTitle>
            <DialogDescription>
              Log a case from any channel. SLA targets and routing are applied automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="cops-channel">Channel</Label>
                <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                  <SelectTrigger id="cops-channel"><SelectValue /></SelectTrigger>
                  <SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{label(c)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="cops-category">Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger id="cops-category"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{label(c)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="cops-priority">Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger id="cops-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{label(p)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="cops-subject">Subject</Label>
              <Input id="cops-subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="cops-desc">Description</Label>
              <Textarea id="cops-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="cops-name">Customer name</Label>
                <Input id="cops-name" value={form.requester_name} onChange={(e) => setForm({ ...form, requester_name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="cops-email">Email</Label>
                <Input id="cops-email" type="email" value={form.requester_email} onChange={(e) => setForm({ ...form, requester_email: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="cops-phone">Phone</Label>
                <Input id="cops-phone" value={form.requester_phone} onChange={(e) => setForm({ ...form, requester_phone: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Routing preview: {suggestRouting({ category: form.category, priority: form.priority, severity: "sev3" })}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => void createCase()} disabled={busy}>Create case</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
