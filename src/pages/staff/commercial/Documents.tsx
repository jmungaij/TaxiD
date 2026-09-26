/**
 * Commercial Document Console — /staff/commercial/documents
 *
 * One screen to steer the governed document chain of any transaction
 * (quotation → proforma → tax invoice → receipt), with the hard gates,
 * separation of duties, PDF sealing and dispatch audit trail visible:
 *
 *   - Every action calls the database state machine; the UI never decides.
 *   - Four-eyes: the creator of a document sees no action buttons for it.
 *   - Issuance auto-seals the rendered PDF (write-once SHA-256) and records
 *     the dispatch when a document is sent.
 *   - "Export audit packet" downloads the full forensic chain as one
 *     tamper-evident JSON bundle (manifest SHA-256 included).
 */
import { useCallback, useState, type ReactNode } from "react";
import {
  ArrowRight, FileText, Hash, Loader2, Mail, PackageSearch, ScrollText, ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { AppButton } from "@/components/nav/AppButton";
import { toneClasses } from "@/lib/design/statusTone";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  DOCUMENT_TYPE_LABEL,
  DISPATCH_STATUS_LABEL,
  dispatchMessageId,
  dispatchStatusTone,
  evaluateSeparationOfDuties,
  nextStatuses,
  statusTone,
  type CommercialDocumentStatus,
  type CommercialDocumentType,
  type DocumentDispatchStatus,
} from "@/lib/commercial/documents";
import {
  buildCommercialDocumentPdf,
  commercialDocumentPdfFilename,
  sha256Hex,
} from "@/lib/commercial/documentPdf";
import {
  buildAssurancePacket,
  downloadAssurancePacket,
  finalizeAssurancePacket,
} from "@/lib/commercial/assurancePacket";

