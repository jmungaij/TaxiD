import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Users, ShieldCheck, RefreshCcw, ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { Link } from "react-router-dom";
import { sanitizeOrFilterTerm } from "@/lib/security/postgrestFilter";

const PAGE_SIZE = 25;

interface ProfileRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
}

const ROLE_TONE: Record<string, string> = {
  super_admin: "bg-destructive/15 text-destructive",
  admin: "bg-primary/15 text-primary",
  finance_admin: "bg-status-warning/15 text-status-warning dark:text-status-warning",
  compliance_admin: "bg-ai/15 text-ai dark:text-ai",
  corporate_admin: "bg-ai/15 text-ai dark:text-ai",
};

/**
 * Users directory — the operational read model behind /dashboard/admin/users.
 * Server-side paginated (never unbounded), sanitized server-side search, and
 * explicit error surfacing so a failed read is never rendered as "no users".
 */
export default function UsersDirectory() {
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [roles, setRoles] = useState<Record<string, string[]>>({});
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const from = page * PAGE_SIZE;
    let query = supabase
      .from("profiles")
      .select("id, full_name, phone, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    const term = sanitizeOrFilterTerm(appliedSearch);
    if (term) query = query.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);

    const { data, count, error: readError } = await query;
    if (readError) {
      setError(readError.message);
      setRows([]);
      setTotal(null);
      setLoading(false);
      return;
    }
    const profiles = (data ?? []) as ProfileRow[];
    setRows(profiles);
    setTotal(count ?? null);

    if (profiles.length > 0) {
      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", profiles.map((p) => p.id));
      if (roleError) setError(`Roles could not be loaded: ${roleError.message}`);
      const grouped: Record<string, string[]> = {};
      for (const r of (roleRows ?? []) as { user_id: string; role: string }[]) {
        (grouped[r.user_id] ??= []).push(r.role);
      }
      setRoles(grouped);
    } else {
      setRoles({});
    }
    setLoading(false);
  }, [page, appliedSearch]);

  useEffect(() => { void load(); }, [load]);

  const lastPage = useMemo(
    () => (total === null ? page : Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)),
    [total, page],
  );

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setAppliedSearch(search);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Users Directory</h1>
          <p className="text-sm text-muted-foreground">
            Every platform account with its assigned titles. Role changes are performed in Staff &amp; Roles.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCcw className="h-4 w-4 mr-2" />Refresh
          </Button>
          <Button asChild>
            <Link to="/dashboard/admin/staff"><ShieldCheck className="h-4 w-4 mr-2" />Manage roles</Link>
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Directory read failed — this list is not authoritative. {error}
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <Card><CardContent className="pt-6">
          <Users className="h-5 w-5 text-primary mb-2" />
          <div className="text-3xl font-bold">{total ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{appliedSearch ? "Matching accounts" : "Total accounts"}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <ShieldCheck className="h-5 w-5 text-primary mb-2" />
          <div className="text-3xl font-bold">{Object.values(roles).filter((r) => r.length > 0).length}</div>
          <div className="text-xs text-muted-foreground">Titled users on this page</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <ScrollText className="h-5 w-5 text-primary mb-2" />
          <div className="text-sm font-medium mt-1">
            <Link className="underline" to="/dashboard/admin/audit-log">Role &amp; admin audit log</Link>
          </div>
          <div className="text-xs text-muted-foreground">Every privileged change is recorded</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Accounts</CardTitle>
          <form onSubmit={submitSearch} className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or phone"
              maxLength={64}
              className="w-56"
            />
            <Button type="submit" variant="secondary" disabled={loading}>
              <Search className="h-4 w-4" />
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Titles</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>User ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {error ? "Unavailable" : "No accounts match this search."}
                </TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.full_name ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.phone ?? "—"}</TableCell>
                  <TableCell className="space-x-1">
                    {(roles[r.id] ?? []).length === 0
                      ? <span className="text-xs text-muted-foreground">rider (default)</span>
                      : (roles[r.id] ?? []).map((role) => (
                        <Badge key={role} className={ROLE_TONE[role] ?? "bg-muted text-muted-foreground"}>{role}</Badge>
                      ))}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}…</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between pt-4">
            <span className="text-xs text-muted-foreground">
              Page {page + 1}{total !== null ? ` of ${lastPage + 1}` : ""}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={loading || page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft className="h-4 w-4" />Previous
              </Button>
              <Button variant="outline" size="sm" disabled={loading || (total !== null && page >= lastPage)} onClick={() => setPage((p) => p + 1)}>
                Next<ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
