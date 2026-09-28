import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Shield, UserPlus, X, Crown, Search, CheckCircle2, ScrollText, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  assignUserRole, revokeUserRole, listRoleAudit, listRoleDenials,
  subscribeRoleDenials, describeDenial,
  type RoleAuditRow, type RoleDenialRow,
} from "@/lib/platform/roleManagement";

const ROLES = [
  { value: "super_admin",        title: "Super Admin",         desc: "Full platform control" },
  { value: "admin",              title: "Platform Admin",      desc: "Operate all domains" },
  { value: "support",            title: "Support Agent",       desc: "Handle assigned rider cases in the agent portal" },
  { value: "finance_admin",      title: "Finance Admin",       desc: "Payments, M-Pesa, payouts, tax" },
  { value: "compliance_admin",   title: "Compliance Admin",    desc: "KYC review, driver compliance" },
  { value: "corporate_admin",    title: "Corporate Admin",     desc: "Corporate accounts, billing" },
  { value: "corporate_employee", title: "Corporate Employee",  desc: "Book against corporate wallet" },
  { value: "driver",             title: "Driver",              desc: "Driver app & earnings" },
  { value: "rider",              title: "Rider",               desc: "Book rides" },
] as const;

type Row = { user_id: string; role: string };
type LookupResult = {
  user_id: string;
  email: string;
  created_at: string;
  profile: { full_name?: string | null; phone?: string | null } | null;
  roles: string[];
};

