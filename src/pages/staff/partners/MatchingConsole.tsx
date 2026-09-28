/**
 * TaxiD PARTNERS 360 — demand desk: matching, quotation and award.
 *
 * Demand (capacity_requests) → explainable partner matching → quote invitation
 * → partner price → commercial decision. Ranking, pricing arithmetic and the
 * maker-checker rule all live in the database; this screen only shows the
 * server's reasoning and relays decisions.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Gauge, Send, XCircle } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SERVICE_TYPE_LABEL, fetchCapacityRequests, fetchPartners, kes, partnerName } from "@/lib/partners/api";
import {
  decideQuote, fetchQuotes, matchDemand, requestQuote, submitQuote,
} from "@/lib/partners/marketplace";

export default function MatchingConsole() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [price, setPrice] = useState<Record<string, string>>({});

  const demand = useQuery({ queryKey: ["yp-capacity"], queryFn: () => fetchCapacityRequests() });
  const partners = useQuery({ queryKey: ["yp-partners"], queryFn: fetchPartners });
  const matches = useQuery({
    queryKey: ["yp-match", selected],
    queryFn: () => matchDemand(selected as string),
    enabled: !!selected,
  });
  const quotes = useQuery({
    queryKey: ["yp-quotes", selected],
    queryFn: () => fetchQuotes({ requestId: selected as string }),
    enabled: !!selected,
  });

  const partnerLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of partners.data ?? []) map.set(p.id, partnerName(p));
    return map;
  }, [partners.data]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["yp-quotes", selected] });
    void qc.invalidateQueries({ queryKey: ["yp-match", selected] });
    void qc.invalidateQueries({ queryKey: ["yp-capacity"] });
  };

  const invite = useMutation({
    mutationFn: (partnerId: string) => requestQuote(selected as string, partnerId),
    onSuccess: () => { toast.success("Quote requested — the partner has been invited to price."); invalidate(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Quote request failed."),
  });

  const price_ = useMutation({
    mutationFn: (v: { quoteId: string; amount: number }) => submitQuote({ quoteId: v.quoteId, amount: v.amount }),
    onSuccess: () => { toast.success("Price recorded. Commission, net and margin were computed on the server."); invalidate(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Pricing failed."),
  });

  const decide = useMutation({
    mutationFn: (v: { quoteId: string; accept: boolean }) => decideQuote(v.quoteId, v.accept),
    onSuccess: (_d, v) => { toast.success(v.accept ? "Quote awarded." : "Quote rejected."); invalidate(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Decision failed."),
  });

  const requests = (demand.data ?? []).filter((r) => r.status !== "cancelled");
  const current = requests.find((r) => r.id === selected) ?? null;

  if (demand.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-9 w-1/3" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      <StaffPageHeader
        eyebrow="TaxiD Partners 360"
        title="Demand desk"
        lede="Match customer demand to verified partner supply, invite quotes and award work — with the server's reasoning shown in full."
      />

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Demand requests</CardTitle></CardHeader>
          <CardContent>
            {requests.length === 0 ? (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>No demand requests are recorded, so there is nothing to match yet.</p>
                <Button asChild size="sm" variant="outline"><Link to="/staff/partners/supply">Review supply coverage</Link></Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {requests.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(r.id)}
                      aria-current={selected === r.id}
                      className={`w-full py-3 text-left text-sm ${selected === r.id ? "text-primary" : ""}`}
                    >
                      <p className="font-medium">{r.origin_label}{r.destination_label ? ` → ${r.destination_label}` : ""}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{r.request_code}</span> · {SERVICE_TYPE_LABEL[r.service_type]}
                        {r.passengers ? ` · ${r.passengers} pax` : ""} · {r.status}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {!current ? (
            <Card><CardContent className="pt-6 text-sm text-muted-foreground">
              Select a demand request to see eligible partners, why each one ranked, and which requirement excluded the rest.
            </CardContent></Card>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Gauge className="h-4 w-4" aria-hidden /> Match explanation
                    <span className="font-mono text-xs text-muted-foreground">{current.request_code}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {matches.isLoading ? <Skeleton className="h-24 w-full" /> : matches.isError ? (
                    <p className="text-sm text-destructive">{(matches.error as Error).message}</p>
                  ) : (matches.data ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No partners are on the network yet.</p>
                  ) : (
                    (matches.data ?? []).map((m) => (
                      <div key={m.partner_id} className="rounded-lg border border-border/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <Link to={`/staff/partners/${m.partner_id}`} className="font-medium hover:underline">{m.partner_name}</Link>
                            <p className="text-xs text-muted-foreground">
                              <span className="font-mono">{m.partner_code}</span> · {m.matched_assets} matching asset(s) · capacity {m.capacity_available}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="tabular-nums">Score {Number(m.score).toFixed(0)}</Badge>
                            {m.eligible
                              ? <Badge variant="outline" className="border-success/40 text-success">Eligible</Badge>
                              : <Badge variant="outline" className="border-destructive/40 text-destructive">Excluded</Badge>}
                            <Button size="sm" disabled={!m.eligible || invite.isPending}
                              onClick={() => invite.mutate(m.partner_id)}>
                              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Request quote
                            </Button>
                          </div>
                        </div>
                        {m.reasons?.length ? (
                          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                            {m.reasons.map((r) => <li key={r}>• {r}</li>)}
                          </ul>
                        ) : null}
                        {m.exclusions?.length ? (
                          <ul className="mt-2 space-y-0.5 text-xs text-destructive">
                            {m.exclusions.map((r) => <li key={r}>✕ {r}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Quotes on this request</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {(quotes.data ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No quotes requested yet. Invite an eligible partner above.</p>
                  ) : (
                    (quotes.data ?? []).map((qt) => (
                      <div key={qt.id} className="rounded-lg border border-border/60 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-medium">{partnerLabel.get(qt.partner_id) ?? qt.partner_id}</p>
                            <p className="text-xs text-muted-foreground">
                              <span className="font-mono">{qt.quote_code}</span> · {qt.state}
                              {qt.response_minutes != null ? ` · answered in ${qt.response_minutes} min` : ""}
                              {qt.validity_until ? ` · valid to ${new Date(qt.validity_until).toLocaleString()}` : ""}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[10px] uppercase">{qt.state}</Badge>
                        </div>

                        {qt.quoted_amount != null ? (
                          <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-4">
                            <div><dt className="text-muted-foreground">Quoted</dt><dd className="tabular-nums">{kes(Number(qt.quoted_amount))}</dd></div>
                            <div><dt className="text-muted-foreground">Commission ({qt.commission_pct ?? 0}%)</dt><dd className="tabular-nums">{kes(Number(qt.commission_amount ?? 0))}</dd></div>
                            <div><dt className="text-muted-foreground">Partner net</dt><dd className="tabular-nums">{kes(Number(qt.partner_net ?? 0))}</dd></div>
                            <div><dt className="text-muted-foreground">TaxiD margin</dt><dd className="tabular-nums">{kes(Number(qt.yalla_margin ?? 0))}</dd></div>
                          </dl>
                        ) : null}

                        {["REQUESTED", "VIEWED", "DRAFT"].includes(qt.state) ? (
                          <div className="mt-3 flex flex-wrap items-end gap-2">
                            <div>
                              <Label htmlFor={`amt-${qt.id}`} className="text-xs">Record partner price (KES)</Label>
                              <Input id={`amt-${qt.id}`} inputMode="numeric" className="w-40"
                                value={price[qt.id] ?? ""}
                                onChange={(e) => setPrice((s) => ({ ...s, [qt.id]: e.target.value }))} />
                            </div>
                            <Button size="sm" disabled={price_.isPending || !Number(price[qt.id])}
                              onClick={() => price_.mutate({ quoteId: qt.id, amount: Number(price[qt.id]) })}>
                              Submit price
                            </Button>
                          </div>
                        ) : null}

                        {qt.state === "SUBMITTED" ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" disabled={decide.isPending}
                              onClick={() => decide.mutate({ quoteId: qt.id, accept: true })}>
                              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Award
                            </Button>
                            <Button size="sm" variant="outline" disabled={decide.isPending}
                              onClick={() => decide.mutate({ quoteId: qt.id, accept: false })}>
                              <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reject
                            </Button>
                            <p className="w-full text-xs text-muted-foreground">
                              Maker-checker: the person who recorded this price cannot award it.
                            </p>
                          </div>
                        ) : null}

                        {qt.decision_notes ? <p className="mt-2 text-xs text-muted-foreground">{qt.decision_notes}</p> : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
