import type { LooseRow } from "@/lib/types/loose";
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Star, Wallet as WalletIcon, MapPin, Phone, MessageSquare } from "lucide-react";
import {
  Workspace360Shell,
  Workspace360EmptyPanel,
  type Workspace360TabConfig,
} from "@/components/workspace360/Workspace360Shell";

/**
 * Rider 360 — Phase D7.1 lean adoption of Workspace360Shell.
 * Mounts the canonical 11-tab surface for the rider domain and wires it to
 * existing rider data sources only. No new wallet/ledger/twin services are
 * introduced here — those come in later per-domain enrichment phases.
 */
const kes = (c: number | null | undefined) =>
  `KES ${Math.abs((c ?? 0) / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export default function Rider360() {
  const { riderId = "" } = useParams();
  const [rider, setRider] = useState<LooseRow | null>(null);
  const [wallet, setWallet] = useState<{ id: string; balance_cents: number } | null>(null);
  const [txns, setTxns] = useState<LooseRow[]>([]);
  const [trips, setTrips] = useState<LooseRow[]>([]);
  const [kyc, setKyc] = useState<LooseRow[]>([]);
  const [incidents, setIncidents] = useState<LooseRow[]>([]);
  const [sosAlerts, setSosAlerts] = useState<LooseRow[]>([]);
  const [fraudSignals, setFraudSignals] = useState<LooseRow[]>([]);
  const [trust, setTrust] = useState<LooseRow | null>(null);
  const [behavior, setBehavior] = useState<LooseRow | null>(null);
  const [notifications, setNotifications] = useState<LooseRow[]>([]);
  const [auditEvents, setAuditEvents] = useState<LooseRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!riderId) return;
    void (async () => {
      setLoading(true);
      const c: LooseRow = supabase;
      const { data: r } = await c
        .from("rider_profiles")
        .select("*")
        .eq("id", riderId)
        .maybeSingle();
      setRider(r);
      const userId = r?.user_id;
      const list = (table: string, sel: string, col = "user_id") =>
        userId
          ? c.from(table).select(sel).eq(col, userId).order("created_at", { ascending: false }).limit(50)
          : Promise.resolve({ data: [] });
      const one = (table: string, sel: string, col = "user_id") =>
        userId ? c.from(table).select(sel).eq(col, userId).maybeSingle() : Promise.resolve({ data: null });
      const [w, t, tr, k, inc, sos, fr, ts, bs, nt] = await Promise.all([
        one("rider_wallets", "id,balance_cents"),
        list("rider_wallet_transactions", "id,direction,amount_cents,kind,status,reference,created_at"),
        list("trip_bookings", "id,status,total_fare,pickup_address,dropoff_address,created_at", "rider_user_id"),
        list("rider_kyc", "id,document_type,status,verified_at,created_at"),
        list("rider_safety_incidents", "id,incident_type,severity,status,description,created_at"),
        list("rider_sos_alerts", "id,status,alert_type,created_at,resolved_at"),
        list("rider_fraud_signals", "id,signal_type,severity,description,created_at"),
        one("rider_trust_scores", "score,tier,updated_at"),
        one("rider_behavior_scores", "score,category,updated_at"),
        list("rider_notifications", "id,title,body,channel,status,created_at"),
      ]);
      setWallet((w as LooseRow)?.data ?? null);
      setTxns(((t as LooseRow)?.data as LooseRow[]) ?? []);
      setTrips(((tr as LooseRow)?.data as LooseRow[]) ?? []);
      setKyc(((k as LooseRow)?.data as LooseRow[]) ?? []);
      setIncidents(((inc as LooseRow)?.data as LooseRow[]) ?? []);
      setSosAlerts(((sos as LooseRow)?.data as LooseRow[]) ?? []);
      setFraudSignals(((fr as LooseRow)?.data as LooseRow[]) ?? []);
      setTrust((ts as LooseRow)?.data ?? null);
      setBehavior((bs as LooseRow)?.data ?? null);
      setNotifications(((nt as LooseRow)?.data as LooseRow[]) ?? []);
      const events: LooseRow[] = [];
      (((t as LooseRow)?.data as LooseRow[]) ?? []).forEach((x) =>
        events.push({ ts: x.created_at, kind: "wallet", label: `${x.direction} ${x.kind}` }));
      (((tr as LooseRow)?.data as LooseRow[]) ?? []).forEach((x) =>
        events.push({ ts: x.created_at, kind: "trip", label: `trip ${x.status}` }));
      (((k as LooseRow)?.data as LooseRow[]) ?? []).forEach((x) =>
        events.push({ ts: x.created_at, kind: "kyc", label: `kyc ${x.document_type} ${x.status}` }));
      (((inc as LooseRow)?.data as LooseRow[]) ?? []).forEach((x) =>
        events.push({ ts: x.created_at, kind: "incident", label: `${x.incident_type} · ${x.severity}` }));
      events.sort((a, b) => (a.ts < b.ts ? 1 : -1));
      setAuditEvents(events.slice(0, 100));
      setLoading(false);
    })();
  }, [riderId]);

  if (loading) return <div className="p-8 text-muted-foreground">Loading rider…</div>;
  if (!rider)
    return (
      <div className="p-8">
        Rider not found.{" "}
        <Link className="underline" to="/dashboard/admin/riders">
          Back
        </Link>
      </div>
    );

  const displayName =
    rider.display_name ||
    [rider.first_name, rider.last_name].filter(Boolean).join(" ") ||
    "Rider";
  const initials = `${rider.first_name?.[0] ?? ""}${rider.last_name?.[0] ?? ""}`.toUpperCase();

  const tabs: Workspace360TabConfig[] = [
    {
      tab: "overview",
      render: () => (
        <div className="grid md:grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 text-sm">
              <div className="text-muted-foreground text-xs mb-1">Lifetime trips</div>
              <div className="text-xl font-semibold">{rider.lifetime_trips ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-sm">
              <div className="text-muted-foreground text-xs mb-1">Lifetime spend</div>
              <div className="text-xl font-semibold">{kes(rider.lifetime_spend)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-sm">
              <div className="text-muted-foreground text-xs mb-1">Recent trips loaded</div>
              <div className="text-xl font-semibold">{trips.length}</div>
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      tab: "financial",
      render: () => (
        <Card>
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">
                      {new Date(t.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {t.direction === "credit" ? "+" : "-"}
                      {kes(t.amount_cents)}
                    </TableCell>
                    <TableCell>{t.kind}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {t.reference ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {txns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No wallet transactions.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ),
    },
    {
      tab: "timeline",
      render: () => (
        <Card>
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fare</TableHead>
                  <TableHead>From → To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trips.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">
                      {new Date(t.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t.status}</Badge>
                    </TableCell>
                    <TableCell>{`KES ${Number(t.total_fare ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`}</TableCell>
                    <TableCell className="text-xs">
                      {t.pickup_address ?? "—"} → {t.dropoff_address ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {trips.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No trips.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ),
    },
    {
      tab: "documents",
      render: () => (
        <Card>
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kyc.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs">{d.document_type}</TableCell>
                    <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                    <TableCell className="text-xs">
                      {d.verified_at ? new Date(d.verified_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(d.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
                {kyc.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No KYC documents submitted.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ),
    },
    {
      tab: "compliance",
      render: () => (
        <div className="space-y-3">
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground mb-2">SOS alerts</div>
              {sosAlerts.length === 0 ? (
                <div className="text-sm text-muted-foreground">No SOS alerts.</div>
              ) : (
                sosAlerts.map((s) => (
                  <div key={s.id} className="flex justify-between text-sm py-1 border-b last:border-0">
                    <span>{s.alert_type ?? "SOS"}</span>
                    <Badge variant={s.status === "resolved" ? "outline" : "destructive"}>{s.status}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground mb-2">Safety incidents</div>
              {incidents.length === 0 ? (
                <div className="text-sm text-muted-foreground">No incidents.</div>
              ) : (
                incidents.map((i) => (
                  <div key={i.id} className="flex justify-between text-sm py-1 border-b last:border-0">
                    <span className="truncate max-w-[60%]">{i.incident_type} · {i.description ?? "—"}</span>
                    <Badge variant="outline">{i.severity}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground mb-2">Fraud signals</div>
              {fraudSignals.length === 0 ? (
                <div className="text-sm text-muted-foreground">No fraud signals.</div>
              ) : (
                fraudSignals.map((f) => (
                  <div key={f.id} className="flex justify-between text-sm py-1 border-b last:border-0">
                    <span className="truncate max-w-[60%]">{f.signal_type} · {f.description ?? "—"}</span>
                    <Badge variant="outline">{f.severity}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      tab: "performance",
      render: () => (
        <div className="grid md:grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 text-sm">
              <div className="text-muted-foreground text-xs mb-1 flex items-center gap-1">
                <Star className="h-3.5 w-3.5" /> Rating
              </div>
              <div className="text-xl font-semibold">
                {Number(rider.rating_avg ?? 0).toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">
                across {rider.rating_count ?? 0} trips
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-sm">
              <div className="text-muted-foreground text-xs mb-1">Tier</div>
              <div className="text-xl font-semibold">{rider.rider_tier ?? "—"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-sm">
              <div className="text-muted-foreground text-xs mb-1">Trust score</div>
              <div className="text-xl font-semibold">{trust?.score ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{trust?.tier ?? ""}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-sm">
              <div className="text-muted-foreground text-xs mb-1">Behavior score</div>
              <div className="text-xl font-semibold">{behavior?.score ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{behavior?.category ?? ""}</div>
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      tab: "support",
      render: () => (
        <Card>
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notifications.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="text-xs">
                      {new Date(n.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs">{n.channel ?? "—"}</TableCell>
                    <TableCell className="text-xs">{n.title ?? n.body ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{n.status ?? "sent"}</Badge></TableCell>
                  </TableRow>
                ))}
                {notifications.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No support communications.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ),
    },
    {
      tab: "analytics",
      render: () => (
        <Workspace360EmptyPanel
          title="Analytics"
          description="Rider analytics will be wired to canonical services in a future phase."
        />
      ),
    },
    {
      tab: "twin",
      render: () => (
        <Workspace360EmptyPanel
          title="Digital Twin"
          description="Rider Digital Twin scenarios will surface here."
        />
      ),
    },
    {
      tab: "audit",
      render: () => (
        <Card>
          <CardContent className="pt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Event</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditEvents.map((e, i) => (
                  <TableRow key={`${e.kind}-${i}`}>
                    <TableCell className="text-xs">{new Date(e.ts).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline">{e.kind}</Badge></TableCell>
                    <TableCell className="text-xs">{e.label}</TableCell>
                  </TableRow>
                ))}
                {auditEvents.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      No audit events.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ),
    },
    {
      tab: "settings",
      render: () => (
        <Workspace360EmptyPanel
          title="Settings"
          description="Rider preferences and account controls will surface here."
        />
      ),
    },
  ];

  return (
    <Workspace360Shell
      domain="rider"
      entityId={riderId}
      title={displayName}
      subtitle={`${rider.phone_number ?? "—"} · ${rider.email ?? "—"}`}
      initials={initials}
      statusBadges={[
        { label: rider.status ?? "unknown" },
        ...(rider.rider_tier ? [{ label: String(rider.rider_tier) }] : []),
      ]}
      kpis={[
        { icon: WalletIcon, label: "Wallet", value: kes(wallet?.balance_cents) },
        { icon: Star, label: "Rating", value: Number(rider.rating_avg ?? 0).toFixed(2) },
        { icon: MapPin, label: "Trips", value: String(rider.lifetime_trips ?? 0) },
      ]}
      actions={
        <>
          <Button size="sm" variant="outline" disabled title="Contact channels ship with the Communications module (D12.x)">
            <Phone className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" disabled title="Contact channels ship with the Communications module (D12.x)">
            <MessageSquare className="h-4 w-4" />
          </Button>
        </>
      }
      tabs={tabs}
      directoryLabel="Riders"
    />
  );
}
