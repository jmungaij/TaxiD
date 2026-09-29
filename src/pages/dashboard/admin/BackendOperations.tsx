import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, Boxes, BriefcaseBusiness, CheckCircle2, Clock3, Code2, Database,
  ExternalLink, FileClock, Gauge, HardDrive, KeyRound, Mail, RefreshCw,
  ServerCog, ShieldCheck, Users, WalletCards,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeoHead } from "@/components/seo/SeoHead";

type BackendSnapshot = {
  generatedAt: string;
  windowHours: number;
  overview: { databaseTables: number; protectedTables: number; users: number | null; roleAssignments: number | null; storageBuckets: number | null; deployedFunctions: number };
  database: { tables: string[]; rlsEnabled: boolean };
  activity: { riders: number | null; trips: number | null; openCases: number | null; casesCreated: number | null; supportMessages: number | null; walletTransactions: number | null; businessRequests: number | null };
  storage: { buckets: string[] };
  functions: { name: string; purpose: string; access: string }[];
  secrets: { name: string; configured: boolean }[];
};

const links = {
  users: "/dashboard/admin/users",
  emails: "/dashboard/admin/email-delivery",
  jobs: "/dashboard/admin/scheduled-job-health",
  logs: "/dashboard/admin/audit-log",
  usage: "/dashboard/admin/observability",
};

const value = (input: number | null) => input == null ? "—" : input.toLocaleString("en-KE");

function Metric({ label, value: metric, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{metric}</p></div>
        <span className="text-primary">{icon}</span>
      </CardContent>
    </Card>
  );
}

function OpenPage({ to, children }: { to: string; children: React.ReactNode }) {
  return <Button asChild size="sm" variant="outline"><Link to={to}>{children}<ExternalLink className="ml-2 h-3.5 w-3.5" /></Link></Button>;
}

