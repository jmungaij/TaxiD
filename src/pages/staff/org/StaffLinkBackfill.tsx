/**
 * STAFF LINK BACKFILL — administrator repair surface.
 *
 * Links existing staff_members rows to platform accounts, matched strictly on a
 * VERIFIED account email. Preview first, then apply. Ambiguous or unverified
 * matches are never linked; the role check is enforced server-side.
 */
import { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { toast } from "sonner";
import { Link2, ShieldCheck } from "lucide-react";
import { runStaffLinkBackfill, type StaffBackfillRow } from "@/lib/workspace/api";
import { AdminOnly } from "@/components/auth/AdminOnly";

export default function StaffLinkBackfill() {
  const [rows, setRows] = useState<StaffBackfillRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const run = useCallback(async (dryRun: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await runStaffLinkBackfill(dryRun);
      setRows(res);
      setApplied(!dryRun);
      const linked = res.filter((r) => r.action === (dryRun ? "would_link" : "linked")).length;
      toast.success(dryRun ? "Preview complete" : "Backfill applied", {
        description: dryRun
          ? `${linked} staff record${linked === 1 ? "" : "s"} can be linked.`
          : `${linked} staff record${linked === 1 ? "" : "s"} linked to accounts.`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Backfill failed";
      setError(message === "not_authorized" ? "Administrator role required." : message);
    } finally {
      setLoading(false);
    }
  }, []);

  const linkable = rows?.filter((r) => r.action === "would_link").length ?? 0;

  return (
    <AdminOnly roles={["admin", "super_admin"]}>
      <div className="space-y-6">
        <header className="max-w-3xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Staff identity administration
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Staff link backfill
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Connects existing staff register records to platform logins using a verified email match,
            so ordinary employees reach My Workspace immediately. Nothing is invented: records without
            an email, without a verified account, or with an ambiguous match are skipped and reported.
          </p>
        </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Run the backfill
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button onClick={() => run(true)} disabled={loading} variant="outline">
            {loading ? "Working…" : "Preview matches"}
          </Button>
          <Button onClick={() => run(false)} disabled={loading || linkable === 0}>
            <Link2 className="mr-2 h-4 w-4" aria-hidden />
            Link {linkable > 0 ? `${linkable} record${linkable === 1 ? "" : "s"}` : "matched records"}
          </Button>
          {applied && <Badge variant="outline">Applied</Badge>}
        </CardContent>
      </Card>

        {(rows !== null || loading || error) && (
          <AsyncState
            loading={loading && rows === null}
            error={error}
            isEmpty={!!rows && rows.length === 0}
            emptyTitle="Every staff record is already linked"
            emptyMessage="No unlinked staff register records remain."
            onRetry={() => run(true)}
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Result
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {rows?.length ?? 0} unlinked record{(rows?.length ?? 0) === 1 ? "" : "s"} examined
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Staff no.</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows?.map((r) => (
                      <TableRow key={r.staffId}>
                        <TableCell className="font-medium">{r.fullName ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{r.staffNo ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.email ?? "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant={r.action === "skipped" ? "outline" : "default"}
                            className="text-[10px] uppercase"
                          >
                            {r.action.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.detail}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </AsyncState>
        )}
      </div>
    </AdminOnly>
  );
}
