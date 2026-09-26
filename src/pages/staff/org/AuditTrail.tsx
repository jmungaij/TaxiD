import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ScrollText, Search } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, SelectField } from "@/components/staff/org/OrgForms";
import { downloadCsv, toCsv } from "@/lib/csv";
import * as org from "@/lib/staff/org/api";
import { titleise } from "@/lib/staff/org/types";
import type { OrgAuditEntry } from "@/lib/staff/org/types";

type AuditEntry = OrgAuditEntry & {
  source_of_record?: string | null;
  source_record_id?: string | null;
  staff_id?: string | null;
};

/** Audit families, so an auditor can isolate one governed event class. */
const FAMILIES: { value: string; label: string; prefixes: string[] }[] = [
  { value: "", label: "All governed events", prefixes: [] },
  { value: "assignment", label: "Assignments & appointments", prefixes: ["staff_created", "staff_assignment_changed", "staff_status_changed", "work_assigned", "work_reassigned"] },
  { value: "objective", label: "Objective cascades & results", prefixes: ["objective_"] },
  { value: "capability", label: "Qualification & competency assessments", prefixes: ["qualification_", "competency_"] },
  { value: "work", label: "Work-stage transitions", prefixes: ["work_stage_"] },
  { value: "review", label: "Manager review decisions", prefixes: ["work_review_"] },
  { value: "corrective", label: "Corrective actions", prefixes: ["corrective_action_"] },
];

/**
 * Staff 360 audit trail. Written by database triggers, not by the browser, so
 * the entry exists even when a change is made outside this interface. Each
 * entry names the authoritative system the change belongs to.
 */
