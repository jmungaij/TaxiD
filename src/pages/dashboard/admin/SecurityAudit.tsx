import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { AppButton } from "@/components/nav/AppButton";

type RtRow = { id: string; user_id: string | null; role_claim: string | null; stream: string; channel: string | null; outcome: string; reason: string | null; request_ip: string | null; created_at: string };
type ShareRow = { id: string; token_hash: string; trip_booking_id: string | null; ip: string | null; user_agent: string | null; outcome: string; accessed_at: string };

function toCsv<T extends Record<string, unknown>>(rows: T[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}
function download(name: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function SecurityAudit() {
  const [tab, setTab] = useState<"realtime" | "share">("realtime");
  const [rt, setRt] = useState<RtRow[]>([]);
  const [sh, setSh] = useState<ShareRow[]>([]);
  const [outcome, setOutcome] = useState<string>("all");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState<string>(() => new Date(Date.now() - 24 * 3600e3).toISOString().slice(0, 16));
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const fromIso = new Date(from).toISOString();
      const toIso = new Date(to).toISOString();
      if (tab === "realtime") {
        let query = supabase.from("realtime_subscription_audit").select("*").gte("created_at", fromIso).lte("created_at", toIso).order("created_at", { ascending: false }).limit(500);
        if (outcome !== "all") query = query.eq("outcome", outcome);
        const { data, error } = await query;
        if (error) throw error;
        setRt((data ?? []) as RtRow[]);
      } else {
        let query = supabase.from("trip_share_access_log").select("*").gte("accessed_at", fromIso).lte("accessed_at", toIso).order("accessed_at", { ascending: false }).limit(500);
        if (outcome !== "all") query = query.eq("outcome", outcome);
        const { data, error } = await query;
        if (error) throw error;
        setSh((data ?? []) as ShareRow[]);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load();   }, [tab]);

  const filteredRt = useMemo(() => rt.filter((r) => !q || [r.stream, r.channel, r.reason, r.role_claim, r.user_id].filter(Boolean).some((x) => String(x).toLowerCase().includes(q.toLowerCase()))), [rt, q]);
  const filteredSh = useMemo(() => sh.filter((r) => !q || [r.token_hash, r.trip_booking_id, r.ip, r.user_agent].filter(Boolean).some((x) => String(x).toLowerCase().includes(q.toLowerCase()))), [sh, q]);

  return (
    <AdminOnly>
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Security Audit</h1>
          <p className="text-sm text-muted-foreground">Realtime subscription authorization events and trip-share access attempts.</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Outcome</label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {tab === "realtime" ? (
                  <>
                    <SelectItem value="allowed">allowed</SelectItem>
                    <SelectItem value="denied">denied</SelectItem>
                  </>
                ) : (
                  ["ok","invalid","expired","revoked","exhausted","pin_required","pin_wrong","locked"].map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground">Search</label>
            <Input placeholder="stream, ip, token, trip id…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="md:col-span-5 flex gap-2">
            <AppButton analytics="admin_security_audit_apply_filters" action="submit" onClick={load} disabled={loading}>{loading ? "Loading…" : "Apply filters"}</AppButton>
            <AppButton analytics="admin_security_audit_page_csv_download" action="submit" variant="outline" onClick={() => {
              const rows = tab === "realtime" ? filteredRt : filteredSh;
              if (!rows.length) return toast.info("No rows to export");
              download(`${tab}-audit-${Date.now()}.csv`, toCsv(rows as unknown as Record<string, unknown>[]));
            }}>Export page CSV</AppButton>
            <Button variant="secondary" onClick={async () => {
              try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) return toast.error("Sign in required");
                const table = tab === "realtime" ? "realtime_subscription_audit" : "trip_share_access_log";
                const url = `${(supabase as unknown as { supabaseUrl: string }).supabaseUrl}/functions/v1/security-audit-export`;
                const res = await fetch(url, {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${session.access_token}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ table, from: new Date(from).toISOString(), to: new Date(to).toISOString(), outcome }),
                });
                if (!res.ok) throw new Error(`Export failed (${res.status})`);
                const blob = await res.blob();
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${table}-${Date.now()}.csv`;
                a.click();
                URL.revokeObjectURL(a.href);
                toast.success("Streaming export complete");
              } catch (e) { toast.error((e as Error).message); }
            }}>Stream full range (server)</Button>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "realtime" | "share")}>
        <TabsList>
          <TabsTrigger value="realtime">Realtime subscriptions ({filteredRt.length})</TabsTrigger>
          <TabsTrigger value="share">Trip share access ({filteredSh.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="realtime">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Stream / channel</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRt.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">{r.user_id ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{r.role_claim ?? "anon"}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{r.stream}{r.channel ? ` / ${r.channel}` : ""}</TableCell>
                      <TableCell>
                        <Badge variant={r.outcome === "allowed" ? "default" : "destructive"}>{r.outcome}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.reason ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.request_ip ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                  {!filteredRt.length && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No events in range.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="share">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Trip</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Token (hash)</TableHead>
                    <TableHead>User agent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSh.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{new Date(r.accessed_at).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={r.outcome === "ok" ? "default" : r.outcome === "locked" ? "destructive" : "secondary"}>{r.outcome}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.trip_booking_id ? (
                          <Link className="underline" to={`/dashboard/admin/trip-share/${r.trip_booking_id}`}>{r.trip_booking_id.slice(0, 8)}…</Link>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.ip ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.token_hash.slice(0, 12)}…</TableCell>
                      <TableCell className="text-xs max-w-[280px] truncate">{r.user_agent ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                  {!filteredSh.length && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No events in range.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </AdminOnly>
  );
}
