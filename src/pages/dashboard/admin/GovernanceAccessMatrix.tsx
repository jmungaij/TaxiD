/**
 * Governance access matrix (admin).
 *
 * Manage and verify fine-grained RBAC grants for the governance surfaces —
 * alert history, concierge audit trails, report schedules, incident detail
 * and webhook admin — scoped by corporate account, corporate role, department
 * or a specific user. Includes a live verification panel that calls
 * `has_governance_access` server-side.
 */
import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SeoHead } from "@/components/seo/SeoHead";
import { KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import {
  createGovernanceGrant, deleteGovernanceGrant, describeScope, GOVERNANCE_SURFACES,
  loadGovernanceGrants, SURFACE_LABEL, SURFACE_ROUTE, updateGovernanceGrant,
  checkGovernanceAccess, type GovernanceGrant, type GovernanceSurface,
} from "@/lib/corporate/governanceAccess";

const CORPORATE_ROLES = ["corporate_admin", "corporate_manager", "corporate_employee"] as const;
const CAPABILITIES = ["read", "export", "manage"] as const;

export default function GovernanceAccessMatrix() {
  const [grants, setGrants] = React.useState<GovernanceGrant[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [surface, setSurface] = React.useState<GovernanceSurface>("alert_history");
  const [role, setRole] = React.useState<string>("any");
  const [corporateId, setCorporateId] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState("");
  const [userId, setUserId] = React.useState("");
  const [caps, setCaps] = React.useState({ can_read: true, can_export: false, can_manage: false });
  const [note, setNote] = React.useState("");
  const [verify, setVerify] = React.useState<Record<string, boolean | null>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setGrants(await loadGovernanceGrants());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load grants");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const runVerification = React.useCallback(async () => {
    const next: Record<string, boolean | null> = {};
    for (const s of GOVERNANCE_SURFACES) {
      for (const c of CAPABILITIES) {
        next[`${s}:${c}`] = await checkGovernanceAccess(s, c);
      }
    }
    setVerify(next);
    toast.success("Verified your effective access server-side");
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await createGovernanceGrant({
      surface,
      corporate_id: corporateId.trim() || null,
      corporate_role: role === "any" ? null : (role as (typeof CORPORATE_ROLES)[number]),
      department_id: departmentId.trim() || null,
      user_id: userId.trim() || null,
      ...caps,
      note,
    });
    setSaving(false);
    if (error) { toast.error(error); return; }
    toast.success("Grant created");
    setCorporateId(""); setDepartmentId(""); setUserId(""); setNote("");
    void load();
  };

  const toggle = async (g: GovernanceGrant, key: "can_read" | "can_export" | "can_manage") => {
    const patch = { [key]: !g[key] } as Partial<GovernanceGrant>;
    setGrants((prev) => prev.map((x) => (x.id === g.id ? { ...x, ...patch } : x)));
    const { error } = await updateGovernanceGrant(g.id, patch);
    if (error) { toast.error(error); void load(); }
  };

  const remove = async (g: GovernanceGrant) => {
    const { error } = await deleteGovernanceGrant(g.id);
    if (error) { toast.error(error); return; }
    toast.success("Grant revoked");
    setGrants((prev) => prev.filter((x) => x.id !== g.id));
  };

  const bySurface = React.useMemo(() => {
    const map = new Map<string, GovernanceGrant[]>();
    for (const s of GOVERNANCE_SURFACES) map.set(s, []);
    grants.forEach((g) => map.get(g.surface)?.push(g));
    return map;
  }, [grants]);

  return (
    <div className="space-y-6">
      <SeoHead
        title="Governance Access Matrix | Yalla"
        description="Manage fine-grained RBAC grants for alert history, concierge audit trails, report schedules and governance webhooks."
        path="/dashboard/admin/governance-access"
      />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <KeyRound className="h-5 w-5" aria-hidden /> Governance access matrix
          </h1>
          <p className="text-sm text-muted-foreground">
            Platform admins always pass. Everyone else needs an explicit grant — the database enforces it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void runVerification()}>
            <ShieldCheck className="mr-1 h-4 w-4" aria-hidden /> Verify my access
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </header>

      {Object.keys(verify).length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Your effective access</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Surface</th>
                  {CAPABILITIES.map((c) => <th key={c} className="py-2 pr-3">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {GOVERNANCE_SURFACES.map((s) => (
                  <tr key={s} className="border-b border-border/40">
                    <td className="py-2 pr-3">{SURFACE_LABEL[s]}</td>
                    {CAPABILITIES.map((c) => (
                      <td key={c} className="py-2 pr-3">
                        {verify[`${s}:${c}`] ? (
                          <Badge variant="outline" className="border-primary/30 bg-primary/15 text-primary">granted</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">denied</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Grant access</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ga-surface">Surface</Label>
              <Select value={surface} onValueChange={(v) => setSurface(v as GovernanceSurface)}>
                <SelectTrigger id="ga-surface"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GOVERNANCE_SURFACES.map((s) => (
                    <SelectItem key={s} value={s}>{SURFACE_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ga-role">Corporate role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="ga-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any role</SelectItem>
                  {CORPORATE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{r.replace("corporate_", "")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ga-corp">Corporate account ID (blank = all)</Label>
              <Input id="ga-corp" value={corporateId} onChange={(e) => setCorporateId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ga-dept">Department ID (blank = all)</Label>
              <Input id="ga-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ga-user">Specific user ID (optional)</Label>
              <Input id="ga-user" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ga-note">Note</Label>
              <Input id="ga-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this grant exists" />
            </div>
            <div className="flex flex-wrap items-center gap-6 md:col-span-2">
              {(["can_read", "can_export", "can_manage"] as const).map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <Switch
                    id={`ga-${k}`}
                    checked={caps[k]}
                    onCheckedChange={(v) => setCaps((p) => ({ ...p, [k]: v }))}
                  />
                  <Label htmlFor={`ga-${k}`} className="capitalize">{k.replace("can_", "")}</Label>
                </div>
              ))}
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={saving} className="w-full md:w-auto">
                <Plus className="mr-1 h-4 w-4" aria-hidden /> {saving ? "Saving…" : "Create grant"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {loading && grants.length === 0 ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        GOVERNANCE_SURFACES.map((s) => {
          const rows = bySurface.get(s) ?? [];
          return (
            <Card key={s}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{SURFACE_LABEL[s]}</CardTitle>
                  <a className="text-xs text-muted-foreground underline" href={SURFACE_ROUTE[s]}>{SURFACE_ROUTE[s]}</a>
                </div>
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No grants — platform admins only.</p>
                ) : (
                  <ul className="space-y-2">
                    {rows.map((g) => (
                      <li key={g.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 p-3 text-sm">
                        <span className="font-medium">{describeScope(g)}</span>
                        {g.note && <span className="text-xs text-muted-foreground">{g.note}</span>}
                        <div className="ml-auto flex items-center gap-4">
                          {(["can_read", "can_export", "can_manage"] as const).map((k) => (
                            <label key={k} className="flex items-center gap-1.5 text-xs capitalize">
                              <Switch
                                checked={g[k]}
                                onCheckedChange={() => void toggle(g, k)}
                                aria-label={`${k.replace("can_", "")} for ${describeScope(g)}`}
                              />
                              {k.replace("can_", "")}
                            </label>
                          ))}
                          <Button size="sm" variant="ghost" onClick={() => void remove(g)} aria-label="Revoke grant">
                            <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