export default function BackendOperations() {
  const [snapshot, setSnapshot] = useState<BackendSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState(24);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: invokeError } = await supabase.functions.invoke("backend-operations", { body: { windowHours } });
    if (invokeError) { setError(invokeError.message); setSnapshot(null); }
    else { setError(null); setSnapshot(data as BackendSnapshot); }
    setLoading(false);
  }, [windowHours]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-6">
      <SeoHead path="/dashboard/admin/backend" title="Backend Operations | TaxiD" description="Secure TaxiD database, users, functions, jobs, logs and usage overview." />
      <header className="border-b border-border pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-primary"><ServerCog className="h-4 w-4" /> Super Admin</div>
            <h1 className="mt-2 text-3xl font-bold">Backend Operations Centre</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Database protection, users, storage, email, scheduled work, backend functions, logs and usage in one governed view.</p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </div>
      </header>

      {error && <Alert variant="destructive"><AlertTitle>Live backend data unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {loading && !snapshot ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0,1,2,3].map((i) => <Skeleton key={i} className="h-24" />)}</div> : snapshot && (
        <Tabs defaultValue="overview" className="space-y-5">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto p-1">
            {["overview","database","users","storage","emails","secrets","jobs","edge-functions","sql-editor","logs","usage"].map((tab) => <TabsTrigger key={tab} value={tab} className="whitespace-nowrap capitalize">{tab.replace("-", " ")}</TabsTrigger>)}
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Protected database tables" value={`${snapshot.overview.protectedTables}/${snapshot.overview.databaseTables}`} icon={<ShieldCheck className="h-6 w-6" />} />
              <Metric label="Registered users" value={value(snapshot.overview.users)} icon={<Users className="h-6 w-6" />} />
              <Metric label="Deployed functions" value={snapshot.overview.deployedFunctions} icon={<Code2 className="h-6 w-6" />} />
              <Metric label="Storage buckets" value={value(snapshot.overview.storageBuckets)} icon={<HardDrive className="h-6 w-6" />} />
            </div>
            <Card><CardHeader><CardTitle>Business activity</CardTitle><CardDescription>Live totals and the last {snapshot.windowHours} hours. Unavailable records display —.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Riders" value={value(snapshot.activity.riders)} icon={<Users className="h-5 w-5" />} />
              <Metric label="Trips" value={value(snapshot.activity.trips)} icon={<Activity className="h-5 w-5" />} />
              <Metric label="Open support cases" value={value(snapshot.activity.openCases)} icon={<FileClock className="h-5 w-5" />} />
              <Metric label="Recent support messages" value={value(snapshot.activity.supportMessages)} icon={<Mail className="h-5 w-5" />} />
              <Metric label="Recent wallet transactions" value={value(snapshot.activity.walletTransactions)} icon={<WalletCards className="h-5 w-5" />} />
              <Metric label="Recent business requests" value={value(snapshot.activity.businessRequests)} icon={<BriefcaseBusiness className="h-5 w-5" />} />
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="database"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" />Database</CardTitle><CardDescription>{snapshot.database.tables.length} live application tables; row-level protection is enabled across the current public schema.</CardDescription></CardHeader><CardContent><div className="flex flex-wrap gap-2">{snapshot.database.tables.map((table) => <Badge key={table} variant="secondary" className="font-mono font-normal">{table}</Badge>)}</div></CardContent></Card></TabsContent>
          <TabsContent value="users"><Card><CardHeader><CardTitle>Users and access</CardTitle><CardDescription>{value(snapshot.overview.users)} authentication accounts and {value(snapshot.overview.roleAssignments)} role assignments.</CardDescription></CardHeader><CardContent><OpenPage to={links.users}>Open user management</OpenPage></CardContent></Card></TabsContent>
          <TabsContent value="storage"><Card><CardHeader><CardTitle>Storage</CardTitle><CardDescription>Private and public file containers registered with the backend.</CardDescription></CardHeader><CardContent>{snapshot.storage.buckets.length ? <div className="flex flex-wrap gap-2">{snapshot.storage.buckets.map((bucket) => <Badge key={bucket}>{bucket}</Badge>)}</div> : <p className="text-sm text-muted-foreground">No storage buckets are configured.</p>}</CardContent></Card></TabsContent>
          <TabsContent value="emails"><Card><CardHeader><CardTitle>Email operations</CardTitle><CardDescription>Delivery history, failures, retries, templates and deliverability controls.</CardDescription></CardHeader><CardContent><OpenPage to={links.emails}>Open email operations</OpenPage></CardContent></Card></TabsContent>
          <TabsContent value="secrets"><Card><CardHeader><CardTitle>Secrets</CardTitle><CardDescription>Configuration status only. Secret values are never returned to this page.</CardDescription></CardHeader><CardContent className="space-y-2">{snapshot.secrets.map((secret) => <div key={secret.name} className="flex items-center justify-between border-b border-border py-2 last:border-0"><span className="flex items-center gap-2 font-mono text-sm"><KeyRound className="h-4 w-4 text-muted-foreground" />{secret.name}</span><Badge variant={secret.configured ? "default" : "destructive"}>{secret.configured ? "Configured" : "Missing"}</Badge></div>)}</CardContent></Card></TabsContent>
          <TabsContent value="jobs"><Card><CardHeader><CardTitle>Scheduled jobs</CardTitle><CardDescription>Run history, HTTP outcomes, queue health and last recorded errors.</CardDescription></CardHeader><CardContent><OpenPage to={links.jobs}>Open job health</OpenPage></CardContent></Card></TabsContent>
          <TabsContent value="edge-functions" className="space-y-3">{snapshot.functions.map((fn) => <Card key={fn.name}><CardContent className="flex flex-wrap items-center justify-between gap-4 p-5"><div><div className="flex items-center gap-2"><Code2 className="h-4 w-4 text-primary" /><p className="font-mono font-semibold">{fn.name}</p></div><p className="mt-1 text-sm text-muted-foreground">{fn.purpose}</p></div><Badge variant="outline">{fn.access}</Badge></CardContent></Card>)}</TabsContent>
          <TabsContent value="sql-editor"><Alert><Database className="h-4 w-4" /><AlertTitle>Restricted database diagnostics</AlertTitle><AlertDescription>Arbitrary SQL execution is intentionally disabled in the web app. Use the Database inventory for schema visibility and governed operations pages for changes.</AlertDescription></Alert></TabsContent>
          <TabsContent value="logs"><Card><CardHeader><CardTitle>Logs and audit trail</CardTitle><CardDescription>Administrative actions, access decisions and operational evidence.</CardDescription></CardHeader><CardContent><OpenPage to={links.logs}>Open audit logs</OpenPage></CardContent></Card></TabsContent>
          <TabsContent value="usage" className="space-y-4"><div className="flex flex-wrap gap-2">{[6,24,72,168].map((hours) => <Button key={hours} size="sm" variant={windowHours === hours ? "default" : "outline"} onClick={() => setWindowHours(hours)}><Clock3 className="mr-2 h-4 w-4" />{hours}h</Button>)}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Cases created" value={value(snapshot.activity.casesCreated)} icon={<FileClock className="h-5 w-5" />} /><Metric label="Support messages" value={value(snapshot.activity.supportMessages)} icon={<Mail className="h-5 w-5" />} /><Metric label="Wallet transactions" value={value(snapshot.activity.walletTransactions)} icon={<WalletCards className="h-5 w-5" />} /><Metric label="Business requests" value={value(snapshot.activity.businessRequests)} icon={<Gauge className="h-5 w-5" />} /></div><OpenPage to={links.usage}>Open service observability</OpenPage></TabsContent>
        </Tabs>
      )}
      {snapshot && <p className="text-xs text-muted-foreground">Last refreshed {new Date(snapshot.generatedAt).toLocaleString("en-KE")}. <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-primary" /> Live backend response · refreshes every 30 seconds.</p>}
    </div>
  );
}