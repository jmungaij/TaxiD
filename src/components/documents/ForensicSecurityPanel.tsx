/**
 * Forensic security panel — the on-screen twin of a document's printed
 * identity: issued numbers, provenance chain, hash-chained event log, the
 * recipient-bound distribution register and lifecycle controls.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDigit, Fingerprint, History, KeyRound, ShieldCheck, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AppButton } from "@/components/nav/AppButton";
import * as forensics from "@/lib/documents/forensics";
import type { SecurityMark } from "@/lib/documents/forensics";

const TONE: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning-foreground border-warning/30",
  destructive: "bg-destructive/10 text-destructive border-destructive/30",
  muted: "bg-muted text-muted-foreground border-border",
};

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className={`text-sm ${mono ? "break-all font-mono text-xs" : "font-medium"}`}>{value || "—"}</dd>
    </div>
  );
}

export function ForensicSecurityPanel({ mark }: { mark: SecurityMark }) {
  const qc = useQueryClient();
  const [recipient, setRecipient] = useState("");
  const [revokeReason, setRevokeReason] = useState("");

  const eventsQ = useQuery({
    queryKey: ["doc-forensics", "events", mark.id],
    queryFn: () => forensics.listSecurityEvents(mark.id),
  });
  const distributionsQ = useQuery({
    queryKey: ["doc-forensics", "distributions", mark.id],
    queryFn: () => forensics.listDistributions(mark.id),
  });
  const signatureQ = useQuery({
    queryKey: ["doc-forensics", "signature", mark.id],
    queryFn: () => forensics.verifyDocumentSignature(mark.id),
  });
  const chainQ = useQuery({
    queryKey: ["doc-forensics", "chain", mark.id],
    queryFn: () => forensics.verifyAuditChain(mark.id),
  });

  const distribute = useMutation({
    mutationFn: () =>
      forensics.registerDistribution({
        markId: mark.id,
        recipientLabel: recipient.trim(),
        channel: "download",
        purpose: "Recipient-bound controlled copy",
      }),
    onSuccess: (row) => {
      toast.success(`Controlled copy registered — ${row.distribution_ref}`);
      setRecipient("");
      qc.invalidateQueries({ queryKey: ["doc-forensics", "distributions", mark.id] });
      qc.invalidateQueries({ queryKey: ["doc-forensics", "events", mark.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sign = useMutation({
    mutationFn: () => forensics.signDocument(mark.id),
    onSuccess: (r) => {
      toast.success(`Sealed with authority key ${r.key_id ?? ""}`.trim());
      qc.invalidateQueries({ queryKey: ["doc-forensics", "signature", mark.id] });
      qc.invalidateQueries({ queryKey: ["doc-forensics", "events", mark.id] });
      qc.invalidateQueries({ queryKey: ["doc-forensics", "chain", mark.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportEvidence = useMutation({
    mutationFn: () => forensics.certifiedEvidencePackage(mark.id),
    onSuccess: (pkg) => {
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evidence-${mark.doc_number}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Evidence package exported — ${pkg.proof.verdict.replace(/_/g, " ").toLowerCase()}, manifest ${pkg.manifest_sha256.slice(0, 16)}…`,
      );
      qc.invalidateQueries({ queryKey: ["doc-forensics", "events", mark.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const lifecycle = useMutation({
    mutationFn: (status: "revoked" | "expired" | "archived" | "valid") =>
      forensics.setMarkStatus(
        mark.id,
        status,
        status === "revoked"
          ? revokeReason.trim()
          : "Changed from the Document Security Centre",
      ),
    onSuccess: (_row, status) => {
      toast.success(status === "revoked" ? "Document revoked — authority withdrawn" : "Document lifecycle updated");
      setRevokeReason("");
      qc.invalidateQueries({ queryKey: ["doc-forensics"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const chain = forensics.provenanceChain(mark);
  const complete = forensics.provenanceComplete(mark);
  const assurance = forensics.authorityAssurance({
    state: mark.status === "revoked"
      ? "AUTHENTIC_REVOKED"
      : mark.status === "void"
        ? "AUTHENTIC_VOID"
        : mark.status === "superseded"
          ? "AUTHENTIC_SUPERSEDED"
          : "AUTHENTIC",
    provenanceComplete: complete,
    signature: signatureQ.data ?? null,
    chain: chainQ.data ?? null,
  });
  const assuranceVerdict = forensics.forensicVerdict(assurance.state);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Fingerprint className="h-4 w-4 text-primary" aria-hidden /> Forensic identity
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={TONE[forensics.markStatusTone(mark.status)]}>
              {forensics.titleiseCode(mark.status)}
            </Badge>
            <Badge variant="outline">{forensics.titleiseCode(mark.profile_code)}</Badge>
            <Badge variant="outline">{forensics.titleiseCode(mark.classification)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Document number" value={mark.doc_number} />
            <Field label="Security number" value={mark.security_number} />
            <Field label="Version" value={`V${String(mark.doc_version).padStart(2, "0")}`} />
            <Field label="Source system" value={mark.source_system} />
            <Field label="Origin record" value={mark.origin_ref} />
            <Field label="Issued" value={new Date(mark.issued_at).toLocaleString("en-KE")} />
            <Field label="Document hash (SHA-256)" value={mark.document_hash} mono />
            <Field label="Template hash" value={mark.template_hash} mono />
            <Field label="Data snapshot hash" value={mark.data_snapshot_hash} mono />
          </dl>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Printed control line</p>
            <p className="mt-1 break-all font-mono text-[11px]">{mark.footer_line}</p>
            <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{mark.micro_code}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" aria-hidden /> Document authority
          </CardTitle>
          <Badge variant="outline" className={TONE[assuranceVerdict.tone]}>
            {assuranceVerdict.label}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div role="status" aria-live="polite" className="space-y-3">
            <p className="text-sm">{assuranceVerdict.advice}</p>
            <p className="text-sm text-muted-foreground">
              Authority result: {forensics.titleiseCode(assurance.result)} — {assurance.relyable
                ? "every control passed."
                : "at least one control did not pass; see below."}
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {assurance.controls.map((c) => (
                <li key={c.label} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      c.status === "PASS"
                        ? "bg-success"
                        : c.status === "FAIL"
                          ? "bg-destructive"
                          : c.status === "WARNING"
                            ? "bg-warning"
                            : "bg-muted-foreground"
                    }`}
                    aria-hidden
                  />
                  <span>
                    <span className="font-medium">{c.label}</span>
                    <span className="ml-2 font-mono text-xs uppercase text-muted-foreground">{c.status}</span>
                    {c.detail ? <span className="block text-xs text-muted-foreground">{c.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>

          </div>

          {signatureQ.data?.signed && (
            <dl className="grid gap-4 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-3">
              <Field label="Algorithm" value={signatureQ.data.algorithm ?? "ed25519"} />
              <Field label="Authority key" value={signatureQ.data.key_id ?? null} />
              <Field
                label="Signed"
                value={signatureQ.data.signed_at ? new Date(signatureQ.data.signed_at).toLocaleString("en-KE") : null}
              />
              <Field label="Statement hash" value={signatureQ.data.statement_hash ?? null} mono />
              <Field label="Audit chain head" value={chainQ.data?.head_hash ?? null} mono />
              <Field
                label="Audit continuity"
                value={chainQ.data ? `${chainQ.data.events} events · ${chainQ.data.broken_links} broken` : null}
              />
            </dl>
          )}

          <div className="flex flex-wrap gap-2">
            <AppButton
              analytics="doc_authority_sign"
              action="submit"
              size="sm"
              disabled={sign.isPending || !mark.document_hash}
              onClick={() => sign.mutate()}
            >
              {signatureQ.data?.signed ? "Re-verify authority signature" : "Sign with authority key"}
            </AppButton>
            <AppButton
              analytics="doc_authority_evidence"
              action="submit"
              variant="outline"
              size="sm"
              disabled={exportEvidence.isPending}
              onClick={() => exportEvidence.mutate()}
            >
              Download evidence package
            </AppButton>
            <AppButton
              analytics="doc_forensics_expire"
              action="submit"
              variant="outline"
              size="sm"
              disabled={mark.status === "expired" || lifecycle.isPending}
              onClick={() => lifecycle.mutate("expired")}
            >
              Mark as expired
            </AppButton>
            <AppButton
              analytics="doc_forensics_archive"
              action="submit"
              variant="outline"
              size="sm"
              disabled={mark.status === "archived" || lifecycle.isPending}
              onClick={() => lifecycle.mutate("archived")}
            >
              Archive document
            </AppButton>
            <AppButton
              analytics="doc_forensics_restore"
              action="submit"
              variant="outline"
              size="sm"
              disabled={mark.status === "valid" || lifecycle.isPending}
              onClick={() => lifecycle.mutate("valid")}
            >
              Restore validity
            </AppButton>
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div className="min-w-[240px] flex-1">
              <Label htmlFor="revoke-reason">Revocation reason (recorded permanently)</Label>
              <Input
                id="revoke-reason"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Why this document's authority is withdrawn"
              />
            </div>
            <AppButton
              analytics="doc_forensics_revoke"
              action="submit"
              variant="destructive"
              size="sm"
              disabled={revokeReason.trim().length < 6 || mark.status === "revoked" || lifecycle.isPending}
              onClick={() => lifecycle.mutate("revoked")}
            >
              Revoke document authority
            </AppButton>
          </div>
        </CardContent>
      </Card>


      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Provenance chain
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {chain.map((step) => (
              <li key={step.label} className="flex items-start gap-3">
                <span
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${step.complete ? "bg-success" : "bg-warning"}`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{step.label}</p>
                  <p className="break-all font-mono text-xs text-muted-foreground">{step.value ?? "Not recorded"}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className={`mt-4 text-sm ${complete ? "text-success" : "text-warning-foreground"}`} role="status">
            {complete
              ? "Provenance is complete — this document can be replayed from source."
              : "Provenance is incomplete — escalate before this document is relied upon."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" aria-hidden /> Controlled copies
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="forensic-recipient">Recipient (bound into the copy)</Label>
              <Input
                id="forensic-recipient"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Name, company or inbox"
              />
            </div>
            <AppButton
              analytics="doc_forensics_register_copy"
              action="submit"
              size="sm"
              disabled={recipient.trim().length < 2 || distribute.isPending}
              onClick={() => distribute.mutate()}
            >
              Register controlled copy
            </AppButton>
          </div>
          {distributionsQ.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (distributionsQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No copies have been distributed yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(distributionsQ.data ?? []).map((d) => (
                <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span className="font-mono text-xs">{d.distribution_ref}</span>
                  <span className="text-sm">{d.recipient_label}</span>
                  <span className="text-xs text-muted-foreground">
                    {d.channel} · {new Date(d.issued_at).toLocaleString("en-KE")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" aria-hidden /> Hash-chained security events
          </CardTitle>
        </CardHeader>
        <CardContent>
          {eventsQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ol className="space-y-3">
              {(eventsQ.data ?? []).map((e) => (
                <li key={e.id} className="border-l-2 border-border pl-3">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <FileDigit className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    {forensics.titleiseCode(e.event_type)}
                  </p>
                  <p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("en-KE")}</p>
                  <p className="break-all font-mono text-[10px] text-muted-foreground">{e.chain_hash}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default ForensicSecurityPanel;
