/**
 * Recruitment 360 — Candidate Migration Import Centre.
 *
 * Batch dashboard: every historical import is a governed, auditable batch with
 * a lifecycle, quality signals and a rollback position. Recruiters work batches,
 * never loose records.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileUp, Database, ShieldCheck, History, Search, Activity } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import * as mig from "@/lib/recruitment/migration";

const TONE: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning-foreground border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-primary/10 text-primary border-primary/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

const humanise = (v: string) => v.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

export default function RecruitmentImportCentre() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("active");
  const [search, setSearch] = useState("");

  const batches = useQuery({ queryKey: ["rec", "migration", "batches"], queryFn: mig.listBatches });

  const rows = useMemo(() => {
    const all = batches.data ?? [];
    const byTab =
      tab === "all"
        ? all
        : tab === "imported"
          ? all.filter((b) => b.status === "imported")
          : tab === "rolled_back"
            ? all.filter((b) => b.status === "rolled_back")
            : all.filter((b) => !["imported", "rolled_back"].includes(b.status));
    const q = search.trim().toLowerCase();
    return q
      ? byTab.filter((b) =>
          [b.name, b.batch_no, b.source_platform ?? "", b.source_organization ?? ""]
            .some((f) => f.toLowerCase().includes(q)))
      : byTab;
  }, [batches.data, tab, search]);

  const stats = useMemo(() => {
    const all = batches.data ?? [];
    return {
      total: all.length,
      inFlight: all.filter((b) => !["imported", "rolled_back", "failed"].includes(b.status)).length,
      imported: all.filter((b) => b.status === "imported").length,
      reversible: all.filter((b) => b.rollback_available && b.status !== "rolled_back").length,
    };
  }, [batches.data]);

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Candidate Migration & Import Centre"
        lede="Import historical and externally sourced applications while preserving the original evidence, provenance and application history. Nothing is merged automatically and every batch stays reversible."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/staff/recruitment/import/worker">
                <Activity className="mr-2 h-4 w-4" aria-hidden="true" />
                Open document worker monitor
              </Link>
            </Button>
            <Button onClick={() => navigate("/staff/recruitment/import/new")}>
              <FileUp className="mr-2 h-4 w-4" aria-hidden="true" />
              Start a new candidate import
            </Button>
          </div>
        }

      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Database className="h-4 w-4" />} label="Import batches" value={stats.total} />
        <StatCard icon={<FileUp className="h-4 w-4" />} label="In progress" value={stats.inFlight} />
        <StatCard icon={<ShieldCheck className="h-4 w-4" />} label="Imported" value={stats.imported} />
        <StatCard icon={<History className="h-4 w-4" />} label="Reversible" value={stats.reversible} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Import batches</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="imported">Imported</TabsTrigger>
                <TabsTrigger value="rolled_back">Rolled back</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search batch, platform or organisation"
                className="w-64 pl-8"
                aria-label="Search import batches"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {batches.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-sm font-medium">No import batches yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Start an import to bring historical applications, CVs and vacancy history into Recruitment 360 as searchable, evidence-backed records.
              </p>
              <Button className="mt-4" variant="outline" onClick={() => navigate("/staff/recruitment/import/new")}>
                Create the first import batch
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                  <TableHead>Import date</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => {
                  const totals = b.totals ?? {};
                  return (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-medium">{b.name}</div>
                        <div className="text-xs text-muted-foreground">{b.batch_no}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{b.source_platform || humanise(b.source_kind)}</div>
                        {b.source_organization && (
                          <div className="text-xs text-muted-foreground">{b.source_organization}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={TONE[mig.batchStatusTone(b.status)]}>
                          {humanise(b.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{totals.records ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{totals.imported ?? "—"}</TableCell>
                      <TableCell className="text-sm">{b.import_date ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link to={`/staff/recruitment/import/${b.id}`}>Open batch console</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