interface CommercialDocument {
  id: string;
  document_number: string;
  document_type: CommercialDocumentType;
  transaction_id: string;
  transaction_ref: string;
  version: number;
  status: CommercialDocumentStatus;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  etims_invoice_id: string | null;
  document_hash: string | null;
  source_ref: string | null;
  recipient_email: string | null;
  created_by: string | null;
  approved_by: string | null;
  issued_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

interface DocumentEvent {
  id: string;
  event_type: string;
  actor_type: string;
  prev_status: string | null;
  new_status: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface DispatchRow {
  id: string;
  document_id: string;
  message_id: string;
  recipient_email: string;
  subject: string;
  template_key: string;
  template_version: string;
  pdf_sha256: string | null;
  status: DocumentDispatchStatus;
  attempt_count: number;
  last_attempt_at: string | null;
  error_message: string | null;
  provider: string;
  created_at: string;
}

interface TraceResult {
  found: boolean;
  transaction?: {
    id: string;
    transaction_ref: string;
    service_line: string;
    status: string;
    payment_status: string | null;
    etims_status: string | null;
    total_cents: number | null;
    currency: string | null;
  } | null;
  documents?: CommercialDocument[];
  events?: DocumentEvent[];
  dispatches?: DispatchRow[];
}

const money = (cents: number, currency: string) =>
  `${currency} ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;

const TERMINAL: readonly CommercialDocumentStatus[] = ["voided", "superseded", "cancelled", "expired"];

/** StatusTone-aware badge (tones are not native Badge variants). */
function ToneBadge({ tone, title, children }: { tone: string; title?: string; children: ReactNode }) {
  const t = toneClasses(tone);
  return (
    <Badge variant="outline" title={title} className={cn("border-0 ring-1 ring-inset", t.bg, t.text, t.ring)}>
      {children}
    </Badge>
  );
}

export default function CommercialDocuments() {
  const { user } = useAuth();
  const [ref, setRef] = useState("");
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const runTrace = useCallback(async (value: string) => {
    setLoading(true);
    const { data, error } = await supabase.rpc("commercial_document_trace", { p_ref: value.trim() });
    setLoading(false);
    if (error) {
      toast({ title: "Trace failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as unknown as TraceResult;
    setTrace(result);
    if (!result.found) {
      toast({ title: "Not found", description: `No commercial transaction matches "${value}".` });
    }
  }, []);

  const callRpc = async <T,>(fn: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(fn as never, args as never);
    return { data: data as T | null, error: error?.message ?? null };
  };

  const downloadBlob = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Render → hash → persist the write-once seal; optionally hand over the bytes. */
  const sealDocument = useCallback(async (
    doc: CommercialDocument,
    opts: { download?: boolean } = {},
  ): Promise<{ hash: string; idempotent: boolean }> => {
    const bytes = await buildCommercialDocumentPdf(doc);
    const hash = await sha256Hex(bytes);
    const { data, error } = await callRpc<{ idempotent: boolean }>("commercial_document_attach_hash", {
      p_document_id: doc.id,
      p_sha256: hash,
      p_byte_size: bytes.byteLength,
      p_storage_ref: null,
    });
    if (error) throw new Error(error);
    if (opts.download) {
      downloadBlob(commercialDocumentPdfFilename(doc), new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }));
    }
    return { hash, idempotent: data?.idempotent ?? false };
  }, []);  

  const generate = async (type: CommercialDocumentType) => {
    if (!trace?.transaction) return;
    setBusy(`gen-${type}`);
    const { data, error } = await callRpc<{
      blocked?: string; idempotent?: boolean; document?: CommercialDocument;
    }>("commercial_document_generate", {
      p_transaction_id: trace.transaction.id,
      p_document_type: type,
      p_recipient_email: null,
      p_source_document_id: null,
      p_idempotency_key: `${trace.transaction.id}:${type}:v1`,
    });
    setBusy(null);

    if (error) {
      toast({ title: "Issuance refused", description: error, variant: "destructive" });
    } else if (data?.blocked) {
      toast({ title: "Hard gate", description: data.blocked, variant: "destructive" });
    } else if (data?.document) {
      toast({
        title: data.idempotent ? "Already issued" : `${DOCUMENT_TYPE_LABEL[type]} issued`,
        description: data.document.document_number,
      });
      // Wire the PDF seal into every issuance step: the artifact is rendered,
      // hashed and persisted immediately; fresh issuances are also downloaded.
      try {
        const seal = await sealDocument(data.document, { download: !data.idempotent });
        if (!seal.idempotent) {
          toast({ title: "PDF sealed", description: `sha256 ${seal.hash.slice(0, 20)}…` });
        }
      } catch (e) {
        toast({
          title: "Issued, but the PDF seal failed",
          description: e instanceof Error ? e.message : "Seal retry available on the document row.",
          variant: "destructive",
        });
      }
    }
    void runTrace(trace.transaction.transaction_ref);
  };

  const transition = async (doc: CommercialDocument, to: CommercialDocumentStatus) => {
    setBusy(doc.id);
    const { error } = await callRpc("commercial_document_transition", {
      p_document_id: doc.id,
      p_to_status: to,
      p_reason: null,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Transition refused", description: error, variant: "destructive" });
    } else {
      toast({ title: "Transition applied", description: `${doc.document_number} → ${to}` });
      // A 'sent' transition is the email leg: record it in the dispatch audit
      // trail (idempotent per document version) when a recipient is known.
      if (to === "sent") {
        if (doc.recipient_email) {
          const { error: dErr } = await callRpc("commercial_document_dispatch_record", {
            p_document_id: doc.id,
            p_message_id: dispatchMessageId(doc.id, doc.version, "sent"),
            p_recipient_email: doc.recipient_email,
            p_subject: `${DOCUMENT_TYPE_LABEL[doc.document_type]} ${doc.document_number}`,
            p_template_key: `commercial-${doc.document_type}`,
            p_template_version: "1.0",
            p_pdf_sha256: doc.document_hash,
            p_status: "sent",
          });
          if (dErr) {
            toast({ title: "Dispatch audit failed", description: dErr, variant: "destructive" });
          }
        } else {
          toast({ title: "Dispatch not audited", description: "No recipient email on the document — the send leg was not logged." });
        }
      }
    }
    if (trace?.transaction) void runTrace(trace.transaction.transaction_ref);
  };

  const sealFromRow = async (doc: CommercialDocument) => {
    setBusy(`seal-${doc.id}`);
    try {
      const seal = await sealDocument(doc, { download: true });
      toast({
        title: seal.idempotent ? "Already sealed" : "PDF sealed",
        description: `sha256 ${seal.hash.slice(0, 20)}…`,
      });
    } catch (e) {
      toast({
        title: "Seal refused",
        description: e instanceof Error ? e.message : "Sealing failed",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
    if (trace?.transaction) void runTrace(trace.transaction.transaction_ref);
  };

  const exportPacket = async () => {
    if (!trace?.transaction) return;
    setBusy("packet");
    try {
      const packet = await finalizeAssurancePacket(buildAssurancePacket(trace));
      downloadAssurancePacket(packet);
      toast({
        title: "Audit packet exported",
        description: `manifest sha256 ${packet.manifest_sha256?.slice(0, 20)}…`,
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Could not build the audit packet",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const txn = trace?.transaction ?? null;
  const docs = trace?.documents ?? [];
  const events = trace?.events ?? [];
  const dispatches = trace?.dispatches ?? [];
  const docById = new Map(docs.map((d) => [d.id, d]));

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Commercial documents</h1>
          <p className="text-sm text-muted-foreground">
            Quotation → proforma → tax invoice → receipt — every step state-machined, four-eyes
            controlled, PDF-sealed and forensically traced.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AppButton
            analytics="staff.commercial.documents.open_security_centre"
            action="navigate"
            target="/staff/documents/security"
            variant="outline"
            size="sm"
          >
            <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
            Document Security Centre
          </AppButton>
          <AppButton
            analytics="staff.commercial.documents.open_company_collateral"
            action="navigate"
            target="/staff/documents/collateral"
            variant="outline"
            size="sm"
          >
            <ScrollText className="mr-2 h-4 w-4" aria-hidden="true" />
            Company collateral
          </AppButton>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4" /> Trace a transaction
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (ref.trim()) void runTrace(ref);
            }}
          >
            <Input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="Transaction reference (e.g. YTX-2026-…) or UUID"
              className="max-w-md"
              aria-label="Transaction reference"
            />
            <Button type="submit" disabled={loading || !ref.trim()}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Trace
            </Button>
            {trace?.found ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy === "packet"}
                data-analytics="staff.commercial.documents.export_audit_packet"
                onClick={() => void exportPacket()}
              >
                {busy === "packet" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Export audit packet
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <AsyncState loading={loading} error={null} isEmpty={false} emptyTitle="">
        {txn ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <PackageSearch className="h-4 w-4" /> {txn.transaction_ref}
                  <Badge variant="outline">{txn.service_line}</Badge>
                  <Badge variant="secondary">{txn.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span>Total: {txn.total_cents != null ? money(txn.total_cents, txn.currency ?? "KES") : "—"}</span>
                  <span>Payment: {txn.payment_status ?? "—"}</span>
                  <span>eTIMS: {txn.etims_status ?? "—"}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["proforma", "tax_invoice", "payment_receipt"] as const).map((t) => (
                    <Button
                      key={t}
                      size="sm"
                      variant="secondary"
                      disabled={busy === `gen-${t}`}
                      onClick={() => void generate(t)}
                    >
                      {busy === `gen-${t}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                      {DOCUMENT_TYPE_LABEL[t]}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base">Document chain</CardTitle></CardHeader>
                <CardContent>
                  {docs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No documents yet — issue the first artifact above.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Document</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead>PDF seal</TableHead>
                          <TableHead>Next states</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {docs.map((d) => {
                          const sod = evaluateSeparationOfDuties(d.created_by, user?.id);
                          return (
                            <TableRow key={d.id}>
                              <TableCell className="font-medium">
                                {d.document_number}
                                <span className="ml-1 text-xs text-muted-foreground">v{d.version}</span>
                              </TableCell>
                              <TableCell>
                                <ToneBadge tone={statusTone(d.status)}>{d.status}</ToneBadge>
                              </TableCell>
                              <TableCell className="text-right">{money(d.total_cents, d.currency)}</TableCell>
                              <TableCell>
                                {d.document_hash ? (
                                  <ToneBadge tone="success" title={d.document_hash}>
                                    <Hash className="mr-1 h-3 w-3" />
                                    {d.document_hash.slice(0, 10)}…
                                  </ToneBadge>
                                ) : TERMINAL.includes(d.status) ? (
                                  <span className="text-xs text-muted-foreground">—</span>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy === `seal-${d.id}`}
                                    onClick={() => void sealFromRow(d)}
                                  >
                                    {busy === `seal-${d.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                                    Seal PDF
                                  </Button>
                                )}
                              </TableCell>
                              <TableCell>
                                {!sod.allowed ? (
                                  <span className="text-xs text-muted-foreground" title={sod.reason ?? undefined}>
                                    Four-eyes: second officer required
                                  </span>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {nextStatuses(d.document_type, d.status).map((to) => (
                                      <Button
                                        key={to}
                                        size="sm"
                                        variant="outline"
                                        disabled={busy === d.id}
                                        onClick={() => void transition(d, to)}
                                      >
                                        {to} <ArrowRight className="ml-1 h-3 w-3" />
                                      </Button>
                                    ))}
                                    {nextStatuses(d.document_type, d.status).length === 0 ? (
                                      <span className="text-xs text-muted-foreground">terminal</span>
                                    ) : null}
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Event stream (immutable)</CardTitle></CardHeader>
                <CardContent>
                  {events.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No events recorded.</p>
                  ) : (
                    <ol className="space-y-2 text-sm">
                      {events.map((ev) => (
                        <li key={ev.id} className="rounded-md border border-border p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{ev.event_type}</span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(ev.created_at).toLocaleString()}
                            </span>
                          </div>
                          {(ev.prev_status || ev.new_status) && (
                            <div className="text-xs text-muted-foreground">
                              {ev.prev_status ?? "∅"} → {ev.new_status ?? "∅"} · {ev.actor_type}
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4" /> Email dispatch audit trail
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dispatches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No dispatches recorded — the trail is written when a document is sent.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Document</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Template</TableHead>
                        <TableHead>PDF hash</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Attempts</TableHead>
                        <TableHead>Last attempt</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dispatches.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">
                            {docById.get(d.document_id)?.document_number ?? d.message_id}
                          </TableCell>
                          <TableCell>{d.recipient_email}</TableCell>
                          <TableCell className="max-w-[220px] truncate" title={d.subject}>{d.subject}</TableCell>
                          <TableCell>
                            <span className="text-xs">{d.template_key}@{d.template_version}</span>
                          </TableCell>
                          <TableCell>
                            {d.pdf_sha256 ? (
                              <span className="font-mono text-xs" title={d.pdf_sha256}>{d.pdf_sha256.slice(0, 10)}…</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <ToneBadge tone={dispatchStatusTone(d.status)}>{DISPATCH_STATUS_LABEL[d.status] ?? d.status}</ToneBadge>
                          </TableCell>
                          <TableCell className="text-right">{d.attempt_count}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {d.last_attempt_at ? new Date(d.last_attempt_at).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={d.error_message ?? undefined}>
                            {d.error_message ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </AsyncState>
    </div>
  );
}
