import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Users, ShieldCheck, FileCheck, AlertTriangle, Search, UserCog,
  CheckCircle2, XCircle, Clock, Car, Activity, TrendingUp, Filter,
  MoreHorizontal, Phone, MessageSquare, MapPin, Wallet as WalletIcon,
  Receipt, GraduationCap, KeyRound, Power, FileText as FileTextIcon,
  Banknote, Gauge, LifeBuoy,
} from "lucide-react";
import { AppLink } from "@/components/nav/AppLink";
import { toast } from "sonner";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useNavigate } from "react-router-dom";
import {
  driver360Path,
  trackDriver360QuickAction,
  type Driver360Tab,
} from "@/lib/driver360Links";

function goToDriver360(
  navigate: (to: string) => void,
  driverId: string,
  tab: Driver360Tab | null,
  source: string,
) {
  if (tab) trackDriver360QuickAction(driverId, tab, source);
  navigate(driver360Path(driverId, tab));
}

type Driver = {
  id: string;
  driver_code: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone_number: string | null;
  status: string;
  verification_status: string;
  application_status: string | null;
  risk_score: number | null;
  driver_rating: number | null;
  city: string | null;
  created_at: string;
};

const STATUS_COLOR: Record<string, string> = {
  active: "bg-status-success/15 text-status-success dark:text-status-success",
  suspended: "bg-status-danger/15 text-status-danger dark:text-status-danger",
  draft: "bg-muted text-muted-foreground",
  pending: "bg-status-warning/15 text-status-warning dark:text-status-warning",
  inactive: "bg-muted text-muted-foreground",
};

