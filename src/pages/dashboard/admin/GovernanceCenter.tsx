import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { SeoHead } from "@/components/seo/SeoHead";

type Row = Record<string, unknown>;

function useGov(table: string, orderBy?: string) {
  return useQuery({
    queryKey: ["gov", table],
    queryFn: async () => {
      let q = supabase.from(table as never).select("*").limit(200);
      if (orderBy) q = q.order(orderBy, { ascending: true });
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });
}

export default function GovernanceCenter() {
  const caps = useGov("regulatory_caps", "country_code");
  const rules = useGov("compliance_country_rules", "country_code");
  const floors = useGov("country_pricing_floors", "country_code");
  const launches = useGov("country_launch_status", "country_code");
  const contacts = useGov("country_governance_contacts", "country_code");

  const liveCountries = launches.data?.filter((r) => String(r.status) === "live").length ?? 0;
  const plannedCountries = launches.data?.filter((r) => String(r.status) === "planned").length ?? 0;
  const blockingRules = rules.data?.filter((r) => r.is_blocking).length ?? 0;

  return (
    <div className="space-y-6 p-6">
      <SeoHead title="Governance Center · Admin" description="Regulatory caps, country rules, pricing floors and launch status." path="/dashboard/admin/governance-center" />
      <div>
        <h1 className="text-2xl font-bold">Governance Center</h1>
        <p className="text-sm text-muted-foreground">International regulatory posture (NTSA seeded for Kenya).</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Live countries" value={liveCountries} />
        <Stat label="Planned countries" value={plannedCountries} />
        <Stat label="Compliance rules" value={rules.data?.length ?? 0} />
        <Stat label="Blocking rules" value={blockingRules} tone="danger" />
      </div>

      <Tabs defaultValue="caps">
        <TabsList>
          <TabsTrigger value="caps">Regulatory Caps</TabsTrigger>
          <TabsTrigger value="rules">Compliance Rules</TabsTrigger>
          <TabsTrigger value="floors">Pricing Floors</TabsTrigger>
          <TabsTrigger value="launch">Launch Status</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
        </TabsList>

        <TabsContent value="caps">
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">Regulatory Caps</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Country</TableHead><TableHead>Regulator</TableHead><TableHead>Framework</TableHead>
                    <TableHead>Commission %</TableHead><TableHead>Driver share %</TableHead>
                    <TableHead>Min fare</TableHead><TableHead>Surge max</TableHead><TableHead>Vehicle age</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {caps.data?.map((r) => (
                    <TableRow key={String(r.id)}>
                      <TableCell className="font-medium">{String(r.country_code)}</TableCell>
                      <TableCell>{String(r.regulator)}</TableCell>
                      <TableCell className="text-xs">{String(r.framework_ref ?? "—")}</TableCell>
                      <TableCell>{r.commission_pct_max != null ? `${r.commission_pct_max}%` : "—"}</TableCell>
                      <TableCell>{r.driver_share_pct_min != null ? `${r.driver_share_pct_min}%` : "—"}</TableCell>
                      <TableCell>{r.minimum_fare_local != null ? `${r.currency} ${r.minimum_fare_local}` : "—"}</TableCell>
                      <TableCell>{r.surge_multiplier_max != null ? `${r.surge_multiplier_max}×` : "—"}</TableCell>
                      <TableCell>{r.max_vehicle_age_years != null ? `${r.max_vehicle_age_years}y` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules">
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">Compliance Rules</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Country</TableHead><TableHead>Rule</TableHead><TableHead>Applies to</TableHead>
                    <TableHead>Blocking?</TableHead><TableHead>Value</TableHead><TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.data?.map((r) => (
                    <TableRow key={String(r.id)}>
                      <TableCell>{String(r.country_code)}</TableCell>
                      <TableCell className="font-medium">{String(r.rule_key)}</TableCell>
                      <TableCell>{String(r.applies_to)}</TableCell>
                      <TableCell>{r.is_blocking ? <Badge variant="destructive">blocking</Badge> : <Badge variant="outline">soft</Badge>}</TableCell>
                      <TableCell className="text-xs font-mono">{JSON.stringify(r.rule_value)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{String(r.source_ref ?? "—")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="floors">
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">Pricing Floors</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Country</TableHead><TableHead>City</TableHead><TableHead>Ride type</TableHead>
                    <TableHead>Min fare</TableHead><TableHead>Min /km</TableHead><TableHead>Min /min</TableHead><TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {floors.data?.map((r) => (
                    <TableRow key={String(r.id)}>
                      <TableCell>{String(r.country_code)}</TableCell>
                      <TableCell>{String(r.city ?? "—")}</TableCell>
                      <TableCell className="font-medium">{String(r.ride_type)}</TableCell>
                      <TableCell>{String(r.currency)} {String(r.minimum_fare)}</TableCell>
                      <TableCell>{r.minimum_per_km != null ? String(r.minimum_per_km) : "—"}</TableCell>
                      <TableCell>{r.minimum_per_minute != null ? String(r.minimum_per_minute) : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{String(r.source_ref ?? "—")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="launch">
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">Country Launch Status</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Country</TableHead><TableHead>Status</TableHead><TableHead>Launch date</TableHead>
                    <TableHead>Primary city</TableHead><TableHead>Active cities</TableHead><TableHead>Services</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {launches.data?.map((r) => (
                    <TableRow key={String(r.id)}>
                      <TableCell className="font-medium">{String(r.country_name)} ({String(r.country_code)})</TableCell>
                      <TableCell>
                        <Badge variant={String(r.status) === "live" ? "default" : "secondary"}>{String(r.status)}</Badge>
                      </TableCell>
                      <TableCell>{String(r.launch_date ?? "—")}</TableCell>
                      <TableCell>{String(r.primary_city ?? "—")}</TableCell>
                      <TableCell className="text-xs">{Array.isArray(r.active_cities) ? (r.active_cities as string[]).join(", ") : "—"}</TableCell>
                      <TableCell className="text-xs">{Array.isArray(r.services_enabled) ? (r.services_enabled as string[]).join(", ") : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">Regulator Contacts</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Country</TableHead><TableHead>Regulator</TableHead><TableHead>Role</TableHead>
                    <TableHead>Email</TableHead><TableHead>Phone</TableHead><TableHead>SLA (h)</TableHead><TableHead>Primary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.data?.map((r) => (
                    <TableRow key={String(r.id)}>
                      <TableCell>{String(r.country_code)}</TableCell>
                      <TableCell className="font-medium">{String(r.regulator)}</TableCell>
                      <TableCell>{String(r.contact_role ?? "—")}</TableCell>
                      <TableCell className="text-xs">{String(r.email ?? "—")}</TableCell>
                      <TableCell className="text-xs">{String(r.phone ?? "—")}</TableCell>
                      <TableCell>{String(r.response_sla_hours ?? "—")}</TableCell>
                      <TableCell>{r.is_primary ? <Badge>primary</Badge> : <Badge variant="outline">—</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className={`mt-2 text-2xl font-bold ${tone === "danger" ? "text-destructive" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