export default function AuditTrail() {
  const auditQ = useQuery({ queryKey: ["org", "audit", "all"], queryFn: () => org.listAudit({ limit: 400 }) });
  const staffQ = useQuery({ queryKey: ["org", "staff"], queryFn: org.listStaff });

  const [family, setFamily] = useState("");
  const [staffId, setStaffId] = useState("");
  const [term, setTerm] = useState("");
  const [source, setSource] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const staffName = useMemo(
    () => new Map((staffQ.data ?? []).map((s) => [s.id, s.full_name])),
    [staffQ.data],
  );

  const all = useMemo(
    () => (auditQ.data ?? []) as AuditEntry[],
    [auditQ.data],
  );

  /** Authoritative sources present in the loaded window, for the filter. */
  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const e of all) set.add(e.source_of_record ?? e.entity_table);
    return Array.from(set).sort();
  }, [all]);

  const entries = useMemo(() => {
    const prefixes = FAMILIES.find((f) => f.value === family)?.prefixes ?? [];
    const needle = term.trim().toLowerCase();
    return all.filter((e) => {
      if (staffId && e.staff_id !== staffId) return false;
      if (prefixes.length > 0 && !prefixes.some((p) => e.action.startsWith(p))) return false;
      if (source && (e.source_of_record ?? e.entity_table) !== source) return false;
      const day = e.created_at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (!needle) return true;
      // Free-text search spans the event, the record identifiers and the
      // governed before/after payloads, so an auditor can search by value.
      const hay = [
        e.action, e.entity_table, e.entity_id, e.source_of_record ?? "", e.source_record_id ?? "",
        e.staff_id ? (staffName.get(e.staff_id) ?? "") : "",
        JSON.stringify(e.before_data ?? {}), JSON.stringify(e.after_data ?? {}),
      ].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [all, family, staffId, term, source, from, to, staffName]);

  const exportCsv = () => {
    if (entries.length === 0) { toast.error("No audit entries match the current filters"); return; }
    const rows = entries.map((e) => ({
      occurred_at: e.created_at,
      event: e.action,
      employee: e.staff_id ? (staffName.get(e.staff_id) ?? e.staff_id) : "",
      record_changed: e.entity_table,
      record_id: e.entity_id,
      authoritative_source: e.source_of_record ?? e.entity_table,
      source_record_id: e.source_record_id ?? "",
      actor_user_id: (e as { actor_user_id?: string | null }).actor_user_id ?? "",
      before: JSON.stringify(e.before_data ?? null),
      after: JSON.stringify(e.after_data ?? null),
    }));
    downloadCsv(`staff360-audit-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    toast.success(`Exported ${rows.length} audit entr${rows.length === 1 ? "y" : "ies"}`);
  };

  return (
    <AdminOnly roles={["admin", "super_admin", "compliance_admin", "operations_admin", "finance_admin"]}>
      <StaffPageHeader
        eyebrow="Governance"
        title="Staff 360 audit trail"
        lede="Append-only record of appointments, objective cascades, capability assessments, work-stage transitions, review decisions and corrective actions. Every entry names its authoritative source of record."
        actions={
          <Button variant="outline" data-analytics="staff.org.audit_trail.export_csv" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />Export CSV
          </Button>
        }
      />

      <Card className="mb-6">
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <Label htmlFor="audit-search" className="text-xs">Search</Label>
            <div className="relative mt-1.5">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="audit-search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Event, record id, employee, or any changed value"
                className="pl-9"
              />
            </div>
          </div>
          <SelectField label="Event family" value={family} onChange={setFamily} options={FAMILIES.map((f) => ({ value: f.value, label: f.label }))} placeholder="All governed events" />
          <SelectField label="Employee" value={staffId} onChange={setStaffId} options={(staffQ.data ?? []).map((s) => ({ value: s.id, label: s.full_name }))} placeholder="Everyone" />
          <SelectField label="Authoritative source" value={source} onChange={setSource} options={sources.map((v) => ({ value: v, label: v }))} placeholder="All sources" />
          <div>
            <Label htmlFor="audit-from" className="text-xs">From</Label>
            <Input id="audit-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="audit-to" className="text-xs">To</Label>
            <Input id="audit-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1.5" />
          </div>
          <div className="flex items-end justify-between gap-3 md:col-span-2 xl:col-span-3">
            <p className="text-xs text-muted-foreground">
              {entries.length} of {all.length} loaded entries match. Export reflects the current filters.
            </p>
            {(term || family || staffId || source || from || to) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setTerm(""); setFamily(""); setStaffId(""); setSource(""); setFrom(""); setTo(""); }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {auditQ.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No audit entries match"
          hint="Entries are written automatically when staff, objectives, qualifications, work items, reviews or corrective actions change."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Record changed</TableHead>
                  <TableHead>Authoritative source</TableHead>
                  <TableHead className="text-right">Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <AuditRow key={e.id} entry={e} staffName={staffName} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </AdminOnly>
  );
}

function AuditRow({
  entry, staffName,
}: {
  entry: AuditEntry;
  staffName: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          {new Date(entry.created_at).toLocaleString("en-KE")}
        </TableCell>
        <TableCell className="text-sm font-medium">{titleise(entry.action)}</TableCell>
        <TableCell className="text-sm">{entry.staff_id ? (staffName.get(entry.staff_id) ?? "—") : "—"}</TableCell>
        <TableCell className="font-mono text-xs">{entry.entity_table}</TableCell>
        <TableCell className="font-mono text-xs">
          {entry.source_of_record ?? entry.entity_table}
          {entry.source_record_id && <span className="block text-muted-foreground">{entry.source_record_id.slice(0, 8)}…</span>}
        </TableCell>
        <TableCell className="text-right">
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                <ScrollText className="mr-2 h-4 w-4" />{open ? "Hide" : "Show"}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent />
          </Collapsible>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/40">
            <div className="grid gap-4 md:grid-cols-2">
              <DiffBlock title="Before" data={entry.before_data} />
              <DiffBlock title="After" data={entry.after_data} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

const FIELDS_OF_INTEREST = [
  "status", "review_state", "employment_status", "position_id", "unit_id", "manager_staff_id",
  "verification_status", "assessed_level", "actual", "target", "quality_flag", "decision",
  "rationale", "required_action", "cause_category", "cause_description", "impact_days",
  "impact_value_cents", "resolution", "outcome", "next_action", "staff_id",
];

function DiffBlock({ title, data }: { title: string; data: unknown }) {
  if (!data || typeof data !== "object") {
    return (
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
        <p className="text-xs text-muted-foreground">Not applicable — this entry records a creation.</p>
      </div>
    );
  }
  const record = data as Record<string, unknown>;
  const rows = FIELDS_OF_INTEREST.filter((k) => record[k] !== undefined && record[k] !== null);
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {rows.length === 0 && <span className="text-xs text-muted-foreground">No governed fields recorded.</span>}
        {rows.map((k) => (
          <Badge key={k} variant="outline" className="max-w-full text-[10px] font-normal">
            <span className="text-muted-foreground">{k}:</span>&nbsp;
            <span className="truncate">{String(record[k])}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}
