/**
 * Attachments and linked resources (meetings, spreadsheets, documents) for
 * workspace email. Files live in the private comms-attachments bucket under the
 * uploader's own folder; reads are authorised by conversation access.
 */
import { useEffect, useRef, useState } from "react";
import { CalendarClock, Download, FileSpreadsheet, FileText, Link2, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export type LinkKind = "meeting" | "sheet" | "document" | "link";
export interface DraftFile { path: string; filename: string; mime: string; size: number }
export interface DraftLink { kind: LinkKind; label: string; url: string; meeting_booking_id?: string | null }

const MAX = 10 * 1024 * 1024;
const KIND_ICON = { meeting: CalendarClock, sheet: FileSpreadsheet, document: FileText, link: Link2, attachment: Paperclip } as const;
const KIND_LABEL: Record<string, string> = { meeting: "Meeting", sheet: "Spreadsheet", document: "Document", link: "Link", attachment: "File" };

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function guessKind(url: string): LinkKind {
  if (/meet\.google\.com|zoom\.us|teams\.microsoft|\/book-a-meeting/.test(url)) return "meeting";
  if (/spreadsheets|\.xlsx?($|\?)|\.csv($|\?)/i.test(url)) return "sheet";
  if (/docs\.google\.com\/document|drive\.google\.com|\.pdf($|\?)|\.docx?($|\?)/i.test(url)) return "document";
  return "link";
}

async function uploadFiles(list: FileList): Promise<DraftFile[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again.");
  const out: DraftFile[] = [];
  for (const f of Array.from(list)) {
    if (f.size > MAX) throw new Error(`${f.name} is larger than 10 MB.`);
    const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `${user.id}/${crypto.randomUUID()}-${safe}`;
    const { error } = await supabase.storage.from("comms-attachments").upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (error) throw new Error(error.message);
    out.push({ path, filename: f.name, mime: f.type || "application/octet-stream", size: f.size });
  }
  return out;
}

export async function downloadCommsFile(path: string, filename: string) {
  const { data, error } = await supabase.storage.from("comms-attachments").createSignedUrl(path, 120, { download: filename });
  if (error || !data) throw new Error(error?.message ?? "Could not prepare the download.");
  window.open(data.signedUrl, "_blank", "noopener");
}

interface MyMeeting { id: string; label: string; url: string }

function useMyMeetings() {
  const [rows, setRows] = useState<MyMeeting[]>([]);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("public_meeting_bookings" as never)
        .select("id, client_name, company, topic, starts_at, join_url")
        .eq("status", "confirmed")
        .gte("starts_at", new Date(Date.now() - 86400000).toISOString())
        .not("join_url", "is", null)
        .order("starts_at")
        .limit(30);
      setRows(((data ?? []) as Array<Record<string, string>>).map((m) => ({
        id: m.id,
        url: m.join_url,
        label: `${m.company || m.client_name} — ${new Date(m.starts_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" })}`,
      })));
    })();
  }, []);
  return rows;
}

