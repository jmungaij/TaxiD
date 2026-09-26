/**
 * WHITE-LABEL INCIDENT MANAGER — create, assign, progress and resolve.
 *
 * Every action goes through a server function that re-checks authority and
 * writes a hash-chained evidence entry, so the incident record and its audit
 * trail cannot diverge. The UI only offers transitions the lifecycle allows.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus, UserCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import {
  INCIDENT_SEVERITIES, INCIDENT_TRANSITIONS, createIncident, updateIncident,
} from "@/lib/partners/whiteLabelOps";
import { fetchIncidents, type WlIncident } from "@/lib/partners/whiteLabelTenants";

interface Props {
  tenantId: string;
  tenantLabel?: string;
  /** Staff and partner managers may act; others see the record only. */
  canWrite?: boolean;
}

const SEVERITY_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  sev1: "destructive",
  sev2: "destructive",
  sev3: "default",
  sev4: "secondary",
};

const OPEN_STATES = new Set(["open", "mitigating", "monitoring"]);

export default function IncidentManager({ tenantId, tenantLabel, canWrite = true }: Props) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("open_only");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const [open, setOpen] = useState(false);
  const [severity, setSeverity] = useState<string>("sev3");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [correlationId, setCorrelationId] = useState("");

  const [resolving, setResolving] = useState<WlIncident | null>(null);
  const [resolution, setResolution] = useState("");

  const incidentsQ = useQuery({
    queryKey: ["wl-incidents", tenantId],
    queryFn: () => fetchIncidents(tenantId),
    enabled: !!tenantId,
  });

  const incidents = useMemo(() => {
    const all = incidentsQ.data ?? [];
    return all.filter((i) => {
      const statusOk =
        statusFilter === "all" ||
        (statusFilter === "open_only" ? OPEN_STATES.has(i.status) : i.status === statusFilter);
      const sevOk = severityFilter === "all" || i.severity === severityFilter;
      return statusOk && sevOk;
    });
  }, [incidentsQ.data, statusFilter, severityFilter]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["wl-incidents", tenantId] });

  const create = useMutation({
    mutationFn: () =>
      createIncident({
        tenantId,
        severity,
        title: title.trim(),
        detail: detail.trim() || undefined,
        correlationId: correlationId.trim() || undefined,
      }),
    onSuccess: (r) => {
      toast.success(`Incident ${r.reference} raised`);
      setOpen(false);
      setTitle("");
      setDetail("");
      setCorrelationId("");
      setSeverity("sev3");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transition = useMutation({
    mutationFn: (input: { incidentId: string; status?: string; resolution?: string; note?: string }) =>
      updateIncident(input),
    onSuccess: (r) => {
      toast.success(`Incident moved to ${r.status}`);
      setResolving(null);
      setResolution("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const claim = useMutation({
    mutationFn: (input: { incidentId: string; assignedTo: string }) =>
      updateIncident({ incidentId: input.incidentId, assignedTo: input.assignedTo }),
    onSuccess: () => {
      toast.success("Incident assigned");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" /> Incidents
              {tenantLabel && <Badge variant="outline">{tenantLabel}</Badge>}
            </CardTitle>
            <CardDescription>
              Each action writes an evidence entry on the tenant's hash-chained audit trail.
            </CardDescription>
          </div>
          {canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="mr-2 h-4 w-4" />Raise incident</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Raise an incident</DialogTitle>
                  <DialogDescription>
                    The reference is allocated server-side. Add the correlation id from the failing
                    request or delivery so the record joins up with the delivery log.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="inc-severity">Severity</Label>
                    <Select value={severity} onValueChange={setSeverity}>
                      <SelectTrigger id="inc-severity"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INCIDENT_SEVERITIES.map((s) => (
                          <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="inc-title">Title</Label>
                    <Input id="inc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="inc-detail">Detail</Label>
                    <Textarea
                      id="inc-detail" rows={3} value={detail}
                      onChange={(e) => setDetail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="inc-corr">Correlation id (optional)</Label>
                    <Input
                      id="inc-corr" value={correlationId}
                      onChange={(e) => setCorrelationId(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => create.mutate()}
                    disabled={create.isPending || !title.trim()}
                  >
                    {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Raise incident
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="w-40 space-y-1.5">
            <Label htmlFor="inc-filter-status" className="text-xs">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger id="inc-filter-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open_only">Open</SelectItem>
                <SelectItem value="all">All</SelectItem>
                {["open", "mitigating", "monitoring", "resolved", "closed"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40 space-y-1.5">
            <Label htmlFor="inc-filter-sev" className="text-xs">Severity</Label>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger id="inc-filter-sev"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {INCIDENT_SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {incidentsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading incidents…</p>
        ) : incidents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No incidents match this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Incident</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs">{i.reference}</TableCell>
                    <TableCell className="max-w-[20rem]">
                      <p className="truncate font-medium">{i.title}</p>
                      {i.correlation_id && (
                        <p className="truncate text-xs text-muted-foreground">
                          correlation {i.correlation_id}
                        </p>
                      )}
                      {i.assigned_to && (
                        <p className="text-xs text-muted-foreground">assigned</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY_VARIANT[i.severity] ?? "outline"}>
                        {i.severity.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell><Badge variant="outline">{i.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(i.opened_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      {canWrite && !i.assigned_to && (
                        <Button
                          size="sm" variant="ghost"
                          onClick={async () => {
                            const { data } = await import("@/integrations/supabase/client")
                              .then((m) => m.supabase.auth.getUser());
                            const uid = data.user?.id;
                            if (!uid) return toast.error("Sign in to take ownership");
                            claim.mutate({ incidentId: i.id, assignedTo: uid });
                          }}
                          disabled={claim.isPending}
                        >
                          <UserCheck className="mr-1.5 h-3.5 w-3.5" />Take
                        </Button>
                      )}
                      {canWrite &&
                        (INCIDENT_TRANSITIONS[i.status] ?? []).map((next) =>
                          next === "resolved" ? (
                            <Button
                              key={next} size="sm" variant="outline"
                              onClick={() => { setResolving(i); setResolution(""); }}
                            >
                              Resolve
                            </Button>
                          ) : (
                            <Button
                              key={next} size="sm" variant="ghost"
                              onClick={() => transition.mutate({ incidentId: i.id, status: next })}
                              disabled={transition.isPending}
                            >
                              {next}
                            </Button>
                          ),
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!resolving} onOpenChange={(next) => !next && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve {resolving?.reference}</DialogTitle>
            <DialogDescription>
              The resolution statement is written to the tenant's audit trail and cannot be edited
              afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="inc-resolution">Resolution</Label>
            <Textarea
              id="inc-resolution" rows={4} value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Root cause, fix applied and preventive action."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolving(null)}>Cancel</Button>
            <Button
              onClick={() =>
                resolving &&
                transition.mutate({
                  incidentId: resolving.id,
                  status: "resolved",
                  resolution: resolution.trim() || undefined,
                })
              }
              disabled={transition.isPending || !resolution.trim()}
            >
              {transition.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Resolve incident
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
