/**
 * WHITE-LABEL OPERATIONS CONSOLE — per-tenant operational truth.
 *
 * Four readings of one tenant, all from records rather than narrative:
 *   Incidents   · severity, status, correlation reference and resolution times
 *   Deliveries  · every webhook attempt with correlation id and failure category
 *   Change log  · change class, approval, application and rollback plan
 *   Evidence    · the append-only, hash-chained audit trail, with chain verification
 *
 * Reads are RLS-scoped; a staff reader sees a tenant because their role allows
 * it, not because the UI asked nicely.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Download, GitCompare, ScrollText, ShieldCheck, Truck } from "lucide-react";

import { AdminOnly } from "@/components/auth/AdminOnly";
import EvidenceVault from "@/components/partners/whitelabel/EvidenceVault";
import IncidentManager from "@/components/partners/whitelabel/IncidentManager";
import TenantDownloads from "@/components/partners/whitelabel/TenantDownloads";
import { StaffPageHeader } from "@/components/staff/primitives";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  fetchChanges, fetchEvidence, fetchTenants, verifyEvidenceChain,
} from "@/lib/partners/whiteLabelTenants";
import { FAILURE_GUIDANCE, fetchWebhookDeliveries, summariseDeliveries } from "@/lib/partners/webhookDeliveries";

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

export default function WhiteLabelOpsConsole() {
  const [params, setParams] = useSearchParams();
  const tenantId = params.get("tenant") ?? "";
  const setTenant = (id: string) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tenant", id);
      return p;
    }, { replace: true });

  const tenantsQ = useQuery({ queryKey: ["wl-ops-tenants"], queryFn: () => fetchTenants() });
  const tenants = tenantsQ.data ?? [];
  const tenant = tenants.find((t) => t.id === tenantId) ?? tenants[0];

  const changesQ = useQuery({
    queryKey: ["wl-ops-changes", tenant?.id],
    queryFn: () => fetchChanges(tenant!.id), enabled: !!tenant,
  });
  const evidenceQ = useQuery({
    queryKey: ["wl-ops-evidence", tenant?.id],
    queryFn: () => fetchEvidence(tenant!.id), enabled: !!tenant,
  });
  const deliveriesQ = useQuery({
    queryKey: ["wl-ops-deliveries", tenant?.partner_id],
    queryFn: () => fetchWebhookDeliveries(tenant!.partner_id), enabled: !!tenant,
  });

  const chain = useMemo(() => verifyEvidenceChain(evidenceQ.data ?? []), [evidenceQ.data]);
  const deliverySummary = useMemo(
    () => summariseDeliveries(deliveriesQ.data ?? []),
    [deliveriesQ.data],
  );

  return (
    <AdminOnly>
      <div className="space-y-6">
        <StaffPageHeader
          title="White-label operations console"
          lede="Incidents, webhook deliveries, change management and the evidence-backed audit trail for one tenant."
        />

        {tenantsQ.isLoading ? (
          <Skeleton className="h-10 w-72" />
        ) : tenants.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No white-label tenants provisioned</CardTitle>
              <CardDescription>
                Provision a tenant from the partner record; it appears here with its full operational
                history from the provisioning evidence onward.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-full max-w-xs">
                <Select value={tenant?.id ?? ""} onValueChange={setTenant}>
                  <SelectTrigger aria-label="Select tenant"><SelectValue placeholder="Select tenant" /></SelectTrigger>
                  <SelectContent>
                    {tenants.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.display_name} · {t.tenant_code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {tenant && (
                <>
                  <Badge variant="outline">{tenant.environment}</Badge>
                  <Badge variant="outline">{tenant.status}</Badge>
                  <Badge variant="outline" className={chain.intact ? "" : "border-destructive text-destructive"}>
                    <ShieldCheck className="mr-1 h-3 w-3" />
                    {chain.intact ? "Evidence chain intact" : "Evidence chain broken"}
                  </Badge>
                </>
              )}
            </div>

            <Tabs defaultValue="incidents">
              <TabsList className="flex w-full flex-wrap">
                <TabsTrigger value="incidents"><AlertTriangle className="mr-2 h-4 w-4" />Incidents</TabsTrigger>
                <TabsTrigger value="deliveries"><Truck className="mr-2 h-4 w-4" />Deliveries</TabsTrigger>
                <TabsTrigger value="changes"><GitCompare className="mr-2 h-4 w-4" />Change log</TabsTrigger>
                <TabsTrigger value="evidence"><ScrollText className="mr-2 h-4 w-4" />Evidence</TabsTrigger>
                <TabsTrigger value="downloads"><Download className="mr-2 h-4 w-4" />Downloads</TabsTrigger>
              </TabsList>

              <TabsContent value="incidents" className="pt-4">
                {tenant && (
                  <IncidentManager
                    tenantId={tenant.id}
                    tenantLabel={`${tenant.display_name} · ${tenant.tenant_code}`}
                  />
                )}
              </TabsContent>

              <TabsContent value="deliveries" className="pt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Webhook deliveries</CardTitle>
                    <CardDescription>
                      {deliverySummary.attempts} attempt(s) · {deliverySummary.delivered} delivered ·{" "}
                      {deliverySummary.failed} failed · {deliverySummary.deadLettered} dead-lettered
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Event</TableHead><TableHead>Correlation</TableHead>
                          <TableHead>Attempt</TableHead><TableHead>Status</TableHead><TableHead>Failure</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(deliveriesQ.data ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">
                            No deliveries recorded.
                          </TableCell></TableRow>
                        )}
                        {(deliveriesQ.data ?? []).slice(0, 100).map((d) => (
                          <TableRow key={d.id}>
                            <TableCell className="font-mono text-xs">{d.event_type}</TableCell>
                            <TableCell className="font-mono text-xs">{d.correlation_id}</TableCell>
                            <TableCell>{d.attempt}</TableCell>
                            <TableCell>{d.status}</TableCell>
                            <TableCell className="text-xs">
                              {d.failure_category
                                ? FAILURE_GUIDANCE[d.failure_category]?.label ?? d.failure_category
                                : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="changes" className="pt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Change management history</CardTitle>
                    <CardDescription>Class, approval, application and the rollback plan of record.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Change</TableHead><TableHead>Class</TableHead>
                          <TableHead>Status</TableHead><TableHead>Approved</TableHead><TableHead>Applied</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(changesQ.data ?? []).length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">
                            No change entries recorded.
                          </TableCell></TableRow>
                        )}
                        {(changesQ.data ?? []).map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>
                              <div className="font-medium">{c.title}</div>
                              {c.rollback_plan && (
                                <div className="text-xs text-muted-foreground">Rollback: {c.rollback_plan}</div>
                              )}
                            </TableCell>
                            <TableCell>{c.change_class}</TableCell>
                            <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                            <TableCell className="text-xs">{fmt(c.approved_at)}</TableCell>
                            <TableCell className="text-xs">{fmt(c.applied_at)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="evidence" className="pt-4">
                {!chain.intact && (
                  <Card className="mb-4 border-destructive">
                    <CardHeader>
                      <CardTitle className="text-destructive">Evidence chain broken</CardTitle>
                      <CardDescription>
                        The hash chain breaks at entry {chain.brokenAt} — the trail below cannot be
                        trusted until this is investigated.
                      </CardDescription>
                    </CardHeader>
                  </Card>
                )}
                {tenant && (
                  <EvidenceVault tenantId={tenant.id} partnerId={tenant.partner_id} />
                )}
              </TabsContent>

              <TabsContent value="downloads" className="pt-4">
                {tenant && <TenantDownloads tenantCode={tenant.tenant_code} />}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AdminOnly>
  );
}
