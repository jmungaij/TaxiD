/**
 * Charter booking change audit — admin console.
 *
 * Surfaces every material customer-side booking edit written by
 * `recordCharterBookingChange` (cabin layout, seat selection, aircraft gallery
 * views and ground-package edits) with the acting user id and a field-level
 * before/after diff, so commercial changes stay attributable after the fact.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Download, FileSearch, Mail, Loader2 } from "lucide-react";
import { useTableView } from "@/lib/charter/useTableView";
import { CharterWebhookPanel } from "@/components/charter/CharterWebhookPanel";
import { toast } from "@/hooks/use-toast";

const ACTIONS = [
  { value: "all", label: "All change types" },
  { value: "charter_cabin_layout_changed", label: "Cabin layout changed" },
  { value: "charter_seat_selection_changed", label: "Seat selection changed" },
  { value: "charter_gallery_viewed", label: "Aircraft gallery selection" },
  { value: "charter_ground_package_changed", label: "Ground package edited" },
] as const;

const ACTION_LABEL: Record<string, string> = Object.fromEntries(
  ACTIONS.filter((a) => a.value !== "all").map((a) => [a.value, a.label]),
);

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  entity_id: string | null;
  action: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
}

interface DiffLine { field: string; from: string; to: string }

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map(show).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

/** Field-level diff between the before/after snapshots. */
function diffOf(row: AuditRow): DiffLine[] {
  const before = (row.before_data ?? {}) as Record<string, unknown>;
  const after = (row.after_data ?? {}) as Record<string, unknown>;
  return Object.keys({ ...before, ...after })
    .filter((k) => !["reference", "asset_name"].includes(k))
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ field: k, from: show(before[k]), to: show(after[k]) }));
}

