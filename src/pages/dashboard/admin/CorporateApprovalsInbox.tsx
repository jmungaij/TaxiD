/**
 * Cross-corporate Approvals Inbox — one queue where a super admin can clear
 * trip approvals sitting in *any* corporate account, instead of opening each
 * Corporate 360 workspace one at a time.
 *
 * Decisions are executed server-side by `corporate-admin-console`
 * (`decide_approval`), which re-checks the role and audits every write.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { workspace360Path } from "@/lib/workspace360/links";
import { invokeCorporateConsole } from "@/lib/corporate/manageAs";
import { ManageAsBanner } from "@/components/corporate/ManageAsBanner";

interface ApprovalRow {
  id: string;
  corporate_id: string;
  ride_type?: string | null;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  estimated_fare_cents?: number | null;
  scheduled_for?: string | null;
  justification?: string | null;
  status?: string | null;
  created_at?: string | null;
}

const money = (cents?: number | null) =>
  `KES ${Math.round((cents ?? 0) / 100).toLocaleString("en-KE")}`;

const when = (value?: string | null) =>
  value ? new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function CorporateApprovalsInbox() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invokeCorporateConsole<{
        approvals: ApprovalRow[];
        corporate_names: Record<string, string>;
      }>({ op: "approvals_inbox" });
      setRows(res.approvals ?? []);
      setNames(res.corporate_names ?? {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [names[r.corporate_id], r.pickup_address, r.dropoff_address, r.ride_type]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, names, query]);

  async function decide(row: ApprovalRow, decision: "approved" | "rejected") {
    setPending(row.id);
    try {
      await invokeCorporateConsole({ op: "decide_approval", approval_id: row.id, decision });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast({
        title: decision === "approved" ? "Trip approved" : "Trip rejected",
        description: `${names[row.corporate_id] ?? "Corporate"} · decision audited.`,
      });
    } catch (e) {
      toast({ title: "Decision failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="corporate-approvals-inbox">
      <ManageAsBanner />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Corporate Approvals Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Every trip awaiting a corporate decision, across all accounts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/admin/corporates">Control Tower</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">
            Pending <span className="font-normal text-muted-foreground">({visible.length})</span>
          </CardTitle>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              aria-label="Search approvals"
              placeholder="Search corporate, route, ride type…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 sm:w-72"
            />
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div role="alert" className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              Could not load the inbox: {error}
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Corporate</TableHead>
                <TableHead>Trip</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead className="text-right">Estimate</TableHead>
                <TableHead className="text-right">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading approvals…</TableCell></TableRow>
              )}
              {!loading && visible.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Inbox is clear.</TableCell></TableRow>
              )}
              {visible.map((r) => (
                <TableRow key={r.id} data-testid={`approval-row-${r.id}`}>
                  <TableCell>
                    <Link to={workspace360Path("corporate", r.corporate_id)} className="font-medium hover:underline">
                      {names[r.corporate_id] ?? "Corporate"}
                    </Link>
                    <p className="text-xs text-muted-foreground">{r.justification ?? "No justification"}</p>
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="outline" className="mb-1">{r.ride_type ?? "ride"}</Badge>
                    <p>{r.pickup_address ?? "—"} → {r.dropoff_address ?? "—"}</p>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {when(r.created_at)}
                    {r.scheduled_for && <p>for {when(r.scheduled_for)}</p>}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{money(r.estimated_fare_cents)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        disabled={pending === r.id}
                        data-testid={`approve-${r.id}`}
                        onClick={() => void decide(r, "approved")}
                      >
                        {pending === r.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending === r.id}
                        data-testid={`reject-${r.id}`}
                        onClick={() => void decide(r, "rejected")}
                      >
                        Reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
