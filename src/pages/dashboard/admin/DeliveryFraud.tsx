import { useEffect, useMemo, useState } from "react";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ShieldAlert, CheckCircle2, XCircle, Download, ArrowUpDown, Filter as FilterIcon } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { AppButton } from "@/components/nav/AppButton";
import { AnalyticsEvents } from "@/lib/analyticsEvents";
import { logExportAudit } from "@/lib/exportAudit";
import { applyGuardedTransition, CONFLICT_MESSAGE } from "@/lib/platform/guardedTransition";

interface Signal {
  id: string;
  signal_type: string;
  severity: string;
  package_id: string | null;
  pod_id: string | null;
  job_id: string | null;
  details: Record<string, unknown>;
  status: string;
  created_at: string;
}

const SEV_COLOR: Record<string, string> = {
  critical: "bg-status-danger/10 text-status-danger",
  high: "bg-status-warning/10 text-status-warning",
  medium: "bg-status-warning/10 text-status-warning",
  low: "bg-muted text-muted-foreground",
};

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

const SIGNAL_TYPES = [
  { value: "all", label: "All signal types" },
  { value: "duplicate_pod", label: "Duplicate POD" },
  { value: "duplicate_pod_image", label: "Duplicate POD image" },
  { value: "signer_mismatch", label: "Signer mismatch" },
  { value: "geo_anomaly", label: "Geo anomaly" },
  { value: "eta_anomaly", label: "ETA anomaly" },
  { value: "dispatch_reassignment", label: "Dispatch reassignment" },
];

const SEVERITIES = ["all", "critical", "high", "medium", "low"] as const;
type Sort = "newest" | "oldest" | "severity_desc" | "severity_asc";

export default function DeliveryFraud() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"open" | "all">("open");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sevFilter, setSevFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("newest");

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("delivery_fraud_signals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (statusFilter === "open") q = q.eq("status", "open");
    if (typeFilter !== "all") q = q.eq("signal_type", typeFilter);
    if (sevFilter !== "all") q = q.eq("severity", sevFilter);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setSignals((data as Signal[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`fraud-signals-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "delivery_fraud_signals" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter, sevFilter]);

  const review = async (id: string, status: "reviewed" | "dismissed") => {
    const { data: u } = await supabase.auth.getUser();
    const res = await applyGuardedTransition({
      table: "delivery_fraud_signals",
      id,
      expectedStates: ["open"],
      patch: { status, reviewer_id: u.user?.id, reviewed_at: new Date().toISOString() },
      audit: { flow: "delivery_fraud_review", action: `delivery_fraud_signal.${status}`, entity_type: "delivery_fraud_signals" },
    });
    if (res.outcome === "error") toast.error(res.message ?? "Update failed");
    else if (res.outcome === "conflict") toast.warning(res.message ?? CONFLICT_MESSAGE);
    else {
      toast.success(`Marked ${status}`);
      if (res.auditFailed) toast.warning("Signal updated but the audit entry was rejected.");
    }
    load();
  };

  const filteredSorted = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? signals.filter((s) =>
          [s.signal_type, s.package_id, s.job_id, s.pod_id, JSON.stringify(s.details)]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(term)),
        )
      : signals;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return +new Date(a.created_at) - +new Date(b.created_at);
        case "severity_desc":
          return (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0);
        case "severity_asc":
          return (SEV_RANK[a.severity] ?? 0) - (SEV_RANK[b.severity] ?? 0);
        case "newest":
        default:
          return +new Date(b.created_at) - +new Date(a.created_at);
      }
    });
    return sorted;
  }, [signals, search, sort]);

  const exportCsv = () => {
    if (filteredSorted.length === 0) return toast.info("Nothing to export");
    const rows = filteredSorted.map((s) => ({
      id: s.id,
      signal_type: s.signal_type,
      severity: s.severity,
      status: s.status,
      package_id: s.package_id ?? "",
      pod_id: s.pod_id ?? "",
      job_id: s.job_id ?? "",
      created_at: s.created_at,
      details: JSON.stringify(s.details),
    }));
    const csv = toCsv(rows);
    downloadCsv(`fraud-signals-${Date.now()}.csv`, csv);
    void logExportAudit({
      dataset: "delivery.fraud_signals",
      exportType: "csv",
      rowCount: rows.length,
      byteSize: new Blob([csv]).size,
      filters: { search, sort },
    });
    toast.success(`Exported ${rows.length} signals`);
  };

  return (
    <MarketingLayout>
      <section className="bg-gradient-to-br from-primary to-primary-glow text-primary-foreground">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-7 w-7" /> Delivery Fraud Review
          </h1>
          <p className="opacity-90 text-sm">Duplicate POD, duplicate POD images, signer mismatch, geo anomalies, ETA anomalies, frequent dispatch reassignments.</p>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8 max-w-5xl space-y-4">
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FilterIcon className="h-4 w-4" /> Filters & sort
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "open" | "all")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Signal type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SIGNAL_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Severity</label>
              <Select value={sevFilter} onValueChange={setSevFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground flex items-center gap-1"><ArrowUpDown className="h-3 w-3" /> Sort</label>
              <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="severity_desc">Severity ↓</SelectItem>
                  <SelectItem value="severity_asc">Severity ↑</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Search</label>
              <Input placeholder="id, details…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-between items-center pt-1">
            <span className="text-xs text-muted-foreground">{filteredSorted.length} of {signals.length} signals</span>
            <AppButton size="sm" variant="outline" analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
              aria-label="Export fraud signals to CSV" onClick={exportCsv}
              trackingMeta={{ dataset: "delivery.fraud_signals", export_type: "csv" }}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </AppButton>
          </div>
        </Card>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading signals…</p>
        ) : filteredSorted.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">No fraud signals match these filters.</Card>
        ) : (
          filteredSorted.map((s) => (
            <Card key={s.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge className={SEV_COLOR[s.severity] ?? "bg-muted"}>{s.severity}</Badge>
                    <span className="font-medium capitalize">{s.signal_type.replace(/_/g, " ")}</span>
                    <Badge variant="outline" className="capitalize">{s.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">
                    {new Date(s.created_at).toLocaleString()}
                    {s.package_id && <> · pkg {s.package_id.slice(0, 8)}</>}
                    {s.job_id && <> · job {s.job_id.slice(0, 8)}</>}
                  </div>
                  <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto">{JSON.stringify(s.details, null, 2)}</pre>
                </div>
                {s.status === "open" && (
                  <div className="flex flex-col gap-2">
                    <Button size="sm" onClick={() => review(s.id, "reviewed")}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Mark reviewed
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => review(s.id, "dismissed")}>
                      <XCircle className="h-4 w-4 mr-1" /> Dismiss
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))
        )}
      </section>
    </MarketingLayout>
  );
}
