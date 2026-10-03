import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { workspace360Path } from "@/lib/workspace360/links";
import { normalizeWorkspace360Tab } from "@/lib/workspace360/tabs";
import RiderInvitationsPanel from "@/components/admin/RiderInvitationsPanel";

/**
 * Rider Directory — Phase D7.1 lean listing that deep-links every row into
 * Rider 360 through the canonical Workspace 360 URL helper.
 */
export default function RiderDirectory() {
  const [params] = useSearchParams();
  const forcedTab = params.get("tab");
  const deepTab = forcedTab ? normalizeWorkspace360Tab(forcedTab) : null;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    void (async () => {
      const c: any = supabase;
      const { data } = await c
        .from("rider_profiles")
        .select(
          "id,first_name,last_name,display_name,phone_number,email,status,rider_tier,lifetime_trips,rating_avg",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      setRows(((data as any[]) ?? []));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.display_name, r.first_name, r.last_name, r.email, r.phone_number]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(s)),
    );
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rider Directory</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Search by name, email, phone…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-sm"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rider</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Trips</TableHead>
                <TableHead className="text-right">Rating</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    No riders.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => {
                const name =
                  r.display_name ||
                  [r.first_name, r.last_name].filter(Boolean).join(" ") ||
                  "—";
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to={workspace360Path("rider", r.id, deepTab)}
                        className="font-medium hover:underline"
                        data-testid={`rider-directory-row-${r.id}`}
                      >
                        {name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.email ?? "—"}
                      <br />
                      {r.phone_number ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.status ?? "—"}</Badge>
                    </TableCell>
                    <TableCell>{r.rider_tier ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.lifetime_trips ?? 0}</TableCell>
                    <TableCell className="text-right">
                      {(r.lifetime_trips ?? 0) > 0 ? Number(r.rating_avg ?? 0).toFixed(2) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <RiderInvitationsPanel />
    </div>
  );
}