const csvEscape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default function CharterBookingAudit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string>("all");
  const [actor, setActor] = useState("");
  const [reference, setReference] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Email delivery of the same filtered dataset.
  const [recipient, setRecipient] = useState("");
  const [emailing, setEmailing] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    let q = (untypedDb)
      .from("audit_logs")
      .select("id,actor_user_id,actor_role,entity_id,action,before_data,after_data,created_at")
      .eq("entity_type", "charter_booking")
      .order("created_at", { ascending: false })
      .limit(500);
    if (action !== "all") q = q.eq("action", action);
    if (from) q = q.gte("created_at", new Date(from).toISOString());
    if (to) q = q.lte("created_at", new Date(`${to}T23:59:59`).toISOString());
    const { data, error: err } = await q;
    if (err) setError(err.message);
    setRows((data ?? []) as AuditRow[]);
    setLoading(false);
  };

  useEffect(() => { void load();   }, [action, from, to]);

  const filtered = useMemo(() => {
    const a = actor.trim().toLowerCase();
    const r = reference.trim().toLowerCase();
    return rows.filter((row) => {
      if (a && !String(row.actor_user_id ?? "").toLowerCase().includes(a)) return false;
      if (r) {
        const ref = String(
          (row.after_data?.reference ?? row.before_data?.reference ?? "") as string,
        ).toLowerCase();
        if (!ref.includes(r) && !String(row.entity_id ?? "").toLowerCase().includes(r)) return false;
      }
      return true;
    });
  }, [rows, actor, reference]);

  const view = useTableView<AuditRow>(filtered, {
    created_at: (r) => r.created_at,
    action: (r) => r.action,
    actor: (r) => r.actor_user_id ?? "",
  }, 25);

  const exportCsv = () => {
    const header = ["created_at", "action", "actor_user_id", "actor_role", "booking_id", "reference", "changes"];
    const lines = [header.join(",")];
    for (const r of filtered) {
      const ref = (r.after_data?.reference ?? r.before_data?.reference ?? "") as string;
      const diff = diffOf(r).map((d) => `${d.field}: ${d.from} -> ${d.to}`).join(" | ");
      lines.push([r.created_at, r.action, r.actor_user_id, r.actor_role, r.entity_id, ref, diff].map(csvEscape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `charter-booking-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Emails the identically filtered CSV as a signed, expiring download link. */
  const emailCsv = async () => {
    setEmailing(true);
    try {
      const { data, error: err } = await supabase.functions.invoke("charter-audit-export", {
        body: { recipient, action, actor, reference, from, to },
      });
      if (err) throw new Error(err.message);
      if (!data?.ok) throw new Error(data?.message ?? data?.error ?? "Export failed");
      toast({
        title: data.emailed ? "Export emailed" : "Export ready (email pending)",
        description: `${data.rows} row(s) sent to ${data.recipient}.${data.email_error ? ` Email issue: ${data.email_error}` : ""}`,
      });
    } catch (e) {
      toast({ title: "Email export failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setEmailing(false);
    }
  };

  return (
    <AdminOnly>
      <div className="p-6 space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-primary" />
              Charter booking change audit
            </h1>
            <p className="text-sm text-muted-foreground">
              Cabin, seat, gallery and ground-package edits with actor and before/after values.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button data-analytics="charterbookingaudit.export_csv" variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="h-4 w-4 mr-1.5" />
              Export CSV
            </Button>
          </div>
        </header>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="cba-action">Change type</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger id="cba-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cba-actor">Actor user id</Label>
              <Input id="cba-actor" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="uuid fragment" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cba-ref">Booking / reference</Label>
              <Input id="cba-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="CH-…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cba-from">From</Label>
              <Input id="cba-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cba-to">To</Label>
              <Input id="cba-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <Label htmlFor="cba-email">Email this filtered export</Label>
              <div className="flex gap-2">
                <Input
                  id="cba-email"
                  type="email"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="compliance@yalla.africa"
                />
                <Button onClick={() => void emailCsv()} disabled={emailing || !recipient}>
                  {emailing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Mail className="h-4 w-4 mr-1.5" />}
                  Send CSV
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Uses the same change type, actor, reference and date range shown above. The link is signed and expires in 7 days.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {filtered.length} change{filtered.length === 1 ? "" : "s"}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => view.setPage(view.page - 1)} disabled={view.page <= 1}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {view.info.page} of {view.info.pageCount}</span>
              <Button
                variant="ghost" size="sm" onClick={() => view.setPage(view.page + 1)}
                disabled={view.page >= view.info.pageCount}
              >
                Next
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {error && <p className="text-sm text-destructive mb-3">{error}</p>}
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : !filtered.length ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No booking changes recorded for these filters.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-3">
                        <button type="button" onClick={() => view.toggleSort("created_at")}>When</button>
                      </th>
                      <th className="py-2 pr-3">
                        <button type="button" onClick={() => view.toggleSort("action")}>Change</button>
                      </th>
                      <th className="py-2 pr-3">
                        <button type="button" onClick={() => view.toggleSort("actor")}>Actor</button>
                      </th>
                      <th className="py-2 pr-3">Booking</th>
                      <th className="py-2">Before → after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((r) => {
                      const diff = diffOf(r);
                      const ref = (r.after_data?.reference ?? r.before_data?.reference ?? "") as string;
                      return (
                        <tr key={r.id} className="border-b align-top">
                          <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                            {new Date(r.created_at).toLocaleString()}
                          </td>
                          <td className="py-2 pr-3">
                            <Badge variant="secondary">{ACTION_LABEL[r.action] ?? r.action}</Badge>
                          </td>
                          <td className="py-2 pr-3 text-xs font-mono break-all">
                            {r.actor_user_id ?? "—"}
                            {r.actor_role && <div className="text-muted-foreground font-sans">{r.actor_role}</div>}
                          </td>
                          <td className="py-2 pr-3 text-xs">
                            <div className="font-medium">{ref || "—"}</div>
                            <div className="text-muted-foreground font-mono break-all">{r.entity_id ?? "draft"}</div>
                          </td>
                          <td className="py-2 text-xs space-y-0.5">
                            {diff.length ? diff.map((d) => (
                              <div key={d.field}>
                                <span className="font-medium">{d.field}</span>:{" "}
                                <span className="text-muted-foreground line-through">{d.from}</span>{" "}
                                → <span className="text-foreground">{d.to}</span>
                              </div>
                            )) : <span className="text-muted-foreground">No field-level change recorded</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        <CharterWebhookPanel />
      </div>
    </AdminOnly>
  );
}
