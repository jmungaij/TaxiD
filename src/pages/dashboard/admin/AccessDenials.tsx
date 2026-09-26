import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Lock } from "lucide-react";

interface DenialRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_roles: string[];
  surface: string;
  requested_path: string | null;
  requested_command: string | null;
  reason: string;
  required_roles: string[] | null;
  ip: string | null;
  risk_score: number | null;
  created_at: string;
}

export default function AccessDenials() {
  const [rows, setRows] = useState<DenialRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("access_denials")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      setRows((data ?? []) as DenialRow[]);
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const byPath: Record<string, number> = {};
    for (const r of rows) {
      const k = r.requested_path ?? r.requested_command ?? "unknown";
      byPath[k] = (byPath[k] ?? 0) + 1;
    }
    const top = Object.entries(byPath).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { total: rows.length, top };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Lock className="h-6 w-6 text-primary" /> Access Denials
        </h1>
        <p className="text-sm text-muted-foreground">
          Every blocked route and Command Palette attempt — used to investigate privilege-escalation attempts.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total denials (500 max)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent>
        </Card>
        <Card className="col-span-1 sm:col-span-2 lg:col-span-3">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Most-targeted resources</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1">
              {stats.top.length === 0 && <div className="text-sm text-muted-foreground">None yet.</div>}
              {stats.top.map(([path, n]) => (
                <div key={path} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs">{path}</span>
                  <Badge variant="outline">{n}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent denials</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Surface</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
                {!loading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No denials recorded.</TableCell></TableRow>}
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{r.user_email ?? r.user_id?.slice(0, 8) ?? "anon"}</TableCell>
                    <TableCell><Badge variant="outline">{r.surface}</Badge></TableCell>
                    <TableCell className="text-xs font-mono">{r.requested_path ?? r.requested_command ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.reason}</TableCell>
                    <TableCell className="text-xs">{(r.user_roles ?? []).join(", ") || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={(r.risk_score ?? 0) >= 35 ? "destructive" : "outline"}>
                        {r.risk_score ?? 0}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
