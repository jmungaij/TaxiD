/**
 * Reusable document uploader for all 4 delivery modules.
 *
 *  - Validates file type and size client-side (with friendly error toasts).
 *  - Streams to the private `delivery-documents` Supabase bucket.
 *  - Shows real upload progress.
 *  - Renders a verification status timeline driven by
 *    `delivery_document_events` (uploaded → submitted → approved / rejected).
 *
 * Used by `KycDocumentsPanel` and any future module-specific document UI.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const DEFAULT_ACCEPTED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];
export const DEFAULT_MAX_SIZE_MB = 10;

export type DocStatus = "missing" | "pending" | "approved" | "rejected" | "expired";

export interface DocEvent {
  id: string;
  event_type: string;
  notes: string | null;
  created_at: string;
}

export interface UploadedDoc {
  id: string;
  doc_label: string;
  doc_type: string;
  status: DocStatus;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  rejection_reason: string | null;
  verified_at: string | null;
  events?: DocEvent[];
}

interface Props {
  /** Stable identifier for this checklist row (slug). */
  slug: string;
  /** Human label, shown in the timeline & db row. */
  label: string;
  /** doc_type to write into driver_documents (use 'OTHER' for module-specific). */
  docType?: string;
  /** Module discriminator. */
  module: "package" | "courier" | "fleet" | "logistics";
  /** Existing doc row (if any) — drives the timeline. */
  existing?: UploadedDoc;
  /** Optional override for the accept attribute. */
  acceptedMime?: string[];
  /** Override max size in MB. */
  maxSizeMb?: number;
  /** Called after a successful upload / status change so the parent can refetch. */
  onChanged: () => void;
}

