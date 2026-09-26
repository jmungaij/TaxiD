/**
 * PROVIDER ESCALATION PANEL — the operations desk escalation path.
 *
 * A service issue is sent to the team that can fix it, with the response
 * deadline its route carries. Routes marked as blocking hold new bookings for
 * that customer until the team closes the escalation.
 */
import * as React from "react";
import { ArrowRight, Loader2, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  advanceEscalation,
  loadEscalationBoard,
  raiseEscalation,
  type EscalationBoard,
} from "@/lib/operations/providerEscalation";
import type { ManagerException } from "@/lib/sales/managerOperations";

interface Props {
  /** Open service issues already on the manager desk, offered as the source of an escalation. */
  issues?: ManagerException[];
}

export default function ProviderEscalationPanel({ issues = [] }: Props) {
  const [board, setBoard] = React.useState<EscalationBoard | null>(null);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [route, setRoute] = React.useState("");
  const [issueId, setIssueId] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [provider, setProvider] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy(true);
    try {
      setBoard(await loadEscalationBoard());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The escalation path could not be read.");
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const chosenIssue = issues.find((i) => i.signal_id === issueId);
  const chosenRoute = board?.routes.find((r) => r.code === route);

  const submit = async () => {
    if (!chosenIssue?.account_id) {
      toast.error("Choose the customer issue this escalation comes from.");
      return;
    }
    setSaving(true);
    try {
      const res = await raiseEscalation({
        accountId: chosenIssue.account_id,
        routeCode: route,
        summary: summary.trim() || chosenIssue.headline || "",
        providerLabel: provider.trim() || null,
        signalId: chosenIssue.signal_id,
      });
      toast.success(
        `${res.escalation_ref} sent to ${res.assigned_team}${res.blocks_booking ? " — new bookings held" : ""}`,
      );
      setSummary("");
      setProvider("");
      setIssueId("");
      setRoute("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The escalation could not be raised.");
    } finally {
      setSaving(false);
    }
  };

  const close = async (id: string, status: "acknowledged" | "resolved" | "withdrawn") => {
    const note =
      status === "acknowledged"
        ? undefined
        : window.prompt(status === "resolved" ? "What was done to fix it?" : "Why is this being withdrawn?") ?? "";
    if (status !== "acknowledged" && !note.trim()) return;
    try {
      await advanceEscalation(id, status, note);
      toast.success(`Escalation ${status}.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The escalation could not be updated.");
    }
  };

  return (
    <Card className={board && board.blocking_count > 0 ? "border-destructive/40" : undefined}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Provider escalations
          </p>
          {board && (
            <div className="flex gap-1.5">
              <Badge variant="outline">{board.open_count} open</Badge>
              {board.overdue_count > 0 && <Badge variant="destructive">{board.overdue_count} overdue</Badge>}
              {board.blocking_count > 0 && <Badge variant="destructive">{board.blocking_count} holding bookings</Badge>}
            </div>
          )}
        </div>

        {busy && !board && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Reading the escalation path…
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {board && (
          <>
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <p className="text-xs font-semibold">Send an issue to the team that can fix it</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={issueId} onValueChange={setIssueId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Customer issue from operations" />
                  </SelectTrigger>
                  <SelectContent>
                    {issues.length === 0 ? (
                      <SelectItem value="none" disabled>
                        No open service issues
                      </SelectItem>
                    ) : (
                      issues.map((i) => (
                        <SelectItem key={i.signal_id} value={i.signal_id}>
                          {i.customer_label ?? "Customer not stated"} · {i.headline ?? "no detail"}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Select value={route} onValueChange={setRoute}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Escalate to" />
                  </SelectTrigger>
                  <SelectContent>
                    {board.routes.map((r) => (
                      <SelectItem key={r.code} value={r.code}>
                        {r.label} → {r.responsible_team} ({r.response_minutes} min
                        {r.blocks_booking ? ", holds bookings" : ""})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                className="h-8 text-xs"
                placeholder="Driver, vehicle or provider (optional)"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              />
              <Textarea
                className="text-xs"
                rows={2}
                placeholder="What happened, in the customer's words"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
              {chosenRoute?.guidance && <p className="text-[11px] text-muted-foreground">{chosenRoute.guidance}</p>}
              <Button size="sm" className="h-8" disabled={saving || !issueId || !route} onClick={() => void submit()}>
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />}
                Escalate
              </Button>
            </div>

            {board.escalations.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing is escalated. Anything sent here shows the team responsible, the response deadline, and whether
                new bookings for that customer are held.
              </p>
            ) : (
              <ul className="space-y-2">
                {board.escalations.map((e) => (
                  <li key={e.escalation_id} className="rounded-md border px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">
                        {e.customer_label ?? "Customer not stated"} · {e.route_label}
                      </p>
                      <div className="flex gap-1.5">
                        <Badge variant="outline">{e.assigned_team}</Badge>
                        {e.blocks_booking && <Badge variant="destructive">Bookings held</Badge>}
                        {e.overdue && <Badge variant="destructive">Overdue</Badge>}
                        <Badge variant="outline">{e.status}</Badge>
                      </div>
                    </div>
                    <p className="mt-0.5 text-muted-foreground">{e.summary}</p>
                    <p className="text-muted-foreground">
                      {e.escalation_ref} · due {new Date(e.due_at).toLocaleString()} ·{" "}
                      {e.raised_by ?? "raised by staff"}
                      {e.provider_label ? ` · ${e.provider_label}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {e.status === "raised" && (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => void close(e.escalation_id, "acknowledged")}>
                          Acknowledge
                        </Button>
                      )}
                      {e.status !== "resolved" && e.status !== "withdrawn" && (
                        <>
                          <Button size="sm" variant="outline" className="h-7" onClick={() => void close(e.escalation_id, "resolved")}>
                            Resolve
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => void close(e.escalation_id, "withdrawn")}>
                            Withdraw
                          </Button>
                        </>
                      )}
                      {e.account_id && (
                        <Link
                          className="inline-flex items-center text-[11px] font-semibold underline"
                          to={`/staff/workspace/accounts/${e.account_id}`}
                        >
                          Account page <ArrowRight className="ml-1 h-3 w-3" aria-hidden />
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