/** Attach files / links / a meeting to a draft email. */
export function AttachmentsEditor({
  files, links, onFiles, onLinks,
}: { files: DraftFile[]; links: DraftLink[]; onFiles: (f: DraftFile[]) => void; onLinks: (l: DraftLink[]) => void }) {
  const { toast } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const meetings = useMyMeetings();
  const total = files.reduce((a, f) => a + f.size, 0);

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    const size = Array.from(list).reduce((a, f) => a + f.size, 0);
    if (total + size > MAX) { toast({ title: "Too large", description: "Attachments are limited to 10 MB in total.", variant: "destructive" }); return; }
    setBusy(true);
    try { onFiles([...files, ...(await uploadFiles(list))]); }
    catch (e) { toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };

  const addLink = () => {
    const u = url.trim();
    if (!/^https:\/\/\S+$/.test(u)) { toast({ title: "Check the link", description: "Links must start with https://", variant: "destructive" }); return; }
    onLinks([...links, { kind: guessKind(u), url: u, label: label.trim() || u }]);
    setUrl(""); setLabel("");
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={ref} type="file" multiple className="hidden" onChange={(e) => void pick(e.target.files)} />
        <Button type="button" size="sm" variant="outline" className="gap-2" disabled={busy} onClick={() => ref.current?.click()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />} Attach files
        </Button>
        {meetings.length > 0 && (
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value=""
            onChange={(e) => {
              const m = meetings.find((x) => x.id === e.target.value);
              if (m) onLinks([...links, { kind: "meeting", label: m.label, url: m.url, meeting_booking_id: m.id }]);
            }}
          >
            <option value="">Link a meeting…</option>
            {meetings.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
        <span className="text-xs text-muted-foreground">{fmtSize(total)} of 10 MB used</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="min-w-[14rem] flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a sheet, document or meeting link (https://…)" />
        <Input className="w-48" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name (optional)" />
        <Button type="button" size="sm" variant="outline" className="gap-2" onClick={addLink}><Link2 className="h-3.5 w-3.5" /> Add link</Button>
      </div>
      {(files.length > 0 || links.length > 0) && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={f.path} className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1 text-xs">
              <Paperclip className="h-3 w-3" /> {f.filename} · {fmtSize(f.size)}
              <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => {
                void supabase.storage.from("comms-attachments").remove([f.path]);
                onFiles(files.filter((_, j) => j !== i));
              }}><X className="h-3 w-3" /></button>
            </li>
          ))}
          {links.map((l, i) => {
            const Icon = KIND_ICON[l.kind];
            return (
              <li key={`${l.url}-${i}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1 text-xs">
                <Icon className="h-3 w-3" /> <span className="truncate">{KIND_LABEL[l.kind]}: {l.label}</span>
                <button type="button" aria-label="Remove link" onClick={() => onLinks(links.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface Resource { id: string; kind: string; label: string; url: string | null; storage_path: string | null; size_bytes: number | null; created_by: string; created_at: string }

/** Files and links on an open conversation, with download and add. */
export function ThreadResources({ threadId }: { threadId: string }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Resource[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [links, setLinks] = useState<DraftLink[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("comms_thread_resources" as never).select("*").eq("thread_id", threadId).order("created_at");
    setRows((data ?? []) as Resource[]);
  };
  useEffect(() => { void load(); void supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, [threadId]);

  const save = async () => {
    setSaving(true);
    const payload = [
      ...files.map((f) => ({ thread_id: threadId, kind: "attachment", label: f.filename, storage_path: f.path, mime_type: f.mime, size_bytes: f.size })),
      ...links.map((l) => ({ thread_id: threadId, kind: l.kind, label: l.label, url: l.url, meeting_booking_id: l.meeting_booking_id ?? null })),
    ];
    const { error } = await supabase.from("comms_thread_resources" as never).insert(payload as never);
    setSaving(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    setFiles([]); setLinks([]); setAdding(false); toast({ title: "Added to conversation" }); void load();
  };

  const remove = async (r: Resource) => {
    const { error } = await supabase.from("comms_thread_resources" as never).delete().eq("id", r.id);
    if (error) { toast({ title: "Not removed", description: error.message, variant: "destructive" }); return; }
    if (r.storage_path) void supabase.storage.from("comms-attachments").remove([r.storage_path]);
    void load();
  };

  return (
    <div className="border-b border-border/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Files & links ({rows.length})</p>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setAdding((v) => !v)}>
          <Paperclip className="h-3.5 w-3.5" /> {adding ? "Close" : "Add"}
        </Button>
      </div>
      {rows.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => {
            const Icon = KIND_ICON[r.kind as keyof typeof KIND_ICON] ?? Link2;
            return (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{r.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{KIND_LABEL[r.kind]}{r.size_bytes ? ` · ${fmtSize(r.size_bytes)}` : ""}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {r.storage_path ? (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadCommsFile(r.storage_path!, r.label).catch((e) => toast({ title: "Download failed", description: (e as Error).message, variant: "destructive" }))}>
                      <Download className="h-3.5 w-3.5" /> Download
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" asChild><a href={r.url!} target="_blank" rel="noopener noreferrer">{r.kind === "meeting" ? "Join" : "Open"}</a></Button>
                  )}
                  {r.created_by === me && (
                    <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => void remove(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <div className="mt-3 space-y-2">
          <AttachmentsEditor files={files} links={links} onFiles={setFiles} onLinks={setLinks} />
          <Button size="sm" disabled={saving || (!files.length && !links.length)} onClick={() => void save()}>
            {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Save to conversation
          </Button>
        </div>
      )}
    </div>
  );
}
