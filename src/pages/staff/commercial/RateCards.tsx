/**
 * Rate-card portal — /staff/commercial/rate-cards
 *
 * The live price book, its version history and the approval trail. Prices may
 * only be edited on a draft version; approval by a second person makes it live
 * and retires the version it replaces.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, CalendarClock, Copy, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { toneClasses } from "@/lib/design/statusTone";
import { cn } from "@/lib/utils";
import {
  DOMAIN_LABEL, RATE_STATUS_LABEL, RATE_STATUS_TONE, createRateCardVersion, fetchRateCardPortal,
  rate, rateCardActions, runRateCardAction, saveRateLine, notifyRateCardReviewers,
  type RateCard, type RateCardAction, type RateCardPortal, type RateCardStatus,
} from "@/lib/commercial/rateCards";

const badgeTone = (tone: string) => {
  const t = toneClasses(tone);
  return cn(t.bg, t.text, t.border, "border");
};

const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-KE", { dateStyle: "medium" }) : "—");
const when = (v: string) => new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });

const ACTION_LABEL: Record<RateCardAction, string> = {
  SUBMIT: "Send for approval",
  APPROVE: "Approve and make live",
  REJECT: "Send back",
  RETIRE: "Retire",
};

export default function RateCards() {
  const [data, setData] = useState<RateCardPortal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [newVersion, setNewVersion] = useState<{ card: string | null; version: string; from: string; reason: string }>({
    card: null, version: "", from: "", reason: "",
  });
  const [edits, setEdits] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchRateCardPortal());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the rate-card portal.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, RateCard[]>();
    for (const c of data?.cards ?? []) {
      const list = map.get(c.code) ?? [];
      list.push(c);
      map.set(c.code, list);
    }
    return [...map.entries()];
  }, [data]);

  const act = async (card: RateCard, action: RateCardAction) => {
    setBusy(true);
    try {
      const res = await runRateCardAction(card.id, action, note);
      let extra = "";
      if (action === "SUBMIT") {
        const notice = await notifyRateCardReviewers(card.id);
        extra = notice?.sent ? ` Approvers notified by email (${notice.sent}).` : " Approvers could not be emailed.";
      }
      toast({
        title: ACTION_LABEL[action],
        description: res.sole_approver
          ? "Recorded as a sole administrator approval."
          : `${card.name} ${card.version} is now ${RATE_STATUS_LABEL[res.status as RateCardStatus].toLowerCase()}.${extra}`,
      });
      setNote("");
      await load();
    } catch (e) {
      toast({ title: "Not done", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const makeVersion = async (card: RateCard) => {
    setBusy(true);
    try {
      await createRateCardVersion(card.id, newVersion.version, newVersion.from || null, newVersion.reason || null);
      toast({ title: "Draft version created", description: "Every rate was copied across; edit what changed." });
      setNewVersion({ card: null, version: "", from: "", reason: "" });
      await load();
    } catch (e) {
      toast({ title: "Not created", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const saveLine = async (cardId: string, lineId: string) => {
    const raw = edits[lineId];
    if (raw === undefined || raw === "") return;
    setBusy(true);
    try {
      await saveRateLine({ id: lineId, rate_card_id: cardId, amount: Number(raw) });
      toast({ title: "Rate updated" });
      setEdits((p) => {
        const n = { ...p };
        delete n[lineId];
        return n;
      });
      await load();
    } catch (e) {
      toast({ title: "Not saved", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const kpi = data?.kpi;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Rate cards</h1>
        <p className="text-sm text-muted-foreground">
          The prices we are allowed to quote, who approved them and when they are next due for review.
        </p>
      </header>

      <AsyncState loading={loading} error={error} onRetry={load}>
        {kpi && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <BadgeCheck className="h-4 w-4" /> Approved rates in force
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{kpi.approved_rate_count}</p>
                <p className="text-xs text-muted-foreground">across {kpi.live_card_count} live card(s)</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Awaiting approval</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{kpi.awaiting_approval}</p>
                <p className="text-xs text-muted-foreground">{kpi.draft_count} draft version(s)</p>
              </CardContent>
            </Card>
            <Card className="sm:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <CalendarClock className="h-4 w-4" /> Next review
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{day(kpi.next_review_at)}</p>
                <p className="text-xs text-muted-foreground">
                  {kpi.review_overdue > 0 ? `${kpi.review_overdue} card(s) overdue for review` : "No card is overdue"}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {grouped.map(([code, versions]) => {
          const live = versions.find((v) => v.status === "approved") ?? versions[0];
          return (
            <Card key={code}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{live.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {DOMAIN_LABEL[live.product_domain] ?? live.product_domain} · {live.currency} · source:{" "}
                    {live.source_reference ?? "not recorded"}
                  </p>
                </div>
                {data?.can_write && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setNewVersion({ card: newVersion.card === live.id ? null : live.id, version: "", from: "", reason: "" })}
                  >
                    <Copy className="mr-2 h-4 w-4" /> New version
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {newVersion.card === live.id && (
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Version name</Label>
                        <Input
                          placeholder="v1.1"
                          value={newVersion.version}
                          onChange={(e) => setNewVersion({ ...newVersion, version: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Prices apply from</Label>
                        <Input type="date" value={newVersion.from} onChange={(e) => setNewVersion({ ...newVersion, from: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Why it is changing</Label>
                        <Input value={newVersion.reason} onChange={(e) => setNewVersion({ ...newVersion, reason: e.target.value })} />
                      </div>
                    </div>
                    <Button size="sm" disabled={busy} onClick={() => void makeVersion(live)}>
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create draft copy
                    </Button>
                  </div>
                )}

                {versions.map((card) => {
                  const actions = rateCardActions(card, { canWrite: !!data?.can_write, canApprove: !!data?.can_approve });
                  const open = openId === card.id;
                  return (
                    <div key={card.id} className="rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {card.version}{" "}
                            <Badge className={cn("ml-2", badgeTone(RATE_STATUS_TONE[card.status]))}>
                              {RATE_STATUS_LABEL[card.status]}
                            </Badge>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {card.line_count} rate(s) · from {day(card.effective_from)} · review {day(card.review_at)}
                            {card.approved_at ? ` · approved ${day(card.approved_at)}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => setOpenId(open ? null : card.id)}>
                            {open ? "Hide rates" : "View rates"}
                          </Button>
                          {actions.map((a) => (
                            <Button
                              key={a}
                              size="sm"
                              variant={a === "APPROVE" ? "default" : "outline"}
                              disabled={busy}
                              onClick={() => void act(card, a)}
                            >
                              {ACTION_LABEL[a]}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {actions.some((a) => a === "REJECT" || a === "RETIRE") && (
                        <div className="mt-3 space-y-1">
                          <Label className="text-xs">Reason (needed to send back or retire)</Label>
                          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                        </div>
                      )}

                      {open && (
                        <div className="mt-4 space-y-3">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                                  <th className="py-2 pr-3">Service</th>
                                  <th className="py-2 pr-3">Scope</th>
                                  <th className="py-2 pr-3">Basis</th>
                                  <th className="py-2 pr-3">Rate</th>
                                  {card.status === "source" && data?.can_write && <th className="py-2">Change</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {card.lines.map((l) => (
                                  <tr key={l.id} className="border-b border-border/60">
                                    <td className="py-2 pr-3">{l.service_code ?? "—"}</td>
                                    <td className="py-2 pr-3 text-muted-foreground">{l.scope_label ?? l.category_code ?? "—"}</td>
                                    <td className="py-2 pr-3 text-muted-foreground">{l.pricing_basis ?? "—"}</td>
                                    <td className="py-2 pr-3 font-medium">{rate(l.amount, l.currency ?? card.currency)}</td>
                                    {card.status === "source" && data?.can_write && (
                                      <td className="py-2">
                                        <div className="flex items-center gap-2">
                                          <Input
                                            className="h-8 w-28"
                                            type="number"
                                            placeholder={String(l.amount ?? "")}
                                            value={edits[l.id] ?? ""}
                                            onChange={(e) => setEdits({ ...edits, [l.id]: e.target.value })}
                                          />
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={busy || !edits[l.id]}
                                            onClick={() => void saveLine(card.id, l.id)}
                                          >
                                            <Save className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="space-y-1">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">History</p>
                            {card.events.length === 0 && <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>}
                            {card.events.map((e, i) => (
                              <p key={`${e.created_at}-${i}`} className="text-xs text-muted-foreground">
                                {when(e.created_at)} · {e.event.replace(/_/g, " ")}
                                {e.actor_name ? ` by ${e.actor_name}` : ""}
                                {e.sole_approver ? " (sole administrator approval)" : ""}
                                {e.note ? ` — ${e.note}` : ""}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </AsyncState>
    </div>
  );
}
