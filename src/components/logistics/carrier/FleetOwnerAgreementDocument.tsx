/**
 * Executed Fleet Owner agreement pack — printable record.
 *
 * Shows the instruments the Fleet Owner has accepted, the acceptance evidence
 * held against each one (signatory, timestamp, accepted-text hash) and the full
 * clause text. Nothing here decides or asserts execution: every state comes
 * from buildAgreementDocument(), which reads the acceptance records.
 */
import { useEffect, useState } from "react";
import {
  agreementDocumentText,
  buildAgreementDocument,
  type AgreementDocument,
  type AgreementParty,
  type ExecutionState,
} from "@/lib/logistics/carrier/agreementDocument";
import type { CarrierDeclarationRow } from "@/lib/logistics/carrier/onboarding";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Download, FileText, Loader2, Printer } from "lucide-react";

const stateTone: Record<ExecutionState, string> = {
  EXECUTED: "bg-status-success/10 text-status-success border-status-success/30",
  NOT_EXECUTED: "bg-muted text-muted-foreground",
  SUPERSEDED: "bg-status-warning/10 text-status-warning border-status-warning/30",
  WITHDRAWN: "bg-destructive/10 text-destructive border-destructive/30",
};

interface Props {
  fleetOwner: AgreementParty;
  declarations: CarrierDeclarationRow[];
}

export default function FleetOwnerAgreementDocument({ fleetOwner, declarations }: Props) {
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<AgreementDocument | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void buildAgreementDocument({ fleetOwner, declarations }).then((d) => {
      if (live) setDoc(d);
    });
    return () => { live = false; };
  }, [open, fleetOwner, declarations]);

  function download() {
    if (!doc) return;
    const blob = new Blob([agreementDocumentText(doc)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.reference}-agreement-pack.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function print() {
    if (!doc) return;
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) return;
    w.document.write(
      `<pre style="font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;padding:32px">${agreementDocumentText(doc)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</pre>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText className="mr-2 h-4 w-4" aria-hidden />
          View partner agreement
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fleet Owner / Transport Service Provider agreement pack</DialogTitle>
          <DialogDescription>
            The instruments accepted on the platform, with the acceptance evidence held against each one.
          </DialogDescription>
        </DialogHeader>

        {!doc ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Assembling the record…
          </div>
        ) : (
          <div className="space-y-5 text-sm">
            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">Reference {doc.reference}</p>
                <Badge variant="outline" className={doc.fullyExecuted ? stateTone.EXECUTED : stateTone.NOT_EXECUTED}>
                  {doc.fullyExecuted ? "Fully executed" : "Not fully executed"}
                </Badge>
              </div>
              <dl className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Platform</dt>
                  <dd className="font-medium">{doc.platform.legalEntityName}</dd>
                  <dd className="text-xs text-muted-foreground">{doc.platform.role}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">Fleet Owner</dt>
                  <dd className="font-medium">
                    {doc.fleetOwner.legalEntityName} ({doc.fleetOwner.carrierCode})
                  </dd>
                  <dd className="text-xs text-muted-foreground">
                    Operating {doc.fleetOwner.operatingStatus.replace(/_/g, " ")} · contract{" "}
                    {doc.fleetOwner.contractStatus.replace(/_/g, " ")}
                  </dd>
                </div>
              </dl>
              {!doc.fullyExecuted && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Outstanding: {doc.outstanding.join("; ")}
                </p>
              )}
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={print}>
                  <Printer className="mr-2 h-4 w-4" aria-hidden /> Print
                </Button>
                <Button size="sm" variant="outline" onClick={download} data-analytics="fleet_owner_agreement_download">
                  <Download className="mr-2 h-4 w-4" aria-hidden /> Download copy
                </Button>
              </div>
            </div>

            {doc.sections.map((s) => (
              <section key={s.instrument.code} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">
                      {s.instrument.title} <span className="text-muted-foreground">({s.instrument.version})</span>
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Legal register controls: {s.instrument.legalControls.join(", ")}
                    </p>
                  </div>
                  <Badge variant="outline" className={stateTone[s.state]}>
                    {s.state.replace(/_/g, " ")}
                  </Badge>
                </div>

                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {s.acceptedAt ? (
                    <p>
                      Accepted by {s.acceptedByName ?? "—"} on {new Date(s.acceptedAt).toLocaleString()}
                    </p>
                  ) : (
                    <p>No acceptance recorded.</p>
                  )}
                  {s.recordedHash && <p className="break-all">Accepted text SHA-256: {s.recordedHash}</p>}
                  <p className="break-all">Document text SHA-256: {s.renderedHash}</p>
                  <p>{s.note}</p>
                </div>

                <Separator className="my-3" />
                <ol className="space-y-2 text-xs leading-relaxed">
                  {s.instrument.clauses.map((c, i) => <li key={i}>{c}</li>)}
                </ol>
              </section>
            ))}

            <p className="text-xs text-muted-foreground">
              This pack records the instruments accepted on the Yalla Mobility platform and the acceptance
              evidence held against them. It is not legal advice.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
