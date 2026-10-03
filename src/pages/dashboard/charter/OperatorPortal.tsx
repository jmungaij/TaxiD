/**
 * Operator & driver portal.
 *
 * The crew-facing console for assigned charter bookings: today's runs, the
 * passenger manifest with assigned seats, ticket verification status and the
 * payment reconciliation state. Every mutation goes through the existing
 * `charter-api` edge function so RBAC and the audit trail stay intact.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Loader2, RefreshCw, Search, Ticket, Users, Wallet } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { charterApi, type CharterBookingRow } from "@/lib/charter/api";
import { statusLabel } from "@/lib/charter/transitions";
import { LiveTripTracker } from "@/components/charter/LiveTripTracker";
import { charterAccess } from "@/lib/charter/access";
import { useAuth } from "@/hooks/useAuth";
import { domainLexicon } from "@/lib/charter/assetDomains";
import { downloadManifestCsv, downloadManifestPdf } from "@/lib/charter/manifestExport";
import { listOperatorAudit, recordOperatorAction, type OperatorAuditEntry } from "@/lib/charter/operatorAudit";
import { sendCharterLifecycleEmail } from "@/lib/charter/charterNotifications";
import { Download, FileText, History, Mail } from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";

const money = (n: number, ccy = "KES") =>
  `${ccy === "KES" ? "KSh" : ccy} ${new Intl.NumberFormat("en-KE").format(Math.round(n || 0))}`;

export default function OperatorPortal() {
  const [rows, setRows] = useState<CharterBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [auditRows, setAuditRows] = useState<OperatorAuditEntry[]>([]);
  const { roles } = useAuth();
  const access = charterAccess(roles);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const bookings = await charterApi.listBookings();
      setRows(bookings);
      setActiveId((prev) => prev ?? bookings[0]?.id ?? null);
    } catch (e) {
      toast({
        title: "Could not load assigned bookings",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!activeId) return;
    void listOperatorAudit(activeId).then(setAuditRows);
  }, [activeId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      `${r.reference} ${r.asset_name} ${r.category_slug} ${r.flight_status}`.toLowerCase().includes(needle),
    );
  }, [q, rows]);

  const active = filtered.find((r) => r.id === activeId) ?? filtered[0] ?? null;
  const trip = (active?.trip ?? {}) as Record<string, string>;
  const seats = Array.isArray((active?.trip as Record<string, unknown>)?.seats)
    ? ((active?.trip as Record<string, unknown>).seats as string[])
    : [];

  const advance = async (status: string) => {
    if (!active || !access.canManageFlightStatus) return;
    setBusy(status);
    try {
      const updated = await charterApi.recordFlightEvent({ booking_id: active.id, status });
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      void recordOperatorAction(
        "charter_operator_status_advanced",
        active.id,
        { flight_status: active.flight_status },
        { flight_status: status, reference: active.reference },
      );
      toast({ title: "Status updated", description: `${active.reference} · ${statusLabel(status)}` });
    } catch (e) {
      toast({
        title: "Update rejected",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const reconcile = async () => {
    if (!active) return;
    setBusy("reconcile");
    try {
      const res = await charterApi.paymentStatus({ booking_id: active.id });
      setRows((prev) => prev.map((r) => (r.id === res.booking.id ? res.booking : r)));
      void recordOperatorAction(
        "charter_operator_reconciliation_refreshed",
        active.id,
        { payment_status: active.payment_status },
        { payment_status: res.booking.payment_status, events: res.events.length },
      );
      if (active.payment_status !== "paid" && res.booking.payment_status === "paid") {
        const sent = await sendCharterLifecycleEmail(res.booking, "payment_confirmed");
        if (sent) {
          void recordOperatorAction("charter_operator_notification_sent", active.id, {}, { event: "payment_confirmed" });
        }
      }
      toast({
        title: "Reconciliation refreshed",
        description: `${res.booking.payment_status} · ${res.events.length} callback event(s) on ledger.`,
      });
    } catch (e) {
      toast({
        title: "Could not reconcile",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const exportManifest = async (kind: "csv" | "pdf") => {
    if (!active) return;
    if (kind === "csv") downloadManifestCsv(active);
    else downloadManifestPdf(active);
    await recordOperatorAction(
      "charter_operator_manifest_exported",
      active.id,
      {},
      { format: kind, passengers: active.passengers?.length ?? 0, reference: active.reference },
    );
    toast({ title: "Manifest exported", description: `${active.reference} · ${kind.toUpperCase()}` });
    setAuditRows(await listOperatorAudit(active.id));
  };

  const notifyCustomer = async (event: "ticket_issued" | "documents_ready") => {
    if (!active) return;
    setBusy(event);
    const ok = await sendCharterLifecycleEmail(active, event);
    if (ok) {
      await recordOperatorAction("charter_operator_notification_sent", active.id, {}, { event });
      setAuditRows(await listOperatorAudit(active.id));
    }
    toast({
      title: ok ? "Customer notified" : "No contact email on file",
      description: ok ? `${active.reference} · ${event.replace("_", " ")}` : "Add a contact email to the manifest first.",
      variant: ok ? "default" : "destructive",
    });
    setBusy(null);
  };

  return (
    <div className="container mx-auto space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Operator &amp; driver portal</h1>
          {!access.isOperator && (
            <p className="text-xs text-destructive">Read-only: your role cannot change trip status.</p>
          )}
          <p className="text-sm text-muted-foreground">
            Assigned runs, passenger manifests, ticket verification and payment reconciliation.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Assigned bookings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search reference or vehicle"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search assigned bookings"
              />
            </div>
            <ul className="max-h-[520px] space-y-2 overflow-auto">
              {filtered.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(r.id)}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      active?.id === r.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-foreground">{r.reference}</span>
                      <Badge variant="outline" className="text-[10px]">{statusLabel(r.flight_status)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{r.asset_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {money(r.amount, r.currency)} · {r.payment_status}
                    </p>
                  </button>
                </li>
              ))}
              {!loading && filtered.length === 0 && (
                <li className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
                  No bookings are assigned to you yet.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {active ? (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      {active.asset_name} · <span className="font-mono">{active.reference}</span>
                    </CardTitle>
                    <Badge variant="outline">{statusLabel(active.flight_status)}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {trip.origin || "—"} → {trip.destination || "—"}
                    {trip.date ? ` · ${trip.date}` : ""}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {["departed", "landed", "completed"].map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant="outline"
                        disabled={busy === s || !access.canManageFlightStatus}
                        onClick={() => void advance(s)}
                      >
                        {busy === s ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                        Mark {statusLabel(s)}
                      </Button>
                    ))}
                  </div>

                  <Separator />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Users className="h-4 w-4" /> {domainLexicon(active.category_slug).manifestLabel} (
                        {active.passengers?.length ?? 0})
                      </p>
                      <div className="mb-2 flex flex-wrap gap-2">
                        <AppButton analytics="charter_operator_manifest_csv_download" action="submit" size="sm" variant="outline" aria-label="Download charter manifest as CSV" onClick={() => void exportManifest("csv")}>
                          <Download className="mr-2 h-3.5 w-3.5" /> CSV
                        </AppButton>
                        <AppButton analytics="charter_operator_manifest_pdf_download" action="submit" size="sm" variant="outline" aria-label="Download charter manifest as PDF" onClick={() => void exportManifest("pdf")}>
                          <FileText className="mr-2 h-3.5 w-3.5" /> PDF
                        </AppButton>
                      </div>
                      <ul className="space-y-1.5">
                        {(active.passengers ?? []).map((p, i) => (
                          <li key={`${p.name ?? i}`} className="rounded-md border border-border/60 p-2 text-xs">
                            <span className="font-medium text-foreground">{p.name ?? `Passenger ${i + 1}`}</span>
                            <span className="block text-muted-foreground">
                              Seat {seats[i] ?? p.seat ?? "unassigned"}
                              {p.phone ? ` · ${p.phone}` : ""}
                              {p.document_number ? ` · ID ${p.document_number}` : ""}
                            </span>
                          </li>
                        ))}
                        {(active.passengers ?? []).length === 0 && (
                          <li className="text-xs text-muted-foreground">Manifest not yet submitted.</li>
                        )}
                      </ul>
                    </div>

                    <div className="space-y-3">
                      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Ticket className="h-4 w-4" /> Ticket verification
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Scan boarding QR codes in the offline inspector at <code>/inspect</code>; verdicts sync back to
                        this booking automatically.
                      </p>
                      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Wallet className="h-4 w-4" /> Payment reconciliation
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {active.payment_method} · {active.payment_status} · {money(active.amount, active.currency)}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={busy === "ticket_issued"} onClick={() => void notifyCustomer("ticket_issued")}>
                          <Mail className="mr-2 h-3.5 w-3.5" /> Notify: ticket issued
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy === "documents_ready"} onClick={() => void notifyCustomer("documents_ready")}>
                          <Mail className="mr-2 h-3.5 w-3.5" /> Notify: documents ready
                        </Button>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => void reconcile()} disabled={busy === "reconcile"}>
                        {busy === "reconcile" ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                        )}
                        Refresh reconciliation
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <History className="h-4 w-4" /> Operator audit log
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {auditRows.map((a) => (
                      <li key={a.id} className="rounded-md border border-border/60 p-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-foreground">{a.action.replace(/_/g, " ")}</span>
                          <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                        </div>
                        <p className="mt-1 break-all text-muted-foreground">
                          actor {a.actor_user_id ?? "—"} · {JSON.stringify(a.after_data ?? {})}
                        </p>
                      </li>
                    ))}
                    {auditRows.length === 0 && (
                      <li className="text-xs text-muted-foreground">No operator actions recorded for this booking.</li>
                    )}
                  </ul>
                </CardContent>
              </Card>

              <LiveTripTracker
                reference={active.reference}
                origin={trip.origin}
                destination={trip.destination}
                status={active.flight_status}
                events={active.flight_events ?? []}
              />
            </>
          ) : (
            <Card>
              <CardContent className="p-8 text-sm text-muted-foreground">
                {loading ? "Loading assigned bookings…" : "Select a booking to view its manifest."}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
