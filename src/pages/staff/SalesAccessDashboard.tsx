/**
 * SALES ACCESS — which leads each staff member can see and edit.
 * Admin-only. Grants/revocations go through sales_access_set (audited, reason required).
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StaffPageHeader } from "@/components/staff/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface Row {
  staff_id: string; user_id: string; full_name: string; work_email: string | null; employment_status: string;
  owned_leads: number; open_leads: number; role_read: boolean; role_manage: boolean;
  grant_read: boolean; grant_manage: boolean; roles: string[];
}

function scope(r: Row) {
  if (r.role_manage || r.grant_manage) return { label: "Can edit all leads", variant: "default" as const };
  if (r.role_read || r.grant_read) return { label: "Can view all · edits own leads", variant: "secondary" as const };
  return { label: "Own leads only", variant: "outline" as const };
}

export default function SalesAccessDashboard() {
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const q = useQuery({
    queryKey: ["sales-access-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sales_access_overview" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const change = async (r: Row, perm: "staff.crm.read" | "staff.crm.manage", grant: boolean) => {
    const reason = window.prompt(`${grant ? "Grant" : "Remove"} ${perm === "staff.crm.manage" ? "edit-all" : "view-all"} access for ${r.full_name}. Reason:`);
    if (!reason || reason.trim().length < 5) { if (reason !== null) toast.error("A reason of at least 5 characters is required."); return; }
    setPending(`${r.user_id}:${perm}`);
    const { error } = await supabase.rpc("sales_access_set" as never, { p_user_id: r.user_id, p_permission: perm, p_grant: grant, p_reason: reason } as never);
    setPending(null);
    if (error) {
      const m = error.message.includes("CANNOT_CHANGE_OWN_ACCESS") ? "You cannot change your own access." : error.message.includes("NOT_AUTHORISED") ? "Only admins and managers can change sales access." : error.message;
      toast.error(m); return;
    }
    toast.success("Access updated");
    qc.invalidateQueries({ queryKey: ["sales-access-overview"] });
    qc.invalidateQueries({ queryKey: ["sales-access-history"] });
  };

  const rows = (q.data ?? []).filter((r) => `${r.full_name} ${r.work_email ?? ""}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-6">
      <StaffPageHeader title="Sales access" lede="Which leads each staff member can see and edit. Every staff member can always edit the leads they own; grant wider access here. Every change is recorded with your name and reason." />
      <Input placeholder="Search staff" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-sm" />
      {q.isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : q.error ? (
        <Card><CardContent className="p-6 text-sm text-destructive">{String((q.error as Error).message).includes("NOT_AUTHORISED") ? "Only admins and managers can open this page." : (q.error as Error).message}</CardContent></Card>
      ) : (
        <Card><CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr><th className="p-3">Staff member</th><th className="p-3">Owned leads</th><th className="p-3">Can edit</th><th className="p-3">Granted here</th><th className="p-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = scope(r);
                return (
                  <tr key={r.user_id} className="border-b last:border-0">
                    <td className="p-3"><div className="font-medium">{r.full_name}</div><div className="text-xs text-muted-foreground">{r.work_email ?? "—"} · {r.roles.join(", ") || "no role"}</div></td>
                    <td className="p-3">{r.owned_leads} <span className="text-xs text-muted-foreground">({r.open_leads} open)</span></td>
                    <td className="p-3"><Badge variant={s.variant}>{s.label}</Badge></td>
                    <td className="p-3 space-x-1">
                      {r.grant_manage && <Badge>Edit all</Badge>}{r.grant_read && <Badge variant="secondary">View all</Badge>}
                      {!r.grant_manage && !r.grant_read && <span className="text-xs text-muted-foreground">None</span>}
                    </td>
                    <td className="p-3 text-right space-x-2 whitespace-nowrap">
                      {(["staff.crm.read", "staff.crm.manage"] as const).map((perm) => {
                        const has = perm === "staff.crm.read" ? r.grant_read : r.grant_manage;
                        const busy = pending === `${r.user_id}:${perm}`;
                        return (
                          <Button key={perm} size="sm" variant={has ? "outline" : "default"} disabled={busy} onClick={() => change(r, perm, !has)}>
                            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : `${has ? "Remove" : "Grant"} ${perm === "staff.crm.read" ? "view all" : "edit all"}`}
                          </Button>
                        );
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent></Card>
      )}
      <History names={Object.fromEntries((q.data ?? []).map((r) => [r.user_id, r.full_name]))} />
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" />Access from a staff role is shown under "Can edit" and is changed through role management, not here.</p>
    </div>
  );
}

function History({ names }: { names: Record<string, string> }) {
  const h = useQuery({
    queryKey: ["sales-access-history"],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_permission_grants" as never)
        .select("id,user_id,permission_key,reason,granted_by,granted_at,revoked_by,revoked_at,revoke_reason")
        .order("granted_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; user_id: string; permission_key: string; reason: string | null; granted_by: string; granted_at: string; revoked_by: string | null; revoked_at: string | null; revoke_reason: string | null }[];
    },
  });
  const events = (h.data ?? []).flatMap((g) => [
    { at: g.granted_at, text: `${names[g.granted_by] ?? "A manager"} granted ${g.permission_key === "staff.crm.manage" ? "edit all" : "view all"} to ${names[g.user_id] ?? "staff member"}`, reason: g.reason },
    ...(g.revoked_at ? [{ at: g.revoked_at, text: `${names[g.revoked_by ?? ""] ?? "A manager"} removed ${g.permission_key === "staff.crm.manage" ? "edit all" : "view all"} from ${names[g.user_id] ?? "staff member"}`, reason: g.revoke_reason }] : []),
  ]).sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Card><CardContent className="p-4 space-y-2">
      <div className="font-medium">Change history</div>
      {events.length === 0 ? <p className="text-sm text-muted-foreground">No access changes yet.</p> : events.map((e, i) => (
        <div key={i} className="text-sm border-b last:border-0 pb-2"><div>{e.text}</div><div className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString("en-KE")} · Reason: {e.reason ?? "—"}</div></div>
      ))}
    </CardContent></Card>
  );
}
