/**
 * Freight & fulfilment enquiry triage queue (admin control tower).
 *
 * Every enquiry recorded by the public `/delivery/enquiry` desk lands here with
 * its response deadline. Staff acknowledge, qualify, quote and close enquiries;
 * the database writes an immutable history entry for every status change and
 * stamps the actor, so triage is auditable rather than a shared spreadsheet.
 *
 * Reads and writes go through RLS: only operations/dispatch/management/admin
 * roles can see or move an enquiry, and nothing here can create one.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Mail,
  Phone,
  RefreshCw,
  Timer,
  UserCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

type Status = "received" | "acknowledged" | "qualifying" | "quoted" | "won" | "lost" | "closed" | "spam";

interface EnquiryRow {
  id: string;
  reference: string;
  offering_code: string;
  service_label: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  company_name: string | null;
  origin_label: string;
  destination_label: string;
  cargo_description: string;
  weight_kg: number | null;
  volume_cbm: number | null;
  shipment_frequency: string;
  target_date: string | null;
  budget_amount: number | null;
  requirements: string | null;
  status: Status;
  owner_id: string | null;
  respond_by: string;
  triage_notes: string | null;
  created_at: string;
  is_test: boolean;
}

const OPEN_STATUSES: Status[] = ["received", "acknowledged", "qualifying", "quoted"];

const FILTERS: { id: string; label: string; statuses: Status[] | null }[] = [
  { id: "open", label: "Open", statuses: OPEN_STATUSES },
  { id: "received", label: "New", statuses: ["received"] },
  { id: "quoted", label: "Quoted", statuses: ["quoted"] },
  { id: "closed", label: "Closed", statuses: ["won", "lost", "closed"] },
  { id: "all", label: "All", statuses: null },
];

/** The states a staff member can move an enquiry into from where it is now. */
const NEXT_STATUSES: Record<Status, Status[]> = {
  received: ["acknowledged", "spam"],
  acknowledged: ["qualifying", "lost"],
  qualifying: ["quoted", "lost"],
  quoted: ["won", "lost"],
  won: ["closed"],
  lost: ["closed"],
  closed: [],
  spam: [],
};

