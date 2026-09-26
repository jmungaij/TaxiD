/**
 * LG APPROVER & INSURER ROLE MATRIX — administered approval authority.
 *
 * Administrators declare which platform role may record which kind of LG
 * determination decision, and for which controls. The database enforces the
 * same mapping, so a role that is not mapped simply cannot approve. Nothing
 * here marks a control PASS.
 */
import * as React from "react";
import { Plus, ShieldAlert, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  LG_APPROVER_KINDS,
  LG_APPROVER_KIND_LABEL,
  LG_CONTROL_IDS,
  LG_MAPPABLE_ROLES,
  deleteLgApproverMap,
  fetchLgApproverMap,
  mappedControlScope,
  setLgApproverMapFlags,
  unmappedControls,
  upsertLgApproverMap,
  type LgApproverMapRow,
} from "@/lib/logistics/legal/approverMap";
import { LG_INSURER_CONTROLS, type LgApproverKind } from "@/lib/logistics/legal/dossierControl";

const ALL = "__ALL__";

export function LgApproverMatrixPanel({ onChanged }: { onChanged?: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<LgApproverMapRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [kind, setKind] = React.useState<LgApproverKind>("legal_reviewer");
  const [role, setRole] = React.useState<string>("compliance_admin");
  const [controlId, setControlId] = React.useState<string>(ALL);
  const [notes, setNotes] = React.useState("");

  const reload = React.useCallback(async () => {
    try {
      setRows(await fetchLgApproverMap());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The approver role mapping could not be read.");
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const controlOptions = React.useMemo(
    () => (kind === "insurer" ? [...LG_INSURER_CONTROLS] : LG_CONTROL_IDS),
    [kind],
  );

  const add = async () => {
    setBusy(true);
    try {
      await upsertLgApproverMap({
        approver_kind: kind,
        role,
        control_id: controlId === ALL ? null : controlId,
        allowed: true,
        notify: true,
        notes: notes.trim() || null,
      });
      toast({
        title: "Approval authority recorded",
        description: `${role} may now record ${LG_APPROVER_KIND_LABEL[kind].toLowerCase()} decisions on ${
          controlId === ALL ? "all LG controls" : controlId
        }.`,
      });
      setNotes("");
      await reload();
      onChanged?.();
    } catch (e) {
      toast({
        title: "Not recorded",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: LgApproverMapRow, patch: { allowed?: boolean; notify?: boolean }) => {
    try {
      await setLgApproverMapFlags(row.id, patch);
      await reload();
      onChanged?.();
    } catch (e) {
      toast({ title: "Change refused", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  };

  const remove = async (row: LgApproverMapRow) => {
    try {
      await deleteLgApproverMap(row.id);
      await reload();
      onChanged?.();
    } catch (e) {
      toast({ title: "Removal refused", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    }
  };

  const gaps = React.useMemo(() => unmappedControls(rows), [rows]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Approver &amp; insurer authority mapping</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Only a role mapped here may record that kind of determination decision, and only on the controls in its
          scope. The database enforces the same rule, so an unmapped role is refused even if it reaches the API
          directly. Insurer authority can only be granted on {LG_INSURER_CONTROLS.join(" and ")}.
        </p>

        {gaps.length > 0 && (
          <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-medium">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> {gaps.length} control(s) have no mapped approver
            </p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {gaps.map((g) => (
                <li key={g.control_id}>
                  {g.control_id} — missing {g.missing.map((m) => LG_APPROVER_KIND_LABEL[m].toLowerCase()).join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Scope summary */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Role</th>
                {LG_APPROVER_KINDS.map((k) => (
                  <th key={k} className="py-1 pr-3 font-medium">{LG_APPROVER_KIND_LABEL[k]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LG_MAPPABLE_ROLES.map((r) => (
                <tr key={r} className="border-t border-border">
                  <td className="py-1.5 pr-3 font-mono">{r}</td>
                  {LG_APPROVER_KINDS.map((k) => (
                    <td key={k} className="py-1.5 pr-3 text-muted-foreground">{mappedControlScope(rows, k, r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Grants */}
        <div className="space-y-2">
          {rows.length === 0 && <p className="text-xs text-muted-foreground">No approval authority is configured.</p>}
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2 text-xs">
              <Badge variant="outline" className="text-[10px]">{LG_APPROVER_KIND_LABEL[row.approver_kind]}</Badge>
              <span className="font-mono">{row.role}</span>
              <span className="text-muted-foreground">{row.control_id ?? "All LG controls"}</span>
              <label className="ml-auto flex items-center gap-1.5">
                <Switch checked={row.allowed} onCheckedChange={(v) => void toggle(row, { allowed: v })} />
                <span>May approve</span>
              </label>
              <label className="flex items-center gap-1.5">
                <Switch checked={row.notify} onCheckedChange={(v) => void toggle(row, { notify: v })} />
                <span>Notify</span>
              </label>
              <Button size="sm" variant="ghost" onClick={() => void remove(row)} aria-label={`Remove ${row.role} ${row.approver_kind}`}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
              {row.notes && <span className="w-full text-muted-foreground">{row.notes}</span>}
            </div>
          ))}
        </div>

        {/* New grant */}
        <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Approver kind</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as LgApproverKind);
                setControlId(v === "insurer" ? LG_INSURER_CONTROLS[0] : ALL);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LG_APPROVER_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>{LG_APPROVER_KIND_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Platform role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LG_MAPPABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Control scope</Label>
            <Select value={controlId} onValueChange={setControlId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {kind !== "insurer" && <SelectItem value={ALL}>All LG controls</SelectItem>}
                {controlOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="lg-map-notes">Basis of authority</Label>
            <Input id="lg-map-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Board delegation of 12 Aug" />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button size="sm" onClick={add} disabled={busy} data-analytics="admin.legal.map_approver">
              <Plus className="mr-1 h-4 w-4" aria-hidden /> {busy ? "Recording…" : "Grant approval authority"}
            </Button>
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

export default LgApproverMatrixPanel;
