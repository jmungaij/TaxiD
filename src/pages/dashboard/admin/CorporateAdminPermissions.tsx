/**
 * Super-admin permissions matrix.
 *
 * Grants granular access to corporate portfolio, approvals, bulk actions,
 * assisted booking, support and governance surfaces per platform role. Only
 * super admins may edit; the edge function rejects `permission_set` for
 * everyone else, and server-side role checks still bound every operation, so a
 * grant can widen the console UI but never exceed the role's real authority.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Lock, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { invokeCorporateConsole } from "@/lib/corporate/manageAs";
import {
  ADMIN_CAPABILITIES, CAPABILITY_GROUPS, MATRIX_ROLES, ROLE_LABEL,
  buildMatrix, type AdminCapability, type MatrixRole, type PermissionGrant, type PermissionMatrix,
} from "@/lib/corporate/adminCapabilities";

export default function CorporateAdminPermissions() {
  const [grants, setGrants] = useState<PermissionGrant[]>([]);
  const [editable, setEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invokeCorporateConsole<{ grants: PermissionGrant[]; editable: boolean }>({ op: "permissions" });
      setGrants(res.grants ?? []);
      setEditable(!!res.editable);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const matrix: PermissionMatrix = useMemo(() => buildMatrix(grants), [grants]);

  async function toggle(role: MatrixRole, capability: AdminCapability, next: boolean) {
    const key = `${role}::${capability}`;
    setPending(key);
    // Optimistic update — reverted if the server rejects the change.
    setGrants((prev) => [
      ...prev.filter((g) => !(g.role === role && g.capability === capability)),
      { role, capability, allowed: next },
    ]);
    try {
      await invokeCorporateConsole({ op: "permission_set", role, capability, allowed: next });
      toast({
        title: next ? "Capability granted" : "Capability revoked",
        description: `${ROLE_LABEL[role]} — ${ADMIN_CAPABILITIES.find((c) => c.key === capability)?.label}`,
      });
    } catch (e) {
      setGrants((prev) => [
        ...prev.filter((g) => !(g.role === role && g.capability === capability)),
        { role, capability, allowed: !next },
      ]);
      toast({ title: "Change rejected", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin permissions matrix</h1>
          <p className="text-sm text-muted-foreground">
            Grant granular access to corporates, approvals, bulk actions, assisted booking and governance.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {error && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" /> {error}
        </p>
      )}

      {!editable && !loading && (
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" />
            Read-only view — only super admins can change capability grants.
          </CardContent>
        </Card>
      )}

      {CAPABILITY_GROUPS.map((group) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> {group}
            </CardTitle>
            <CardDescription>
              Super admin retains every capability in this group and cannot be locked out.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[240px]">Capability</TableHead>
                  {MATRIX_ROLES.map((role) => (
                    <TableHead key={role} className="text-center">{ROLE_LABEL[role]}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {ADMIN_CAPABILITIES.filter((c) => c.group === group).map((cap) => (
                  <TableRow key={cap.key}>
                    <TableCell>
                      <div className="font-medium">{cap.label}</div>
                      <div className="text-xs text-muted-foreground">{cap.key}</div>
                    </TableCell>
                    {MATRIX_ROLES.map((role) => {
                      const locked = role === "super_admin" || !editable;
                      const key = `${role}::${cap.key}`;
                      return (
                        <TableCell key={role} className="text-center">
                          {role === "super_admin" ? (
                            <Badge variant="outline">Always</Badge>
                          ) : (
                            <Switch
                              checked={matrix[role][cap.key]}
                              disabled={locked || pending === key}
                              onCheckedChange={(next) => void toggle(role, cap.key, next)}
                              aria-label={`${ROLE_LABEL[role]} — ${cap.label}`}
                            />
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
