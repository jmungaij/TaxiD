/**
 * DRIVER APPLICATIONS — live staff approval console.
 *
 * Every verdict is executed by the database: document verification is per item,
 * and `driver_application_decide` refuses APPROVE while any mandatory document
 * is unverified. This screen only presents the state and the actions.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck, ShieldAlert, FileText } from "lucide-react";
import {
  listDriverApplications, listDriverApplicationDocuments, listDriverApplicationEvents,
  decideDriverApplication, reviewDriverDocument, driverDocumentUrl,
  type DriverApplicationRow, type DriverApplicationDocumentRow, type DriverApplicationEventRow,
} from "@/lib/drivers/applications";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";

const statusTone: Record<string, string> = {
  SUBMITTED: "bg-status-info/10 text-status-info border-status-info/30",
  UNDER_REVIEW: "bg-status-warning/10 text-status-warning border-status-warning/30",
  INFO_REQUESTED: "bg-status-warning/10 text-status-warning border-status-warning/30",
  APPROVED: "bg-status-success/10 text-status-success border-status-success/30",
  REJECTED: "bg-destructive/10 text-destructive border-destructive/30",
  WITHDRAWN: "bg-muted text-muted-foreground",
};

const docTone: Record<string, string> = {
  VERIFIED: "bg-status-success/10 text-status-success border-status-success/30",
  PENDING_REVIEW: "bg-status-warning/10 text-status-warning border-status-warning/30",
  MISSING: "bg-muted text-muted-foreground",
  REJECTED: "bg-destructive/10 text-destructive border-destructive/30",
  EXPIRED: "bg-destructive/10 text-destructive border-destructive/30",
};

export default function DriverApplications() {
  const [rows, setRows] = useState<DriverApplicationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DriverApplicationDocumentRow[]>([]);
  const [events, setEvents] = useState<DriverApplicationEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const load = useCallback(async () => {
    try {
      const list = await listDriverApplications();
      setRows(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch (e) {
      toast({ title: "Could not load applications", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { void load(); }, 20000);
    return () => clearInterval(t);
  }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    const [d, e] = await Promise.all([listDriverApplicationDocuments(id), listDriverApplicationEvents(id)]);
    setDocuments(d); setEvents(e);
  }, []);

  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId, loadDetail]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.application_reference, r.first_name, r.last_name, r.contact_email, r.contact_phone, r.national_id, r.status]
        .join(" ").toLowerCase().includes(q));
  }, [rows, query]);

  const mandatoryOutstanding = documents.filter((d) => d.is_mandatory && d.state !== "VERIFIED");

  async function onDecide(action: "REVIEW" | "REQUEST_INFO" | "APPROVE" | "REJECT") {
    if (!selected) return;
    setBusy(action);
    const res = await decideDriverApplication({ applicationId: selected.id, action, note: note.trim() || undefined });
    setBusy(null);
    if (res?.error) {
      return toast({
        title: "Decision not recorded",
        description: (res.code ?? res.message ?? "").replace(/_/g, " ").toLowerCase(),
        variant: "destructive",
      });
    }
    toast({ title: `Recorded: ${action.replace(/_/g, " ").toLowerCase()}` });
    setNote("");
    await Promise.all([load(), loadDetail(selected.id)]);
  }

  async function onReviewDoc(doc: DriverApplicationDocumentRow, decision: "VERIFY" | "REJECT", notes?: string) {
    setBusy(doc.id);
    const res = await reviewDriverDocument({ documentId: doc.id, decision, notes });
    setBusy(null);
    if (res?.error) {
      return toast({
        title: "Document not updated",
        description: (res.code ?? res.message ?? "").replace(/_/g, " ").toLowerCase(),
        variant: "destructive",
      });
    }
    toast({ title: decision === "VERIFY" ? "Document verified" : "Document rejected", description: doc.doc_label });
    if (selectedId) await loadDetail(selectedId);
  }

  async function openDoc(path: string) {
    const url = await driverDocumentUrl(path);
    if (!url) return toast({ title: "Could not open the file", variant: "destructive" });
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Driver applications</h1>
          <p className="text-sm text-muted-foreground">
            Verify each document, then approve. Approval creates the driver record.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, reference, ID" className="w-56" />
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Queue</CardTitle>
            <CardDescription>{filtered.length} application{filtered.length === 1 ? "" : "s"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!loading && filtered.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
            {filtered.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={`w-full rounded-md border p-3 text-left text-sm transition ${r.id === selectedId ? "border-primary bg-accent/40" : "hover:bg-accent/20"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{r.first_name} {r.last_name}</span>
                  <Badge variant="outline" className={statusTone[r.status]}>{r.status.replace(/_/g, " ")}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.application_reference} · {r.county ?? "—"} · {new Date(r.created_at).toLocaleDateString()}
                </p>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {!selected && <Card><CardContent className="py-10 text-sm text-muted-foreground">Select an application.</CardContent></Card>}

          {selected && (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg">{selected.first_name} {selected.middle_name ?? ""} {selected.last_name}</CardTitle>
                      <CardDescription>{selected.application_reference}</CardDescription>
                    </div>
                    <Badge variant="outline" className={statusTone[selected.status]}>{selected.status.replace(/_/g, " ")}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                  {([
                    ["Email", selected.contact_email],
                    ["Phone", selected.contact_phone],
                    ["National ID", selected.national_id],
                    ["KRA PIN", selected.kra_pin ?? "—"],
                    ["Licence", `${selected.licence_number} (${(selected.licence_classes ?? []).join(", ") || "no class given"})`],
                    ["Licence expiry", selected.licence_expiry ?? "—"],
                    ["PSV badge", selected.psv_badge_number ?? "—"],
                    ["Experience", selected.years_experience != null ? `${selected.years_experience} years` : "—"],
                    ["Vehicle", selected.vehicle_ownership === "OWNER"
                      ? `${selected.vehicle_registration ?? "—"} · ${selected.vehicle_make_model ?? "—"}`
                      : selected.vehicle_ownership.replace(/_/g, " ").toLowerCase()],
                    ["Location", [selected.town, selected.county, selected.country].filter(Boolean).join(", ")],
                    ["Wants", (selected.service_categories ?? []).map((s) => s.replace(/_/g, " ").toLowerCase()).join(", ") || "—"],
                    ["Preferred city", selected.preferred_city ?? "—"],
                  ] as const).map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{k}</p>
                      <p>{v || "—"}</p>
                    </div>
                  ))}
                  {selected.notes && (
                    <div className="md:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Applicant note</p>
                      <p className="whitespace-pre-wrap">{selected.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Document checklist</CardTitle>
                  <CardDescription>
                    {mandatoryOutstanding.length === 0
                      ? "All mandatory documents are verified — approval is possible."
                      : `${mandatoryOutstanding.length} mandatory document(s) still unverified — approval will be refused.`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {documents.map((d) => (
                    <div key={d.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{d.doc_label}{d.is_mandatory ? " *" : ""}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.document_number ? `No. ${d.document_number} · ` : ""}
                            {d.issued_on ? `issued ${d.issued_on} · ` : ""}
                            {d.expires_on ? `expires ${d.expires_on}` : "no expiry given"}
                          </p>
                          {d.review_notes && <p className="text-xs text-muted-foreground">Note: {d.review_notes}</p>}
                        </div>
                        <Badge variant="outline" className={docTone[d.state]}>{d.state.replace(/_/g, " ")}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {d.storage_path && (
                          <Button size="sm" variant="outline" onClick={() => void openDoc(d.storage_path!)}>
                            <FileText className="mr-2 h-4 w-4" aria-hidden /> Open file
                          </Button>
                        )}
                        {d.storage_path && d.state !== "VERIFIED" && (
                          <Button size="sm" disabled={busy === d.id} onClick={() => void onReviewDoc(d, "VERIFY")}>
                            {busy === d.id
                              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                              : <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />}
                            Verify
                          </Button>
                        )}
                        {d.storage_path && (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy === d.id}
                            onClick={() => {
                              const reason = window.prompt(`Why is ${d.doc_label} rejected?`)?.trim();
                              if (!reason) return;
                              void onReviewDoc(d, "REJECT", reason);
                            }}
                          >
                            <ShieldAlert className="mr-2 h-4 w-4" aria-hidden /> Reject
                          </Button>
                        )}
                        {!d.storage_path && <span className="text-xs text-muted-foreground">Waiting for the applicant to upload.</span>}
                      </div>
                    </div>
                  ))}
                  {documents.length === 0 && <p className="text-sm text-muted-foreground">No checklist rows.</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Decision</CardTitle>
                  <CardDescription>Your note is shown to the applicant on their status page.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Reviewer note (required to ask for more information or to reject)" />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void onDecide("REVIEW")}>Start review</Button>
                    <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void onDecide("REQUEST_INFO")}>Request information</Button>
                    <Button size="sm" disabled={busy !== null} onClick={() => void onDecide("APPROVE")}>
                      {busy === "APPROVE" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                      Approve and create driver
                    </Button>
                    <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => void onDecide("REJECT")}>Reject</Button>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Decision trail</p>
                    {events.length === 0 && <p className="text-sm text-muted-foreground">No entries.</p>}
                    {events.map((e) => (
                      <div key={e.id} className="rounded-md border p-2 text-xs">
                        <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
                        {e.status_from && e.status_to && <span> · {e.status_from} → {e.status_to}</span>}
                        <span className="text-muted-foreground"> · {new Date(e.created_at).toLocaleString()}</span>
                        {e.note && <p className="mt-1 text-muted-foreground">{e.note}</p>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
