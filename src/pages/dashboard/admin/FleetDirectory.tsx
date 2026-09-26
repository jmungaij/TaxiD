import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { workspace360Path } from "@/lib/workspace360/links";

/**
 * Fleet Directory — Phase D7.6 lean listing that deep-links each fleet
 * company into Fleet 360 via the canonical Workspace 360 URL helper.
 */
export default function FleetDirectory() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    void (async () => {
      const c: any = supabase;
      const { data } = await c
        .from("fleet_companies")
        .select("id,legal_name,trading_name,registration_number,entity_type,status,country_id")
        .order("created_at", { ascending: false })
        .limit(200);
      setRows((data as any[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.trading_name, r.legal_name, r.registration_number]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(s)),
    );
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Fleet Directory</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Search by name or registration…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-sm"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fleet</TableHead>
                <TableHead>Registration</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No fleets.</TableCell></TableRow>
              )}
              {filtered.map((r) => {
                const name = r.trading_name || r.legal_name || "—";
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to={workspace360Path("fleet", r.id)}
                        className="font-medium hover:underline"
                        data-testid={`fleet-directory-row-${r.id}`}
                      >
                        {name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{r.registration_number ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.entity_type ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{r.status ?? "—"}</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
