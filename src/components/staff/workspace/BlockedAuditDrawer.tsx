import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { fetchWorkAudit, type OpsAuditEntry } from "@/lib/orchestration/api";

/** Actions the cockpit itself can write — highlighted in the trail. */
const COCKPIT_ACTIONS = new Set([
  "approval_requested",
  "approval_approved",
  "approval_declined",
  "work_carried_forward",
]);

const ACTION_LABEL: Record<string, string> = {
  approval_requested: "Decision requested",
  approval_approved: "Decision approved",
  approval_declined: "Decision declined",
  work_carried_forward: "Carried into tomorrow",
};

/** Downloads the recorded trail as a PDF — who asked, who resolved, why, when. */
async function exportAuditPdf(workTitle: string, entries: OpsAuditEntry[]) {
  const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new JsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text("Yalla Mobility — blocked work audit trail", 40, 44);
  doc.setFontSize(10);
  doc.text(workTitle, 40, 62);
  doc.text(`Exported ${new Date().toLocaleString("en-KE")} · ${entries.length} recorded entries`, 40, 78);

  autoTable(doc, {
    startY: 96,
    styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
    headStyles: { fillColor: [20, 52, 144] },
    head: [["When", "Action", "Actor", "Role", "State", "Reason"]],
    body: entries.map((e) => [
      new Date(e.created_at).toLocaleString("en-KE"),
      ACTION_LABEL[e.action] ?? e.action.replace(/_/g, " "),
      e.actor_name ?? "Unattributed",
      e.actor_role ?? "—",
      `${e.state_before ?? "—"} → ${e.state_after ?? "—"}`,
      e.reason ?? "—",
    ]),
  });

  const slug = workTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  doc.save(`audit-trail-${slug || "blocked-work"}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * AUDIT TRAIL DRAWER — who resolved or requested a decision on a blocked item,
 * the reason they entered, and when. Read-only, straight from `ops_work_audit`.
 */
export function BlockedAuditDrawer({
  workId,
  workTitle,
  open,
  onOpenChange,
}: {
  workId: string | null;
  workTitle: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [entries, setEntries] = React.useState<OpsAuditEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!workId) return;
    setEntries(null);
    setError(null);
    try {
      setEntries(await fetchWorkAudit(workId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the audit trail");
    }
  }, [workId]);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg" data-testid="blocked-audit-drawer">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Audit trail
          </SheetTitle>
          <SheetDescription>{workTitle}</SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          <Button
            size="sm"
            variant="outline"
            data-analytics="staff.workspace.export_blocked_audit_pdf"
            disabled={!entries || entries.length === 0}
            onClick={async () => {
              try {
                await exportAuditPdf(workTitle, entries ?? []);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not build the PDF");
              }
            }}
          >
            <Download className="mr-2 h-3.5 w-3.5" /> Export audit trail (PDF)
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          {error && (
            <div className="rounded-md border border-destructive/40 p-3 text-sm text-muted-foreground">
              {error}
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={load}>
                  Retry
                </Button>
              </div>
            </div>
          )}

          {!error && entries === null && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading the recorded trail…
            </div>
          )}

          {entries?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing has been recorded against this item yet.
            </p>
          )}

          <ol className="space-y-3">
            {(entries ?? []).map((e) => (
              <li key={e.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {ACTION_LABEL[e.action] ?? e.action.replace(/_/g, " ")}
                  </span>
                  {COCKPIT_ACTIONS.has(e.action) && (
                    <Badge variant="outline" className="text-[10px]">
                      cockpit action
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {e.actor_name ?? "Unattributed"}
                  {e.actor_role ? ` · ${e.actor_role}` : ""} ·{" "}
                  {new Date(e.created_at).toLocaleString()}
                </div>
                {(e.state_before || e.state_after) && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {e.state_before ?? "—"} → {e.state_after ?? "—"}
                  </div>
                )}
                {e.reason && <p className="mt-2 text-sm">“{e.reason}”</p>}
              </li>
            ))}
          </ol>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default BlockedAuditDrawer;