export default function StaffManagement() {
  const { user, isSuperAdmin, isAdmin } = useAuth();
  // Only super admins may mutate titles; platform admins keep read-only visibility.
  const canManage = isSuperAdmin;
  const canView = isSuperAdmin || isAdmin;

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailInput, setEmailInput] = useState("");
  const [newRole, setNewRole] = useState<typeof ROLES[number]["value"]>("admin");
  const [looking, setLooking] = useState(false);
  const [resolved, setResolved] = useState<LookupResult | null>(null);

  const [audit, setAudit] = useState<RoleAuditRow[]>([]);
  const [denials, setDenials] = useState<RoleDenialRow[]>([]);

  useEffect(() => { void load(); void loadGovernance(); }, []);

  // Live alert whenever a role-management attempt is denied anywhere.
  useEffect(() => subscribeRoleDenials((row) => {
    setDenials((d) => [row, ...d].slice(0, 50));
    toast.error("Role management denied", { description: describeDenial(row) });
  }), []);

  async function loadGovernance() {
    const [a, d] = await Promise.allSettled([listRoleAudit(), listRoleDenials()]);
    if (a.status === "fulfilled") setAudit(a.value);
    if (d.status === "fulfilled") setDenials(d.value);
  }


  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .order("user_id", { ascending: true });
    if (error) { toast.error(error.message); setLoading(false); return; }
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }

  async function lookup() {
    const email = emailInput.trim().toLowerCase();
    if (!email) return toast.error("Enter an email");
    setLooking(true);
    setResolved(null);
    const { data, error } = await supabase.functions.invoke("lookup-user-by-email", {
      body: { email },
    });
    setLooking(false);
    if (error) return toast.error(error.message);
    if ((data as { error?: string })?.error) {
      return toast.error((data as { error: string }).error === "not_found" ? "No user with that email" : (data as { error: string }).error);
    }
    setResolved(data as LookupResult);
  }

  const ELEVATED_ROLES = new Set(["super_admin", "admin"]);

  async function assign() {
    if (!resolved) return toast.error("Look up a user first");
    // Friction gate: minting platform-wide privilege must be a deliberate act.
    if (ELEVATED_ROLES.has(newRole)) {
      const isSelf = resolved.user_id === user?.id;
      const confirmed = window.confirm(
        `Grant ${newRole.toUpperCase()} to ${resolved.email}?` +
          (isSelf ? "\n\nThis is a SELF-GRANT and is flagged in the role audit trail." : "") +
          "\n\nThis title carries platform-wide privilege and the change is permanently audited.",
      );
      if (!confirmed) return;
    }
    const res = await assignUserRole(resolved.user_id, newRole);
    if (!res.ok) {
      toast.error(res.denied ? "Denied — super admin required" : "Could not assign title", {
        description: res.reason,
      });
      void loadGovernance();
      return;
    }
    toast.success(`Assigned ${newRole} to ${resolved.email}`);
    setEmailInput("");
    setResolved(null);
    void load();
    void loadGovernance();
  }

  async function revoke(user_id: string, role: string) {
    const res = await revokeUserRole(user_id, role);
    if (!res.ok) {
      toast.error(res.denied ? "Denied — super admin required" : "Could not revoke title", {
        description: res.reason,
      });
      void loadGovernance();
      return;
    }
    toast.success("Role revoked");
    void load();
    void loadGovernance();
  }


  const grouped = rows.reduce<Record<string, string[]>>((acc, r) => {
    (acc[r.user_id] ??= []).push(r.role);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Crown className="h-6 w-6 text-primary" /> Staff & Capabilities
        </h1>
        <p className="text-sm text-muted-foreground">
          Assign titles by <strong>email</strong> — no manual UUIDs. Super Admin has full access; other titles map to scoped permissions enforced across every route, button and edge function.
        </p>
      </div>

      {!canManage && (
        <Card className="border-status-warning/40">
          <CardContent className="p-4 text-sm text-status-warning dark:text-status-warning">
            {canView
              ? <>Platform admins have <strong>read-only</strong> visibility. Only <strong>super_admin</strong> can grant or revoke titles.</>
              : <>You need <strong>super_admin</strong> to manage staff.</>}
          </CardContent>
        </Card>
      )}


      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Capability Matrix</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          {ROLES.map((r) => (
            <div key={r.value} className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Badge variant={r.value === "super_admin" ? "default" : "secondary"}>{r.title}</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-2">{r.desc}</div>
              <div className="text-[10px] uppercase tracking-wide mt-2 text-muted-foreground">role key: {r.value}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><UserPlus className="h-4 w-4" /> Assign by Email</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
              <div>
                <Label className="text-xs">User email</Label>
                <Input
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="user@company.com"
                  onKeyDown={(e) => { if (e.key === "Enter") void lookup(); }}
                />
              </div>
              <Button onClick={lookup} disabled={looking} variant="outline">
                <Search className="h-4 w-4 mr-1" /> {looking ? "Looking…" : "Lookup"}
              </Button>
            </div>

            {resolved && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-status-success" />
                  <span className="font-medium">{resolved.profile?.full_name ?? resolved.email}</span>
                  <span className="text-xs text-muted-foreground">{resolved.email}</span>
                </div>
                <div className="text-xs text-muted-foreground font-mono">UUID: {resolved.user_id}</div>
                {resolved.roles.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-muted-foreground">Current titles:</span>
                    {resolved.roles.map(r => <Badge key={r} variant="secondary">{r}</Badge>)}
                  </div>
                )}
                <div className="grid md:grid-cols-[220px_auto] gap-3 items-end">
                  <div>
                    <Label className="text-xs">Assign title</Label>
                    <Select value={newRole} onValueChange={(v) => setNewRole(v as typeof newRole)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={assign}>Assign title</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Active Assignments</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User ID</TableHead>
                  <TableHead>Titles</TableHead>
                  <TableHead className="text-right">Manage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
                {!loading && Object.keys(grouped).length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No role assignments yet.</TableCell></TableRow>
                )}
                {Object.entries(grouped).map(([uid, roles]) => (
                  <TableRow key={uid}>
                    <TableCell className="font-mono text-xs">{uid}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {roles.map((role) => (
                          <Badge key={role} variant="secondary" className="gap-1">
                            {role}
                            {canManage && (
                              <button
                                aria-label={`Revoke ${role}`}
                                onClick={() => revoke(uid, role)}
                                className="ml-1 hover:text-status-danger"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      Use the chip × to revoke
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className={denials.length > 0 ? "border-status-danger/50" : undefined}>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-status-danger" /> Denied role-management attempts
          </CardTitle>
          <Badge variant={denials.length ? "destructive" : "secondary"}>{denials.length}</Badge>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Live feed of every blocked grant/revoke, with the failing actor and request context. New denials raise a toast instantly.
          </p>
          {denials.length === 0 ? (
            <p className="text-sm text-muted-foreground">No denied attempts recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Attempt</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {denials.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(d.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">
                        <div>{d.user_email ?? "—"}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{d.user_id ?? "anonymous"}</div>
                        <div className="text-[10px] text-muted-foreground">held: {(d.user_roles ?? []).join(", ") || "none"}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline">{String(d.metadata?.operation ?? "change")}</Badge>{" "}
                        <span className="font-medium">{d.requested_role ?? "—"}</span>
                        <div className="font-mono text-[10px] text-muted-foreground">→ {String(d.metadata?.target_user_id ?? "—")}</div>
                      </TableCell>
                      <TableCell className="text-xs text-status-danger dark:text-status-danger">{d.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><ScrollText className="h-4 w-4" /> Role management audit trail</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Every accepted mutation, stamped by the database with actor, target and the RLS/constraint result.
          </p>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">No role changes recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">
                        <div>{a.actor_email ?? "—"}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{a.actor_id ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="secondary">{a.action.replace("user_roles.", "")}</Badge>{" "}
                        {String(a.metadata?.role ?? "")}
                        {a.actor_id && a.resource_id === a.actor_id && (
                          <Badge variant="destructive" className="ml-1">self-grant</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-[10px]">{a.resource_id ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-status-success border-status-success/40">
                          {String(a.metadata?.result ?? "allowed")} · {String(a.metadata?.constraint_result ?? "ok")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

