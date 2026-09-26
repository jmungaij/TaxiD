/**
 * STAFF CONSOLE — live Fleet Owner application approvals.
 *
 * Decisions are executed by carrier_application_decide, which enforces the
 * staff permission, requires a reason to reject or request information, and on
 * approval provisions the partner account, the Fleet Owner record and its
 * document checklist. Nothing on this screen marks compliance verified.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listCarrierApplications, listCarrierApplicationEvents, decideCarrierApplication,
  type CarrierApplicationRow, type CarrierApplicationEventRow, type CarrierApplicationStatus,
} from "@/lib/logistics/carrier/applications";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw } from "lucide-react";

const tone = (s: string) =>
  s === "APPROVED"
    ? "bg-status-success/10 text-status-success border-status-success/30"
    : s === "REJECTED" || s === "WITHDRAWN"
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : "bg-status-warning/10 text-status-warning border-status-warning/30";

const OPEN: CarrierApplicationStatus[] = ["SUBMITTED", "UNDER_REVIEW", "INFO_REQUESTED"];

export default function CarrierApplications() {
  const [rows, setRows] = useState<CarrierApplicationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<CarrierApplicationEventRow[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const load = useCallback(async () => {
    try {
      const r = await listCarrierApplications();
      setRows(r);
      setSelectedId((prev) => prev ?? r.find((x) => OPEN.includes(x.status))?.id ?? r[0]?.id ?? null);
    } catch (e) {
      toast({ title: "Could not load applications", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Live view: new applications and decisions surface without a manual reload.
  useEffect(() => {
    const t = window.setInterval(() => { void load(); }, 20000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!selectedId) { setEvents([]); return; }
    listCarrierApplicationEvents(selectedId).then(setEvents).catch(() => setEvents([]));
  }, [selectedId, rows]);

  async function decide(action: "REVIEW" | "REQUEST_INFO" | "REJECT" | "APPROVE") {
    if (!selected) return;
    setBusy(action);
    const res = await decideCarrierApplication({ applicationId: selected.id, action, note: note.trim() || undefined });
    setBusy(null);
    if (res?.error) {
      return toast({
        title: "Refused",
        description: `${res.code ?? "ERROR"}${res.message ? ` — ${res.message}` : ""}`,
        variant: "destructive",
      });
    }
    toast({
      title: action === "APPROVE" ? "Approved — Fleet Owner record created" : `Recorded: ${res.status}`,
      description: action === "APPROVE" ? "Their document checklist is ready." : undefined,
    });
    setNote("");
    await load();
  }

  if (loading) return <main className="p-8"><Loader2 className="h-5 w-5 animate-spin" aria-hidden /></main>;

  const open = rows.filter((r) => OPEN.includes(r.status));

  return (
    <main className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fleet Owner applications</h1>
          <p className="text-sm text-muted-foreground">
            {open.length} open of {rows.length}. Approving creates the partner account, the Fleet Owner record and
            their document checklist — verification still happens in compliance.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/admin/fleet-owner-compliance">Compliance & activation</Link>
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-lg">Application register</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Fleet</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">
                  No applications yet. Share the apply link with fleet owners: /partner/fleet-owner/apply
                </TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id} data-active={r.id === selectedId}>
                  <TableCell>
                    <button className="text-left font-medium hover:underline" onClick={() => setSelectedId(r.id)}>
                      {r.legal_entity_name}
                    </button>
                    <div className="text-xs text-muted-foreground">{r.county ?? "—"}{r.town ? ` · ${r.town}` : ""}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.application_reference}</TableCell>
                  <TableCell className="text-xs">
                    {r.contact_name}<br />
                    <span className="text-muted-foreground">{r.contact_email} · {r.contact_phone}</span>
                  </TableCell>
                  <TableCell className="text-right text-xs">{r.fleet_size ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={tone(r.status)}>{r.status.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{selected.legal_entity_name}</CardTitle>
            <CardDescription>
              {selected.application_reference} · {selected.status.replace(/_/g, " ")}
              {selected.trading_name ? ` · trading as ${selected.trading_name}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="grid gap-4 text-sm md:grid-cols-3">
              {[
                ["Registration no.", selected.registration_number],
                ["KRA PIN", selected.tax_identifier],
                ["Contact", `${selected.contact_name}${selected.contact_position ? ` (${selected.contact_position})` : ""}`],
                ["Email", selected.contact_email],
                ["Phone", selected.contact_phone],
                ["Location", [selected.town, selected.county, selected.country].filter(Boolean).join(", ")],
                ["Vehicle types", selected.vehicle_types.join(", ")],
                ["Services", selected.service_categories.join(", ")],
                ["Fleet size", selected.fleet_size?.toString()],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v || "—"}</dd>
                </div>
              ))}
            </dl>

            {selected.notes && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="text-xs text-muted-foreground">From the applicant</p>
                <p className="mt-1 whitespace-pre-wrap">{selected.notes}</p>
              </div>
            )}

            {selected.status === "APPROVED" ? (
              <div className="rounded-lg border p-4 text-sm">
                <p className="font-medium">Approved</p>
                <p className="text-muted-foreground">
                  Fleet Owner record created. Verify their documents, agreement and payout account before activation.
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link to="/dashboard/admin/fleet-owner-compliance">Open compliance</Link>
                </Button>
              </div>
            ) : selected.status === "REJECTED" || selected.status === "WITHDRAWN" ? (
              <p className="text-sm text-muted-foreground">
                Closed {selected.decided_at ? new Date(selected.decided_at).toLocaleString() : ""}.
                {selected.review_notes ? ` Reason: ${selected.review_notes}` : ""}
              </p>
            ) : (
              <div className="space-y-3">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Reviewer note — required to request information or reject"
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide("REVIEW")}>
                    {busy === "REVIEW" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                    Move to review
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide("REQUEST_INFO")}>
                    {busy === "REQUEST_INFO" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                    Request information
                  </Button>
                  <Button size="sm" disabled={busy !== null} onClick={() => void decide("APPROVE")}>
                    {busy === "APPROVE" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                    Approve & create Fleet Owner
                  </Button>
                  <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => void decide("REJECT")}>
                    {busy === "REJECT" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                    Reject
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="text-sm font-medium">Decision trail</p>
              <ul className="mt-2 space-y-2 text-xs">
                {events.length === 0 && <li className="text-muted-foreground">No entries.</li>}
                {events.map((e) => (
                  <li key={e.id} className="rounded-md border p-2">
                    <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
                    {e.status_from && e.status_to ? ` · ${e.status_from} → ${e.status_to}` : ""}
                    <span className="text-muted-foreground"> · {new Date(e.created_at).toLocaleString()}</span>
                    {e.note && <div className="mt-1 text-muted-foreground">{e.note}</div>}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
