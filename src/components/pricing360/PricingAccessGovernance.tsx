/**
 * Pricing 360 — Access & Surface Governance.
 *
 * Two admin controls in one place:
 *   1. Feature flags for the Command Center presentation surfaces.
 *   2. The RBAC role matrix, derived from the enforced server policy, with
 *      explicit per-role overrides for the client view.
 *
 * Honesty rules enforced here:
 *   • The matrix always shows what the *server* enforces, and marks any admin
 *     override that contradicts it as drift.
 *   • Overrides are labelled as client-side only — the database RLS policies and
 *     pricing RPCs remain the sole authority over what actually happens.
 *   • Every change is written to the pricing audit trail with a reason.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Minus, ShieldCheck, ToggleLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePricingFlags } from "@/hooks/usePricingFlags";
import { PRICING_FLAGS, setPricingFlag, type PricingFlagKey } from "@/lib/pricing360/featureFlags";
import {
  buildMatrix, fetchPricingGrants, matrixDrift, PRICING_PERMISSIONS, PRICING_ROLE_LABELS,
  PRICING_ROLES, setPricingGrant, type MatrixCell, type PricingGrantRow,
  type PricingPermission, type PricingRole,
} from "@/lib/pricing360/rbac";
import { auditedPricingAction } from "@/lib/pricing360/audit";

export function PricingAccessGovernance() {
  const { rows: flagRows, flags, loading: flagsLoading, source, error: flagError, reload } = usePricingFlags();
  const [grants, setGrants] = useState<PricingGrantRow[] | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const loadGrants = useCallback(async () => {
    try {
      setGrants(await fetchPricingGrants());
      setGrantError(null);
    } catch (e) {
      setGrants(null);
      setGrantError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void loadGrants(); }, [loadGrants]);

  const cells = buildMatrix(grants);
  const drift = matrixDrift(cells);
  const cellFor = (role: PricingRole, permission: PricingPermission): MatrixCell =>
    cells.find((c) => c.role === role && c.permission === permission)!;

  const toggleFlag = async (key: PricingFlagKey, next: boolean) => {
    if (!reason.trim()) {
      toast.error("A governance reason is required to change a Pricing 360 flag");
      return;
    }
    setBusy(true);
    try {
      await auditedPricingAction(
        {
          action: "save",
          entity: "pricing360_feature_flags",
          reason: reason.trim(),
          before: { key, enabled: flags[key] },
          after: { key, enabled: next },
        },
        () => setPricingFlag(key, next, reason.trim()),
      );
      await reload();
      toast.success(`${key} ${next ? "enabled" : "disabled"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Flag change refused — admin role required");
    } finally {
      setBusy(false);
    }
  };

  const toggleGrant = async (cell: MatrixCell) => {
    if (!reason.trim()) {
      toast.error("A governance reason is required to change a role permission");
      return;
    }
    const next = !cell.effective;
    setBusy(true);
    try {
      await auditedPricingAction(
        {
          action: next ? "approve" : "reject",
          entity: "pricing360_role_grants",
          reason: reason.trim(),
          before: { role: cell.role, permission: cell.permission, allowed: cell.effective, enforced: cell.enforced },
          after: { role: cell.role, permission: cell.permission, allowed: next },
        },
        () => setPricingGrant(cell.role, cell.permission, next, reason.trim()),
      );
      await loadGrants();
      toast.success(`${PRICING_ROLE_LABELS[cell.role]} → ${cell.permission}: ${next ? "granted" : "withheld"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Permission change refused — admin role required");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" aria-hidden /> Governance reason
          </CardTitle>
          <CardDescription>
            Required for every flag and permission change. It is written to the pricing audit trail
            alongside the before/after values.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-2xl space-y-1.5">
          <Label htmlFor="pricing-access-reason">Reason</Label>
          <Input
            id="pricing-access-reason"
            placeholder="e.g. Disable dynamic pricing surface pending Q3 surge policy review"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ToggleLeft className="h-4 w-4" aria-hidden /> Command Center surface flags
          </CardTitle>
          <CardDescription>
            Flags govern presentation only — a disabled surface renders a stated disabled panel and
            can never change a computed price.{" "}
            {source === "defaults"
              ? "The flag store is unreachable, so registry defaults are in force."
              : "Values shown are the stored, administrator-set values."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {flagError && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" aria-hidden />
              <span>Flag store unavailable ({flagError}). Registry defaults are being shown.</span>
            </div>
          )}
          {flagsLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : (
            PRICING_FLAGS.map((f) => {
              const row = flagRows.find((r) => r.key === f.key);
              return (
                <div key={f.key} className="flex items-start justify-between gap-4 rounded-md border p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{f.label}</p>
                    <p className="text-xs text-muted-foreground">{f.surface}</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Badge variant="outline" className="text-[10px]">{f.key}</Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {row ? `Set by an administrator · ${new Date(row.updated_at).toISOString().slice(0, 10)}` : "Registry default"}
                      </Badge>
                    </div>
                    {row?.note && <p className="text-xs italic text-muted-foreground">“{row.note}”</p>}
                  </div>
                  <Switch
                    checked={flags[f.key]}
                    disabled={busy}
                    aria-label={`${f.label} enabled`}
                    onCheckedChange={(v) => void toggleFlag(f.key, v)}
                  />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" aria-hidden /> Pricing 360 role matrix
          </CardTitle>
          <CardDescription>
            Derived from the enforced policy: route guards, table RLS and the pricing RPCs. A tick is
            the server behaviour; an override marks a deliberate client-side narrowing or widening.
            Publishing is deliberately separated from drafting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {grantError && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" aria-hidden />
              <span>
                Overrides unavailable ({grantError}). The matrix below is the enforced server policy
                with no overrides applied.
              </span>
            </div>
          )}
          {drift.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
              <p className="font-medium">{drift.length} override(s) contradict the enforced policy</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {drift.map((d) => (
                  <li key={`${d.role}:${d.permission}`}>
                    {PRICING_ROLE_LABELS[d.role]} → {d.permission}: server says{" "}
                    {d.enforced ? "allowed" : "denied"}, override says {d.override ? "allowed" : "denied"}.
                    The server wins at runtime.
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[16rem]">Permission · enforced by</TableHead>
                  {PRICING_ROLES.map((r) => (
                    <TableHead key={r} className="text-center text-xs">{PRICING_ROLE_LABELS[r]}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {PRICING_PERMISSIONS.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell>
                      <p className="text-sm font-medium">{p.label}</p>
                      <p className="text-xs text-muted-foreground">{p.enforcedBy}</p>
                    </TableCell>
                    {PRICING_ROLES.map((role) => {
                      const cell = cellFor(role, p.key);
                      return (
                        <TableCell key={role} className="text-center">
                          <Button
                            type="button"
                            size="sm"
                            variant={cell.effective ? "default" : "outline"}
                            disabled={busy}
                            aria-pressed={cell.effective}
                            aria-label={`${PRICING_ROLE_LABELS[role]} ${p.label} ${cell.effective ? "granted" : "withheld"}`}
                            title={
                              cell.override === null
                                ? `Enforced policy: ${cell.enforced ? "allowed" : "denied"}`
                                : `Override: ${cell.override ? "allowed" : "denied"} (enforced: ${cell.enforced ? "allowed" : "denied"})`
                            }
                            onClick={() => void toggleGrant(cell)}
                          >
                            {cell.effective
                              ? <Check className="h-4 w-4" aria-hidden />
                              : <Minus className="h-4 w-4" aria-hidden />}
                          </Button>
                          {cell.override !== null && (
                            <span className="mt-1 block text-[10px] text-warning">override</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Overrides govern what this interface offers. Database RLS and the pricing RPCs remain the
            sole authority: a widened override cannot make the server accept a refused action, and
            every refusal is recorded in the audit log as <code>rbac:denied</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default PricingAccessGovernance;