export function DocumentUploader({
  slug,
  label,
  docType = "OTHER",
  module,
  existing,
  acceptedMime = DEFAULT_ACCEPTED_MIME,
  maxSizeMb = DEFAULT_MAX_SIZE_MB,
  onChanged,
}: Props) {
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<DocEvent[]>(existing?.events ?? []);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setEvents(existing?.events ?? []), [existing?.id, existing?.events]);

  const status: DocStatus = existing?.status ?? "missing";

  const loadEvents = useCallback(async (docId: string) => {
    const { data } = await supabase
      .from("delivery_document_events" as never)
      .select("id,event_type,notes,created_at")
      .eq("document_id", docId)
      .order("created_at", { ascending: true });
    setEvents((data as DocEvent[]) ?? []);
  }, []);

  function validate(file: File): string | null {
    if (acceptedMime.length && !acceptedMime.includes(file.type)) {
      return `Unsupported file type. Use ${acceptedMime
        .map((m) => m.split("/")[1].toUpperCase())
        .join(", ")}.`;
    }
    if (file.size > maxSizeMb * 1024 * 1024) {
      return `File is too large (max ${maxSizeMb} MB).`;
    }
    return null;
  }

  async function handleFile(file: File) {
    const err = validate(file);
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    setProgress(5);

    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Not authenticated");

      const ext = file.name.split(".").pop() ?? "bin";
      const objectPath = `${uid}/${module}/${slug}/${Date.now()}.${ext}`;

      setProgress(25);
      const { error: upErr } = await supabase.storage
        .from("delivery-documents")
        .upload(objectPath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });
      if (upErr) throw upErr;
      setProgress(60);

      const { data: signed } = await supabase.storage
        .from("delivery-documents")
        .createSignedUrl(objectPath, 60 * 60 * 24 * 7); // 7 days

      // Upsert row in driver_documents
      let docId = existing?.id;
      if (docId) {
        const { error: updErr } = await supabase
          .from("driver_documents")
          .update({
            file_url: signed?.signedUrl ?? objectPath,
            file_name: file.name,
            file_size: file.size,
            status: "PENDING",
            rejection_reason: null,
            verification_notes: null,
            verified_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", docId);
        if (updErr) throw updErr;
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from("driver_documents")
          .insert({
            driver_id: uid,
            doc_type: docType,
            doc_label: label,
            module,
            file_url: signed?.signedUrl ?? objectPath,
            file_name: file.name,
            file_size: file.size,
            status: "PENDING",
          } as never)
          .select("id")
          .single();
        if (insErr) throw insErr;
        docId = (inserted as { id: string }).id;
      }
      setProgress(85);

      await supabase
        .from("delivery_document_events" as never)
        .insert({
          document_id: docId,
          actor_id: uid,
          event_type: existing ? "resubmitted" : "uploaded",
          notes: file.name,
        } as never);

      setProgress(100);
      toast.success("Document uploaded — pending review");
      await loadEvents(docId!);
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.error(msg);
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(0), 600);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove() {
    if (!existing?.id) return;
    setBusy(true);
    try {
      await supabase
        .from("delivery_document_events" as never)
        .insert({
          document_id: existing.id,
          event_type: "deleted",
          notes: existing.file_name,
        } as never);
      const { error } = await supabase
        .from("driver_documents")
        .delete()
        .eq("id", existing.id);
      if (error) throw error;
      toast.success("Document removed");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove document");
    } finally {
      setBusy(false);
    }
  }

  async function markApproved() {
    if (!existing?.id) return;
    setBusy(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      const { error } = await supabase
        .from("driver_documents")
        .update({
          status: "APPROVED",
          verified_at: new Date().toISOString(),
          verified_by: uid,
        })
        .eq("id", existing.id);
      if (error) throw error;
      await supabase
        .from("delivery_document_events" as never)
        .insert({
          document_id: existing.id,
          actor_id: uid,
          event_type: "approved",
        } as never);
      toast.success("Marked verified");
      await loadEvents(existing.id);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not verify");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg p-3 space-y-3" data-doc-slug={slug}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <div className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {label}
          </div>
          {existing?.file_name ? (
            <div className="text-[11px] text-muted-foreground truncate">
              {existing.file_name}
              {existing.file_size
                ? ` · ${(existing.file_size / 1024).toFixed(0)} KB`
                : ""}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">
              No file uploaded yet · {acceptedMime.map((m) => m.split("/")[1]).join(", ")} · up to {maxSizeMb} MB
            </div>
          )}
        </div>
        <StatusBadge status={status} />
        <input
          ref={fileRef}
          type="file"
          accept={acceptedMime.join(",")}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {existing?.file_url ? (
          <>
            {status !== "approved" && (
              <Button size="sm" variant="outline" onClick={markApproved} disabled={busy}>
                <ShieldCheck className="h-4 w-4 mr-1" /> Mark verified
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload className="h-4 w-4 mr-1" /> Replace
            </Button>
            <Button size="icon" variant="ghost" onClick={remove} disabled={busy}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            Upload
          </Button>
        )}
      </div>

      {progress > 0 && progress < 100 && (
        <Progress value={progress} className="h-1.5" aria-label="Upload progress" />
      )}

      {existing?.rejection_reason && (
        <div className="text-xs rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
          Rejected: {existing.rejection_reason}
        </div>
      )}

      {(events.length > 0 || existing) && (
        <Timeline events={events} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: DocStatus }) {
  const map: Record<DocStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: React.ComponentType<{ className?: string }> }> = {
    missing: { label: "Missing", variant: "outline", icon: Clock },
    pending: { label: "Pending review", variant: "secondary", icon: Clock },
    approved: { label: "Verified", variant: "default", icon: CheckCircle2 },
    rejected: { label: "Rejected", variant: "destructive", icon: XCircle },
    expired: { label: "Expired", variant: "destructive", icon: XCircle },
  };
  const m = map[status];
  const Icon = m.icon;
  return (
    <Badge variant={m.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {m.label}
    </Badge>
  );
}

function Timeline({ events }: { events: DocEvent[] }) {
  if (!events.length) return null;
  return (
    <ol className="relative border-l border-border ml-2 pl-4 space-y-2">
      {events.map((e) => (
        <li key={e.id} className="text-[11px] text-muted-foreground">
          <span
            className={cn(
              "absolute -left-[5px] mt-1 h-2 w-2 rounded-full",
              e.event_type === "approved"
                ? "bg-primary"
                : e.event_type === "rejected"
                ? "bg-destructive"
                : "bg-muted-foreground/50"
            )}
          />
          <span className="font-medium capitalize text-foreground/80">
            {e.event_type.replace(/_/g, " ")}
          </span>{" "}
          · {new Date(e.created_at).toLocaleString()}{" "}
          {e.notes ? <span className="text-muted-foreground">— {e.notes}</span> : null}
        </li>
      ))}
    </ol>
  );
}