const STATUS_TONE: Record<Status, string> = {
  received: "border-primary/40 text-primary",
  acknowledged: "border-primary/30 text-primary",
  qualifying: "border-muted-foreground/30 text-muted-foreground",
  quoted: "border-primary/40 text-primary",
  won: "border-primary/50 text-primary",
  lost: "border-destructive/40 text-destructive",
  closed: "border-muted-foreground/30 text-muted-foreground",
  spam: "border-destructive/40 text-destructive",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function overdue(row: EnquiryRow): boolean {
  return OPEN_STATUSES.includes(row.status) && new Date(row.respond_by).getTime() < Date.now();
}

export function EnquiryQueue() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<EnquiryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("logistics_enquiries")
      .select("*")
      .order("respond_by", { ascending: true })
      .limit(200);
    if (err) setError(err.message);
    setRows((data ?? []) as EnquiryRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    // Verification/test records stay in the ledger but never sit in the live desk view.
    const live = rows.filter((r) => !r.is_test);
    const f = FILTERS.find((x) => x.id === filter);
    if (!f?.statuses) return live;
    return live.filter((r) => f.statuses!.includes(r.status));
  }, [rows, filter]);

  const counts = useMemo(() => {
    const live = rows.filter((r) => !r.is_test);
    return {
      open: live.filter((r) => OPEN_STATUSES.includes(r.status)).length,
      overdue: live.filter(overdue).length,
      mine: live.filter((r) => r.owner_id === user?.id && OPEN_STATUSES.includes(r.status)).length,
    };
  }, [rows, user?.id]);

  /** Persist a triage move. The DB writes the history entry and the actor. */
  const move = async (row: EnquiryRow, next: Status) => {
    setBusyId(row.id);
    const note = noteDraft[row.id]?.trim();
    const { data, error: err } = await supabase
      .from("logistics_enquiries")
      .update({
        status: next,
        ...(note ? { triage_notes: note } : {}),
        ...(next === "acknowledged" && !row.owner_id ? { owner_id: user?.id ?? null } : {}),
      })
      .eq("id", row.id)
      .select("id, status")
      .maybeSingle();
    setBusyId(null);

    // No returned row means RLS refused the write — never report a fake success.
    if (err || !data) {
      toast({
        title: "Not updated",
        description: err?.message ?? "You do not have permission to move this enquiry.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: `${row.reference} → ${next}`, description: "Recorded with an audit entry." });
    setNoteDraft((d) => ({ ...d, [row.id]: "" }));
    void load();
  };

  const claim = async (row: EnquiryRow) => {
    setBusyId(row.id);
    const { data, error: err } = await supabase
      .from("logistics_enquiries")
      .update({ owner_id: user?.id ?? null })
      .eq("id", row.id)
      .select("id")
      .maybeSingle();
    setBusyId(null);
    if (err || !data) {
      toast({
        title: "Not assigned",
        description: err?.message ?? "You do not have permission to own this enquiry.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: `${row.reference} assigned to you` });
    void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <ClipboardList className="h-5 w-5 text-primary" /> Freight & fulfilment enquiries
          </h2>
          <p className="text-sm text-muted-foreground">
            Specialist-quoted work captured at /delivery/enquiry. {counts.open} open · {counts.overdue} past
            response deadline · {counts.mine} assigned to you.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              filter === f.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-primary/40"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Queue unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : visible.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-3 text-sm font-semibold text-foreground">Nothing in this view</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Enquiries appear here the moment a customer submits one — no seeded records.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((row) => (
            <Card key={row.id} className={`p-4 ${overdue(row) ? "border-destructive/40" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-foreground">{row.reference}</span>
                    <Badge variant="outline" className={STATUS_TONE[row.status]}>
                      {row.status}
                    </Badge>
                    <Badge variant="outline">{row.service_label ?? row.offering_code}</Badge>
                    {row.is_test && <Badge variant="outline">test record</Badge>}
                    {overdue(row) && (
                      <Badge variant="outline" className="border-destructive/40 text-destructive">
                        <Timer className="mr-1 h-3 w-3" /> overdue
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {row.origin_label} → {row.destination_label}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{row.cargo_description}</p>
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{row.shipment_frequency.replace("_", " ").toLowerCase()}</span>
                    {row.weight_kg ? <span>{row.weight_kg} kg</span> : null}
                    {row.volume_cbm ? <span>{row.volume_cbm} cbm</span> : null}
                    {row.target_date ? <span>target {row.target_date}</span> : null}
                    {row.budget_amount ? <span>budget KES {row.budget_amount.toLocaleString("en-KE")}</span> : null}
                  </p>
                  {row.requirements && (
                    <p className="mt-2 text-xs text-muted-foreground">Requirements: {row.requirements}</p>
                  )}
                </div>

                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">{row.contact_name}</p>
                  {row.company_name && <p>{row.company_name}</p>}
                  <p className="flex items-center justify-end gap-1">
                    <Mail className="h-3 w-3" /> {row.contact_email}
                  </p>
                  {row.contact_phone && (
                    <p className="flex items-center justify-end gap-1">
                      <Phone className="h-3 w-3" /> {row.contact_phone}
                    </p>
                  )}
                  <p className="mt-2 flex items-center justify-end gap-1">
                    <Clock className="h-3 w-3" /> respond by {fmtDate(row.respond_by)}
                  </p>
                  <p>received {fmtDate(row.created_at)}</p>
                </div>
              </div>

              {NEXT_STATUSES[row.status].length > 0 && (
                <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
                  <Textarea
                    rows={2}
                    placeholder="Triage note (saved to the audit history with the status change)"
                    value={noteDraft[row.id] ?? ""}
                    onChange={(e) => setNoteDraft((d) => ({ ...d, [row.id]: e.target.value }))}
                  />
                  <div className="flex flex-wrap gap-2">
                    {!row.owner_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === row.id}
                        onClick={() => void claim(row)}
                      >
                        <UserCheck className="mr-2 h-4 w-4" /> Assign to me
                      </Button>
                    )}
                    {NEXT_STATUSES[row.status].map((next) => (
                      <Button
                        key={next}
                        size="sm"
                        variant={next === "lost" || next === "spam" ? "outline" : "default"}
                        disabled={busyId === row.id}
                        onClick={() => void move(row, next)}
                      >
                        Mark {next}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default EnquiryQueue;