export default function DriverAdministration() {
  const navigate = useNavigate();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 250);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [view, setView] = useState<"table" | "grid" | "card">("table");
  const [stats, setStats] = useState({
    total: 0, active: 0, offline: 0, busy: 0, suspended: 0, pending: 0,
    walletBalance: 0, earningsToday: 0, tripsToday: 0,
    acceptance: 0, completion: 0, rating: 0, safety: 0, alerts: 0,
  });

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const c: any = supabase;
    // Canonical KPIs via single RPC — same source of truth as Driver 360.
    const [listRes, metricsRes] = await Promise.all([
      c.from("drivers").select("*").order("created_at", { ascending: false }).limit(200),
      c.rpc("driver_admin_metrics"),
    ]);
    const list2 = (listRes?.data as Driver[]) ?? [];
    setDrivers(list2);
    const m = (metricsRes?.data ?? {}) as Record<string, number>;
    setStats({
      total: Number(m.total ?? 0),
      active: Number(m.active ?? 0),
      offline: Number(m.offline ?? 0),
      busy: Number(m.busy ?? 0),
      suspended: Number(m.suspended ?? 0),
      pending: Number(m.pending ?? 0),
      alerts: Number(m.alerts ?? 0),
      walletBalance: Number(m.walletBalance ?? 0),
      earningsToday: Number(m.earningsToday ?? 0),
      tripsToday: Number(m.tripsToday ?? 0),
      acceptance: Number(m.acceptance ?? 0),
      completion: Number(m.completion ?? 0),
      safety: Number(m.safety ?? 0),
      rating: Number(m.rating ?? 0),
    });
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const needle = dq.toLowerCase();
    return drivers.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (!needle) return true;
      const hay = `${d.driver_code} ${d.first_name} ${d.last_name} ${d.email ?? ""} ${d.phone_number ?? ""} ${d.city ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [drivers, dq, statusFilter]);

  async function setStatus(id: string, status: "active" | "suspended" | "draft" | "deactivated" | "blacklisted" | "pending") {
    const { error } = await supabase.from("drivers").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Driver ${status}`);
    void load();
  }

  async function setVerification(id: string, verification_status: "approved" | "rejected" | "pending" | "in_review" | "not_submitted" | "expired" | "resubmission_required") {
    const { error } = await supabase.from("drivers").update({ verification_status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Verification: ${verification_status}`);
    void load();
  }

  const kes = (c: number) => `KES ${(c/100).toLocaleString("en-KE",{maximumFractionDigits:0})}`;

  return (
    <div className="space-y-6">
      {/* Executive Ops Header */}
      <div className="rounded-xl border bg-gradient-to-br from-primary/5 via-background to-background p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Drivers</div>
            <h1 className="text-2xl font-bold">Driver 360 — Enterprise Operations Center</h1>
            <p className="text-sm text-muted-foreground">
              Directory · Driver 360 · Operations · Compliance · Academy · Performance · Wallets · Digital Twin
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button asChild variant="outline"><AppLink to="/dashboard/admin/lifecycle" trackId="drv-admin:lifecycle">Lifecycle</AppLink></Button>
            <Button asChild variant="outline"><AppLink to="/dashboard/admin/compliance" trackId="drv-admin:compliance">Compliance</AppLink></Button>
            <Button asChild variant="outline"><AppLink to="/dashboard/admin/academy" trackId="drv-admin:academy">Academy</AppLink></Button>
            <Button asChild><AppLink to="/dashboard/admin/digital-twin" trackId="drv-admin:twin">Digital Twin</AppLink></Button>
          </div>
        </div>
      </div>

      {/* KPI strip — 14 tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Kpi icon={Users} label="Total" value={stats.total} />
        <Kpi icon={CheckCircle2} label="Online" value={stats.active} tone="emerald" />
        <Kpi icon={XCircle} label="Offline" value={stats.offline} />
        <Kpi icon={Car} label="Busy" value={stats.busy} />
        <Kpi icon={XCircle} label="Suspended" value={stats.suspended} tone="rose" />
        <Kpi icon={Clock} label="Pending KYC" value={stats.pending} tone="amber" />
        <Kpi icon={AlertTriangle} label="Open alerts" value={stats.alerts} tone="rose" />
        <Kpi icon={Activity} label="Wallet float" value={kes(stats.walletBalance)} />
        <Kpi icon={TrendingUp} label="Earnings today" value={kes(stats.earningsToday)} tone="emerald" />
        <Kpi icon={Car} label="Trips today" value={stats.tripsToday} />
        <Kpi icon={TrendingUp} label="Acceptance" value={`${stats.acceptance.toFixed(0)}%`} />
        <Kpi icon={ShieldCheck} label="Completion" value={`${stats.completion.toFixed(0)}%`} />
        <Kpi icon={Activity} label="Avg rating" value={stats.rating.toFixed(2)} />
        <Kpi icon={ShieldCheck} label="Safety" value={stats.safety.toFixed(1)} />
      </div>

      <Tabs defaultValue="roster">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="roster">Directory</TabsTrigger>
          <TabsTrigger value="kyc">KYC Queue</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="risk">Risk & Fraud</TabsTrigger>
          <TabsTrigger value="ops">Ops Shortcuts</TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search code, name, phone, email, plate…"
                    className="pl-8"
                  />
                </div>
                <div className="flex items-center gap-1 text-sm">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  {["all", "active", "pending", "suspended", "draft"].map((s) => (
                    <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-1 text-sm border-l pl-2 ml-1">
                  {(["table","grid","card"] as const).map(v => (
                    <Button key={v} size="sm" variant={view === v ? "default" : "outline"} onClick={() => setView(v)} className="capitalize">{v}</Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {view === "table" ? (
              <div className="overflow-x-auto">

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>KYC</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Rating</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
                    )}
                    {!loading && filtered.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No drivers match.</TableCell></TableRow>
                    )}
                    {filtered.map((d) => (
                      <TableRow key={d.id} className="cursor-pointer hover:bg-muted/40">
                        <TableCell className="font-mono text-xs">
                          <AppLink to={driver360Path(d.id)} trackId="drv-admin:open-360" className="hover:underline">{d.driver_code}</AppLink>
                        </TableCell>
                        <TableCell>
                          <AppLink to={driver360Path(d.id)} trackId="drv-admin:open-360" className="hover:underline">{d.first_name} {d.last_name}</AppLink>
                          <div className="text-xs text-muted-foreground">{d.city ?? "—"}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div>{d.email ?? "—"}</div>
                          <div className="text-muted-foreground">{d.phone_number ?? "—"}</div>
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLOR[d.status] ?? "bg-muted"}>{d.status}</Badge>
                        </TableCell>
                        <TableCell><span className="text-xs">{d.verification_status}</span></TableCell>
                        <TableCell>{Number(d.risk_score ?? 0).toFixed(1)}</TableCell>
                        <TableCell>{Number(d.driver_rating ?? 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" asChild>
                              <AppLink to={driver360Path(d.id)} trackId="drv-admin:open-360">Open</AppLink>
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost" aria-label="More actions">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel>Quick actions</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, null, "drv-admin:menu")}>
                                  <Users className="h-4 w-4 mr-2" /> Open Driver 360
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, "wallet", "drv-admin:menu")}>
                                  <WalletIcon className="h-4 w-4 mr-2" /> Wallet
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, "earnings", "drv-admin:menu")}>
                                  <Receipt className="h-4 w-4 mr-2" /> Earnings
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, "trips", "drv-admin:menu")}>
                                  <Car className="h-4 w-4 mr-2" /> Trips
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, "vehicles", "drv-admin:menu")}>
                                  <Car className="h-4 w-4 mr-2" /> Vehicles
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, "withdrawals", "drv-admin:menu")}>
                                  <Banknote className="h-4 w-4 mr-2" /> Withdrawals
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, "performance", "drv-admin:menu")}>
                                  <Gauge className="h-4 w-4 mr-2" /> Performance
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, "support", "drv-admin:menu")}>
                                  <LifeBuoy className="h-4 w-4 mr-2" /> Support
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, "documents", "drv-admin:menu")}>
                                  <FileTextIcon className="h-4 w-4 mr-2" /> Documents
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, "compliance", "drv-admin:menu")}>
                                  <ShieldCheck className="h-4 w-4 mr-2" /> Compliance
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, "academy", "drv-admin:menu")}>
                                  <GraduationCap className="h-4 w-4 mr-2" /> Academy
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, "timeline", "drv-admin:menu")}>
                                  <Clock className="h-4 w-4 mr-2" /> Timeline
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => goToDriver360(navigate, d.id, "twin", "drv-admin:menu")}>
                                  <Activity className="h-4 w-4 mr-2" /> Digital Twin
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {d.phone_number && (
                                  <DropdownMenuItem asChild>
                                    <a href={`tel:${d.phone_number}`}><Phone className="h-4 w-4 mr-2" /> Call</a>
                                  </DropdownMenuItem>
                                )}
                                {d.phone_number && (
                                  <DropdownMenuItem asChild>
                                    <a href={`sms:${d.phone_number}`}><MessageSquare className="h-4 w-4 mr-2" /> Message</a>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => toast.info("Locate: last known GPS not wired for this driver")}>
                                  <MapPin className="h-4 w-4 mr-2" /> Locate
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {d.verification_status !== "approved" && (
                                  <DropdownMenuItem onClick={() => setVerification(d.id, "approved")}>
                                    <CheckCircle2 className="h-4 w-4 mr-2" /> Approve KYC
                                  </DropdownMenuItem>
                                )}
                                {d.status !== "active" && (
                                  <DropdownMenuItem onClick={() => setStatus(d.id, "active")}>
                                    <CheckCircle2 className="h-4 w-4 mr-2" /> Activate
                                  </DropdownMenuItem>
                                )}
                                {d.status !== "suspended" && (
                                  <DropdownMenuItem onClick={() => setStatus(d.id, "suspended")} className="text-status-danger focus:text-status-danger">
                                    <XCircle className="h-4 w-4 mr-2" /> Suspend
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  onClick={async () => {
                                    if (!d.email) return toast.error("No email on file");
                                    const { error } = await supabase.auth.resetPasswordForEmail(d.email);
                                    if (error) toast.error(error.message);
                                    else toast.success("Password reset email sent");
                                  }}
                                >
                                  <KeyRound className="h-4 w-4 mr-2" /> Reset password
                                </DropdownMenuItem>
                                {d.status !== "deactivated" && (
                                  <DropdownMenuItem onClick={() => setStatus(d.id, "deactivated")} className="text-status-danger focus:text-status-danger">
                                    <Power className="h-4 w-4 mr-2" /> Deactivate
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>

                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              ) : (
                <div className={view === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" : "grid grid-cols-1 md:grid-cols-2 gap-3"}>
                  {filtered.map((d) => (
                    <Card key={d.id} className="hover:border-primary/50 transition-colors">
                      <CardContent className="p-4">
                        <AppLink to={driver360Path(d.id)} trackId="drv-admin:open-360-card" className="block">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="font-semibold">{d.first_name} {d.last_name}</div>
                              <div className="text-xs text-muted-foreground font-mono">{d.driver_code}</div>
                            </div>
                            <Badge className={STATUS_COLOR[d.status] ?? "bg-muted"}>{d.status}</Badge>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                            <div><div className="text-muted-foreground">Rating</div><div className="font-semibold">{Number(d.driver_rating ?? 0).toFixed(2)}</div></div>
                            <div><div className="text-muted-foreground">Risk</div><div className="font-semibold">{Number(d.risk_score ?? 0).toFixed(1)}</div></div>
                            <div><div className="text-muted-foreground">KYC</div><div className="font-semibold capitalize">{d.verification_status}</div></div>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground truncate">{d.city ?? "—"} · {d.phone_number ?? "—"}</div>
                        </AppLink>
                        <div className="mt-3 flex flex-wrap gap-1 pt-3 border-t">
                          {[
                            { tab: "wallet", label: "Wallet", Icon: WalletIcon },
                            { tab: "earnings", label: "Earnings", Icon: Receipt },
                            { tab: "trips", label: "Trips", Icon: Car },
                            { tab: "documents", label: "Docs", Icon: FileTextIcon },
                            { tab: "compliance", label: "Compliance", Icon: ShieldCheck },
                            { tab: "performance", label: "Perf", Icon: Gauge },
                            { tab: "twin", label: "Twin", Icon: Activity },
                          ].map(({ tab, label, Icon }) => (
                            <Button
                              key={tab}
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => goToDriver360(navigate, d.id, tab as Driver360Tab, "drv-admin:card-chip")}
                            >
                              <Icon className="h-3 w-3 mr-1" /> {label}
                            </Button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {filtered.length === 0 && <div className="col-span-full text-center text-muted-foreground py-8">No drivers match.</div>}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>


        <TabsContent value="kyc">
          <Card>
            <CardHeader><CardTitle className="text-base">KYC Verification Queue</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Driver</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drivers.filter(d => d.verification_status !== "approved").slice(0, 25).map(d => (
                    <TableRow key={d.id}>
                      <TableCell>{d.first_name} {d.last_name} <span className="text-xs text-muted-foreground">· {d.driver_code}</span></TableCell>
                      <TableCell className="text-xs">{new Date(d.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>{d.verification_status}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="outline" onClick={() => setVerification(d.id, "rejected")}>Reject</Button>
                        <Button size="sm" onClick={() => setVerification(d.id, "approved")}>Approve</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader><CardTitle className="text-base">Documents Processing</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-3 gap-3">
              <ShortcutCard icon={FileCheck} title="KYC Requirements" href="/dashboard/admin/kyc-types" desc="Country document matrix" />
              <ShortcutCard icon={ShieldCheck} title="Identity Assurance" href="/dashboard/admin/identity-assurance" desc="OCR + liveness checks" />
              <ShortcutCard icon={Activity} title="Driver Academy" href="/dashboard/admin/academy" desc="Training & certification" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk">
          <Card>
            <CardHeader><CardTitle className="text-base">Risk & Fraud</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-3 gap-3">
              <ShortcutCard icon={AlertTriangle} title="Fraud Center" href="/dashboard/admin/fraud-center" desc="Cases & investigations" />
              <ShortcutCard icon={ShieldCheck} title="Trust Center" href="/dashboard/admin/trust-center" desc="Incidents & resolutions" />
              <ShortcutCard icon={TrendingUp} title="Compliance Alerts" href="/dashboard/admin/compliance-alerts" desc="Live exception feed" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ops">
          <Card>
            <CardHeader><CardTitle className="text-base">Operations Shortcuts</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-3 gap-3">
              <ShortcutCard icon={Car} title="Dispatch Ops" href="/dashboard/admin/dispatch" desc="Live dispatch console" />
              <ShortcutCard icon={UserCog} title="Driver Lifecycle" href="/dashboard/admin/lifecycle" desc="Stages & actions" />
              <ShortcutCard icon={Users} title="Staff & Roles" href="/dashboard/admin/staff" desc="Assign titles & capabilities" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: typeof Users; label: string; value: number | string; tone?: string }) {
  const toneCls =
    tone === "emerald" ? "text-status-success" :
    tone === "amber" ? "text-status-warning" :
    tone === "rose" ? "text-status-danger" : "text-primary";
  const display = typeof value === "number" ? value.toLocaleString() : value;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${toneCls}`} />
        </div>
        <div className="text-2xl font-bold mt-1">{display}</div>
      </CardContent>
    </Card>
  );
}


function ShortcutCard({ icon: Icon, title, href, desc }: { icon: typeof Users; title: string; href: string; desc: string }) {
  return (
    <AppLink to={href} trackId={`drv-admin-shortcut:${href}`}>
      <div className="rounded-lg border p-4 hover:bg-muted/40 transition-colors h-full">
        <Icon className="h-5 w-5 mb-2 text-primary" />
        <div className="font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </AppLink>
  );
}
